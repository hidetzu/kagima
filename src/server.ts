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
import {
  createKnockRejectionCounter,
  createKnocks,
  type KnockRejectionCounter,
  type Knocks,
} from "./knock/knocks.ts";
import { logger } from "./log.ts";
import { randomToken } from "./random.ts";
import { createRoom } from "./room/create-room.ts";
import { isRoomId } from "./room/room-id.ts";
import { createRoomStore, type RoomStore } from "./room/store.ts";
import { attachSignaling, CLOSE_ROOM_CLOSED } from "./signaling/attach.ts";
import { createHub, type Hub } from "./signaling/hub.ts";
import { parseClientMessage } from "./signaling/messages.ts";
import { missingServedFiles, serveStatic } from "./static.ts";
import { constantTimeEqual, issueJoinToken } from "./token/join-token.ts";

const DEFAULT_PORT = 8787;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;

/**
 * ⚠ **A join body is one short field.** ⚠ **Anything larger is not a join.**
 * ⚠ **The cap is applied while reading, not after** — ⚠ **buffering first and checking later is
 * how an unauthenticated caller decides how much memory this process uses.**
 */
const MAX_BODY_BYTES = 1024;

/**
 * ⚠ **Compared against when there is no room to compare against.**
 * ⚠ **Same trick as the join endpoint's decoy**: ⚠ **it keeps the unknown-room path costing the
 * same as the wrong-key path.** ⚠ **It is not a secret and no room ever holds it.**
 */
const DECOY_HOST_KEY = "decoy-host-key-that-no-room-holds";

/**
 * ⚠ **How often expired rooms are collected.**
 *
 * ⚠ **Not the same as how long a room lives** (`ROOM_IDLE_MS`). ⚠ **A room is unreachable the
 * moment it expires; ⚠ this is only how long the memory and the sockets hang around after.**
 */
const SWEEP_INTERVAL_MS = 60_000;

export type Context = {
  readonly store: RoomStore;
  readonly baseUrl: string;
  readonly secret: string;
  readonly hub: Hub;
  /** ⚠ **The door** (`docs/adr/0017`). ⚠ Who is waiting, and what the Host decided. */
  readonly knocks: Knocks;
  /** ⚠ **Why knocks were not taken.** ⚠ Counted apart, ⚠ answered alike. */
  readonly knockRejections: KnockRejectionCounter;
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
/**
 * ⚠ **Where the Node adapter puts the socket's address.**
 *
 * ⚠ **A `Request` does not carry a socket.** ⚠ **So when no proxy header is trusted, the adapter
 * writes the address here and `sourceOf` reads it** — ⚠ **one name, ⚠ in one place, ⚠ rather than
 * two ways of finding out who called.**
 */
export const NODE_SOURCE_HEADER = "x-kagima-node-source";

const sourceOf = (request: Request, trustedHeader: string): string => {
  if (trustedHeader !== "") {
    const value = request.headers.get(trustedHeader);
    // ⚠ `x-forwarded-for` is a list; the client-controlled part is on the left, so take the first
    //   ⚠ only because a trusted proxy is assumed to have rewritten the whole header.
    if (value) return value.split(",")[0]?.trim() ?? "unknown";
  }
  // ⚠ Otherwise whatever the adapter knew. ⚠ In a Worker there is no adapter and no socket,
  //   ⚠ so this is "unknown" — ⚠ which is honest. ⚠ Inventing one would be worse than having none.
  return request.headers.get(NODE_SOURCE_HEADER) ?? "unknown";
};

/**
 * ⚠ **One JSON answer.**
 *
 * ⚠ **A `Response`, ⚠ not a write to a Node object** (`docs/adr/0015`) — ⚠ **so the same routing
 * runs in a Worker and in Node, ⚠ and there is one implementation of it rather than two**
 * (`CLAUDE.md` § 3).
 */
const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // ⚠ Never let a room-creation response sit in a cache. ⚠ It carries the host key.
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });

