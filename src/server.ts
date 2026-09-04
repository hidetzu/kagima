// The one process (`docs/adr/0002`). ⚠ **HTTP now; the WebSocket signalling joins it in kagima#6.**
//
// ⚠ **What this serves is who may join.** ⚠ **It never carries what they say** (`CLAUDE.md` § 3).
// ⚠ **No media path reaches this file, and `docs/adr/0001` says none ever will.**
//
// ## Usage
//
//   npm run dev
//
// ⚠ **Every room dies with this process.** ⚠ **That is the specification** (`docs/adr/0005`).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { createRoom } from "./room/create-room.ts";
import {
  type RejectionCounter,
  attemptJoin,
  createRejectionCounter,
  defaultCompare,
} from "./room/join.ts";
import { type RateLimiter, createRateLimiter } from "./room/rate-limit.ts";
import { type RoomStore, createRoomStore } from "./room/store.ts";

const DEFAULT_PORT = 8787;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;

/**
 * ⚠ **A join body is one short field.** ⚠ **Anything larger is not a join.**
 * ⚠ **The cap is applied while reading, not after** — ⚠ **buffering first and checking later is
 * how an unauthenticated caller decides how much memory this process uses.**
 */
const MAX_BODY_BYTES = 1024;

export type Context = {
  readonly store: RoomStore;
  readonly baseUrl: string;
  readonly secret: string;
  readonly rejections: RejectionCounter;
  readonly limiter: RateLimiter;
  /**
   * ⚠ **The header to read the caller's address from, when something we trust sets it.**
   *
   * ⚠ **Empty means: use the socket.** ⚠ **That is the only value that is safe by itself.**
   * ⚠ **Naming a header trusts whoever can set it** — ⚠ **and if anything can reach this process
   * without going through that proxy, the per-source limit is bypassed by typing a header.**
   * ⚠ **So it is off unless the deployment says otherwise** (`src/server.ts` § sourceOf).
   */
  readonly trustedSourceHeader: string;
};

/**
 * ⚠ **Who is asking.**
 *
 * ⚠ **Behind Cloudflare Tunnel the socket address is the tunnel's, so every caller looks like one
 * source and the per-source limit collapses into the room limit.**
 * ⚠ **A header fixes that, and introduces a worse problem if it is trusted without a proxy in
 * front that always overwrites it.**
 *
 * ⚠ **kagima refuses to guess.** ⚠ **The header is used only when it is named explicitly.**
 */
export const sourceOf = (req: IncomingMessage, trustedHeader: string): string => {
  if (trustedHeader !== "") {
    const value = req.headers[trustedHeader.toLowerCase()];
    const first = Array.isArray(value) ? value[0] : value;
    // ⚠ `x-forwarded-for` is a list; the client-controlled part is on the left, so take the first
    //   ⚠ only because a trusted proxy is assumed to have rewritten the whole header.
    if (first) return first.split(",")[0]?.trim() ?? "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
};

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    // ⚠ Never let a room-creation response sit in a cache. ⚠ It carries the passphrase.
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
};

/**
 * ⚠ **The one answer to every refused join.**
 *
 * ⚠ **Same status, same body, for a wrong passphrase, an unknown room and a malformed id**
 * (`docs/adr/0004`). ⚠ **It is a single constant so the three paths cannot drift apart** —
 * ⚠ **drifting apart is exactly the bug, and it would not look like one in a diff.**
 */
const JOIN_REFUSED = {
  status: 401,
  body: { error: "the room and passphrase did not match" },
} as const;