/**
 * ⚠ **The one answer to every refused close.**
 *
 * ⚠ **A wrong host key and a room that is not there must not be distinguishable**, ⚠ **or this endpoint answers "does this room exist?" as well.**
 */
const CLOSE_REFUSED = {
  status: 401,
  body: { error: "that room could not be closed" },
} as const;

/**
 * ⚠ **The body, ⚠ or `null` when it is too large to be one of ours.**
 *
 * ⚠ **`content-length` is checked first so an oversized body is refused before it is held.**
 * ⚠ **A body with no length is still read, ⚠ and measured as it arrives.**
 */
const readBody = async (request: Request): Promise<string | null> => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  // ⚠ Measured after decoding: ⚠ the cap is about what we hold, not about bytes on the wire.
  return text.length > MAX_BODY_BYTES ? null : text;
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
export const handle = async (ctx: Context, request: Request): Promise<Response> => {
  const url = new URL(request.url, ctx.baseUrl);

  // ⚠ Only GET reaches the static map, and only by an exact name from a closed list.
  if (request.method === "GET") {
    const asset = serveStatic(url.pathname);
    if (asset !== null) return asset;
  }

  if (url.pathname === "/api/rooms") {
    if (request.method !== "POST") {
      return json(405, { error: "rooms are created with POST" }, { allow: "POST" });
    }
    try {
      const { room, shareUrl } = createRoom(ctx.store, ctx.baseUrl);
      // ⚠⚠ **The host key and the host's own token are handed over here and never again.**
      // ⚠ **There is no passphrase** (`docs/adr/0017`) — ⚠ **who comes in is the Host's decision,
      //   ⚠ and the Host is the one asking.**
      return json(201, {
        roomId: room.id,
        shareUrl,
        token: await issueJoinToken(room.id, ctx.secret, Date.now()),
        hostKey: room.hostKey,
      });
    } catch {
      // ⚠ Nothing from the error reaches the response or a log line (`.claude/rules/security.md` § 2).
      return json(503, { error: "could not create a room just now, please try again" });
    }
  }

  // ⚠⚠ **The door** (`docs/adr/0017`).
  //
  // ⚠ **Every answer here looks the same whatever happened** — ⚠ **an unknown room, a Host who
  //   ⚠ has not answered, and a door with too many people at it are one shape.**
  // ⚠ **Anything else answers "does this room exist?" for free** (`.claude/rules/security.md` § 3).
  const knockPath = /^\/api\/rooms\/([^/]+)\/knock$/.exec(url.pathname);
  if (knockPath) {
    if (request.method !== "POST") {
      return json(405, { error: "knocking is a POST" }, { allow: "POST" });
    }
    const raw = await readBody(request);
    if (raw === null) {
      return json(413, { error: "that request body is too large to be a knock" });
    }
    let nickname: unknown;
    try {
      nickname = (JSON.parse(raw) as { nickname?: unknown }).nickname;
    } catch {
      return json(400, { error: "the body is not JSON" });
    }
    // ⚠ The same rule the signalling side uses. ⚠ One place, ⚠ not two (`CLAUDE.md` § 3).
    const checked = parseClientMessage(JSON.stringify({ type: "hello", nickname }));
    if (!checked.ok || checked.message.type !== "hello") {
      // ⚠ Malformed is the caller's own mistake and says nothing about any room.
      return json(400, { error: "that name cannot be used" });
    }
    const roomId = decodeURIComponent(knockPath[1] as string);
    const { id, refused } = ctx.knocks.knock(roomId, checked.message.nickname, Date.now());
    if (refused === null) {
      // ⚠ The Host is already here, waiting, with a socket open (`docs/adr/0017`).
      ctx.hub.announce(
        roomId,
        JSON.stringify({ type: "knock", knockId: id, nickname: checked.message.nickname }),
      );
    } else {
      // ⚠ Counted, ⚠ never answered. ⚠ An uncounted rejection is indistinguishable from a
      //   ⚠ request that never arrived (`.claude/rules/evidence.md`).
      ctx.knockRejections.record(refused);
    }
    // ⚠⚠ The same body either way.
    return json(200, { knockId: id });
  }

  const knockState = /^\/api\/rooms\/([^/]+)\/knock\/([^/]+)$/.exec(url.pathname);
  if (knockState) {
    if (request.method !== "GET") {
      return json(405, { error: "reading a knock is a GET" }, { allow: "GET" });
    }
    const roomId = decodeURIComponent(knockState[1] as string);
    const knockId = decodeURIComponent(knockState[2] as string);
    // ⚠ Unknown ids read as waiting, ⚠ exactly like a Host who has not answered.
    const read = ctx.knocks.read(roomId, knockId);
    return json(200, read.token === undefined ? { state: read.state } : read);
  }

  const roomPath = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
  if (roomPath && request.method === "DELETE") {
    const raw = await readBody(request);
    if (raw === null) {
      return json(413, { error: "that request body is too large to be a close" });
    }
    let hostKey: unknown;
    try {
      hostKey = (JSON.parse(raw) as { hostKey?: unknown }).hostKey;
    } catch {
      return json(400, { error: "the body is not JSON" });
    }
    if (typeof hostKey !== "string") {
      return json(400, { error: "the body needs a hostKey, as a string" });
    }

    const roomId = decodeURIComponent(roomPath[1] as string);
    const room = isRoomId(roomId) ? ctx.store.get(roomId) : undefined;
    // ⚠ Exactly one comparison whatever the path, for the same reason the join endpoint has one:
    //   ⚠ returning early for an unknown room makes the time saved the answer.
    const matched = await constantTimeEqual(hostKey, room?.hostKey ?? DECOY_HOST_KEY);
    if (room === undefined || !matched) {
      return json(CLOSE_REFUSED.status, CLOSE_REFUSED.body);
    }

    // ⚠ The sockets first, so nobody is left holding a room that no longer exists.
    ctx.hub.closeRoom(roomId, CLOSE_ROOM_CLOSED, "the host ended this room");
    // ⚠ Then the room, and with it the host key and the participant list.
    //   ⚠ `docs/adr/0005`: what is not held cannot leak.
    ctx.store.close(roomId);
    // ⚠ And everyone still at the door hears the same one word as everyone who was refused
    //   (`docs/adr/0017`). ⚠ Leaving them on "waiting" would leave them waiting for a room
    //   ⚠ that is gone.
    ctx.knocks.endRoom(roomId);
    // ⚠ Says the room is over, and says nothing about who was in it.
    logger.info("a room was closed by its host", { roomId });
    return json(200, { closed: true });
  }

  return json(404, {
    error: "no such endpoint",
    endpoints: [
      "POST /api/rooms",
      "POST /api/rooms/{roomId}/join",
      "DELETE /api/rooms/{roomId}",
      "GET /r/{roomId}",
    ],
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
  logger.warn("JOIN_TOKEN_SECRET is not set — using a random one for this process only");
  logger.warn("restarting will invalidate every join token it issued");
  return randomToken(32);
};

export const startServer = (
  port = Number(process.env["PORT"] ?? DEFAULT_PORT),
  baseUrl = process.env["PUBLIC_BASE_URL"] ?? DEFAULT_BASE_URL,
) => {
  // ⚠⚠ **The build has to have run** (`docs/adr/0016`).
  //
  // ⚠ **Said here, at startup, ⚠ naming the command** — ⚠ **not as a stack trace on one request.**
  // ⚠ **`existsSync` says the file is there; ⚠ it says nothing about it being current.**
  //   ⚠ **Freshness is the gate runners' job, ⚠ and they build rather than check.**
  const missing = missingServedFiles();
  if (missing.length > 0) {
    // ⚠ `warn`, ⚠ because `error` is not a level this logger has (`src/log.ts`), ⚠ and
    //   ⚠ adding one for a startup line is wider than this change.
    logger.warn("the browser's files have not been built — run `npm run build`", { missing });
    throw new Error("the browser's files have not been built — run `npm run build`");
  }

  const trustedSourceHeader = process.env["TRUSTED_SOURCE_HEADER"] ?? "";
  if (trustedSourceHeader === "") {
    logger.warn("TRUSTED_SOURCE_HEADER is not set — the caller's address comes from the socket");
    logger.warn("behind a tunnel that makes every caller look like one source");
  }
  const store = createRoomStore();
  const ctx: Context = {
    store,
    baseUrl,
    secret: joinTokenSecret(),
    hub: createHub(),
    knockRejections: createKnockRejectionCounter(),
    knocks: createKnocks({
      newId: () => randomToken(16),
      // ⚠ Asked, never reached into. ⚠ The door does not get to browse the rooms.
      roomExists: (id) => store.get(id) !== undefined,
    }),
    trustedSourceHeader,
  };
  /**
   * ⚠⚠ **The Node adapter, ⚠ and the only Node-shaped code left in the request path.**
   *
   * ⚠ **`handle` speaks `Request` and `Response`** (`docs/adr/0015`) — ⚠ **so a Worker can call
   * the same function.** ⚠ **This turns Node's objects into those and back.**
   */
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", baseUrl);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      // ⚠ The socket's address, put where `handle` can read it. ⚠ A `Request` does not carry one,
      //   ⚠ and inventing one later would be worse than having none (`sourceOf`).
      if (trustedSourceHeader === "" && req.socket.remoteAddress) {
        headers.set(NODE_SOURCE_HEADER, req.socket.remoteAddress);
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(url, {
        method: req.method ?? "GET",
        headers,
        ...(hasBody ? { body: req as unknown as ReadableStream, duplex: "half" } : {}),
      } as RequestInit);
      const answer = await handle(ctx, request);
      res.writeHead(answer.status, Object.fromEntries(answer.headers));
      res.end(await answer.text());
    })().catch(() => {
      // ⚠ A rejected promise here would take the process down and end every live room.
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "something went wrong here" }));
    });
  });
  // ⚠ The same process, the same port (`docs/adr/0002`). ⚠ Only HTTP and WebSocket go through
  //   ⚠ the tunnel, and media goes through neither (`docs/adr/0003`).
  // ⚠ Kept, because an upgraded socket is no longer one of the HTTP server's connections —
  //   ⚠ `handleUpgrade` detaches it, so `closeAllConnections()` does not reach it.
  //   ⚠ Without a handle on this, "stop answering" cannot be asked for, and the one behaviour
  //   ⚠ that depends on it (`docs/adr/0010`: the call survives us) cannot be checked.
  const wss = attachSignaling(server, {
    hub: ctx.hub,
    secret: ctx.secret,
    knocks: ctx.knocks,
    touch: (roomId) => ctx.store.touch(roomId),
  });

  // ⚠ Rooms nobody is in do not linger. ⚠ `store.get` already refuses an expired one, so this is
  //   ⚠ about memory and about hanging up, not about correctness of the answer.
  // ⚠ Anyone still holding a socket for a swept room is closed with the same code as a host
  //   ⚠ closing it: ⚠ from where they sit, the room is over either way, and inventing a third
  //   ⚠ thing to say would be telling them something we do not know.
  const sweeper = setInterval(() => {
    for (const roomId of ctx.store.sweep()) {
      ctx.hub.closeRoom(roomId, CLOSE_ROOM_CLOSED, "this room was left open and has expired");
      logger.info("a room expired", { roomId });
    }
  }, SWEEP_INTERVAL_MS);
  // ⚠ Never hold the process open for the sweeper.
  sweeper.unref?.();
  server.listen(port, () => {
    logger.info("kagima is listening", { baseUrl, port });
    logger.info("rooms live in this process only — stopping it ends every room");
  });

  return {
    server,
    close() {
      for (const client of wss.clients) client.terminate();
      server.closeAllConnections();
      server.close();
    },
  };
};

if (process.argv[1] && import.meta.filename === process.argv[1]) startServer();