const readBody = async (req: IncomingMessage): Promise<string | null> => {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // ⚠ Stop reading, rather than read it all and then object.
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

/**
 * ⚠ **Every outcome the room endpoints can produce, and the ones they cannot**
 * (`.claude/rules/evidence.md` § Outcomes are not one outcome).
 *
 * ```text
 * accepted and handled            a room was created, or a join was accepted
 * ⚠ malformed                      a join body that is not JSON, or has no passphrase
 * ⚠ well-formed but declined       a join that did not match       -> ⚠ one answer, always
 * ⚠ not implemented yet            any other path or method
 * ⚠ could not be satisfied         no free room id                 -> 503
 * ⚠ nothing arrived                cannot occur — the server is answering a request it received
 * ⚠ a timer expired while waiting  cannot occur — nothing here waits on anything
 * ```
 */
export const handle = async (
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const url = new URL(req.url ?? "/", ctx.baseUrl);

  if (url.pathname === "/api/rooms") {
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      send(res, 405, { error: "rooms are created with POST" });
      return;
    }
    try {
      const { room, shareUrl } = createRoom(ctx.store, ctx.baseUrl);
      // ⚠ The passphrase is returned here and nowhere else, ever. ⚠ The host cannot learn it any
      //   ⚠ other way (`docs/PRODUCT.md` § 3), and after this the server only compares it.
      //   ⚠ It is NOT in shareUrl — see room-id.ts.
      send(res, 201, { roomId: room.id, shareUrl, passphrase: room.passphrase });
    } catch {
      // ⚠ Nothing from the error reaches the response or a log line (`.claude/rules/security.md` § 2).
      send(res, 503, { error: "could not create a room just now, please try again" });
    }
    return;
  }

  const join = /^\/api\/rooms\/([^/]+)\/join$/.exec(url.pathname);
  if (join) {
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      send(res, 405, { error: "joining a room is a POST" });
      return;
    }

    const raw = await readBody(req);
    if (raw === null) {
      // ⚠ Malformed, and said so — ⚠ this is not the same as declined, and the caller is the one
      //   ⚠ that is wrong (`.claude/rules/evidence.md`). ⚠ It leaks nothing about any room.
      send(res, 413, { error: "that request body is too large to be a join" });
      return;
    }

    let submitted: unknown;
    try {
      submitted = (JSON.parse(raw) as { passphrase?: unknown }).passphrase;
    } catch {
      send(res, 400, { error: "the body is not JSON" });
      return;
    }
    if (typeof submitted !== "string") {
      send(res, 400, { error: "the body needs a passphrase, as a string" });
      return;
    }

    const roomId = decodeURIComponent(join[1] as string);
    const source = sourceOf(req, ctx.trustedSourceHeader);

    // ⚠ Ask before comparing anything. ⚠ A limit that fires after the work has been done
    //   ⚠ still lets the work be used as a timing signal.
    const decision = ctx.limiter.check(roomId, source);
    if (decision !== "allow") {
      // ⚠ The same answer as a wrong passphrase, deliberately.
      //   ⚠ A distinguishable 429 would make the limit firing say "this room exists"
      //   ⚠ (`.claude/rules/security.md` § 3).
      //   ⚠ The cost is that a real guest gets no "slow down" hint. ⚠ That cost is accepted.
      ctx.rejections.record(
        decision === "source-limit"
          ? "rate-limited-source"
          : decision === "room-limit"
            ? "rate-limited-room"
            : "at-capacity",
      );
      send(res, JOIN_REFUSED.status, JOIN_REFUSED.body);
      return;
    }

    const outcome = attemptJoin(ctx.store, roomId, submitted, {
      now: Date.now,
      secret: ctx.secret,
      compare: defaultCompare,
    });

    if (!outcome.ok) {
      // ⚠ Counted apart, answered alike. ⚠ `why` stops here and never reaches the wire.
      ctx.rejections.record(outcome.why);
      // ⚠ Only a failure consumes budget. ⚠ A guest who gets it right first time costs nobody
      //   ⚠ anything, and an attacker's misses are what fill the room's ledger.
      ctx.limiter.recordFailure(roomId, source);
      send(res, JOIN_REFUSED.status, JOIN_REFUSED.body);
      return;
    }
    // ⚠ The token is bound to this room and short-lived (`src/token/join-token.ts`).
    send(res, 200, { token: outcome.token });
    return;
  }

  send(res, 404, {
    error: "no such endpoint",
    endpoints: ["POST /api/rooms", "POST /api/rooms/{roomId}/join"],
  });
};

/**
 * ⚠ **The signing secret.**
 *
 * ⚠ **There is no default value, and there never will be** — ⚠ **a constant fallback in a public
 * repository is the same as no signature at all** (`.claude/rules/security.md` § 6).
 * ⚠ **When the environment does not set one, a random secret is made for this process and the
 * consequence is said out loud**: ⚠ **restarting invalidates every token that was issued.**
 */
const joinTokenSecret = (): string => {
  const fromEnv = process.env["JOIN_TOKEN_SECRET"];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  console.log("⚠ JOIN_TOKEN_SECRET is not set — using a random one for this process only");
  console.log("⚠ restarting will invalidate every join token it issued");
  return randomBytes(32).toString("base64url");
};

export const startServer = (
  port = Number(process.env["PORT"] ?? DEFAULT_PORT),
  baseUrl = process.env["PUBLIC_BASE_URL"] ?? DEFAULT_BASE_URL,
) => {
  const trustedSourceHeader = process.env["TRUSTED_SOURCE_HEADER"] ?? "";
  if (trustedSourceHeader === "") {
    console.log("⚠ TRUSTED_SOURCE_HEADER is not set — the caller's address comes from the socket");
    console.log("⚠ behind a tunnel that makes every caller look like one source");
  }
  const ctx: Context = {
    store: createRoomStore(),
    baseUrl,
    secret: joinTokenSecret(),
    rejections: createRejectionCounter(),
    limiter: createRateLimiter({ now: Date.now }),
    trustedSourceHeader,
  };
  const server = createServer((req, res) => {
    // ⚠ A rejected promise here would take the process down and end every live room.
    void handle(ctx, req, res).catch(() => send(res, 500, { error: "something went wrong here" }));
  });
  server.listen(port, () => {
    console.log(`kagima is listening on ${baseUrl} (port ${port})`);
    console.log("⚠ rooms live in this process only — stopping it ends every room");
  });
  return server;
};

if (process.argv[1] && import.meta.filename === process.argv[1]) startServer();
