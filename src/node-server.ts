// ⚠⚠ **The Node listener.** ⚠ **Everything here exists because this process has `node:http`.**
//
// ```text
// server.ts       ⚠ handle(ctx, Request) -> Response      ⚠ platform-free
// node-server.ts  ⚠ a socket, the environment, an adapter ← ⚠ this file
// ```
//
// ⚠ **A Worker replaces this file and no other** (`docs/adr/0015`) — ⚠ **`fetch(request, env)`
//   ⚠ in place of `createServer`, ⚠ and bindings in place of `process.env`.**
// ⚠ **That is the whole reason for the split** (`CLAUDE.md` § 3: ⚠ **never two implementations of
//   ⚠ the same question**).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isGated, isSignIn, mayPass } from "./gate.ts";
import { createKnockRejectionCounter, createKnocks } from "./knock/knocks.ts";
import { logger } from "./log.ts";
import { randomToken } from "./random.ts";
import { createRoomStore } from "./room/store.ts";
import { type Context, handle, NODE_SOURCE_HEADER } from "./server.ts";
import { attachSignaling, CLOSE_ROOM_CLOSED } from "./signaling/attach.ts";
import { createHub } from "./signaling/hub.ts";
import { missingServedFiles, serveStatic } from "./static.ts";

/**
 * ⚠ **How often expired rooms are collected.**
 *
 * ⚠ **Not the same as how long a room lives** (`ROOM_IDLE_MS`). ⚠ **A room is unreachable the
 * moment it expires; ⚠ this is only how long the memory and the sockets hang around after.**
 */
const SWEEP_INTERVAL_MS = 60_000;

const DEFAULT_PORT = 8787;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;

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
  /**
   * ⚠ **For checks that would otherwise have to wait out a real heartbeat.**
   *
   * ⚠ **Not read from the environment** — ⚠ **a value that can be set from outside the process is
   * a value somebody sets in production by accident** (`docs/adr/0011` paid for that lesson).
   */
  options: { readonly heartbeatMs?: number } = {},
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

  // ⚠⚠ **A door before the door** (`docs/adr/0024`). ⚠ **Absent means there is no gate** —
  //   ⚠ **said out loud rather than passed silently** (`.claude/rules/security.md` § 6).
  // ⚠⚠ **The gate exists exactly when signing in does** (`docs/adr/0030`).
  //   ⚠ **`ROOM_GATE` is gone: ⚠ a shared secret handed round said nothing about who used it.**
  const googleId = process.env["GOOGLE_CLIENT_ID"];
  const googleSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const google =
    googleId !== undefined && googleId !== "" && googleSecret !== undefined && googleSecret !== ""
      ? {
          clientId: googleId,
          clientSecret: googleSecret,
          redirectUri: `${baseUrl}/auth/google/callback`,
        }
      : null;
  const signingSecret = joinTokenSecret();
  const roomGate = google === null ? undefined : signingSecret;
  if (roomGate === undefined || roomGate === "") {
    logger.warn("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — there is no sign-in");
    logger.warn("so anybody who can reach this can make a room");
  }
  if (trustedSourceHeader === "") {
    logger.warn("TRUSTED_SOURCE_HEADER is not set — the caller's address comes from the socket");
    logger.warn("behind a tunnel that makes every caller look like one source");
  }
  const store = createRoomStore();
  const ctx: Context = {
    store,
    // ⚠ Node's answer to "the browser's own files": ⚠ read them off disk (`docs/adr/0016`).
    asset: serveStatic,
    baseUrl,
    secret: signingSecret,
    google,
    ...(process.env["ALLOWED_EMAILS"] === undefined
      ? {}
      : { allowList: process.env["ALLOWED_EMAILS"] }),
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
      // ⚠⚠ **A door before the door** (`docs/adr/0024`). ⚠ **One implementation, ⚠ two runtimes**
      //   (`CLAUDE.md` § 3) — ⚠ **the same `src/gate.ts` the Worker uses.**
      const path = new URL(request.url).pathname;
      // ⚠ Signing in is outside the gate (`src/gate.ts`) — ⚠ a gate in front of its own door
      //   ⚠ lets nobody through.
      const gated =
        !isSignIn(path) && isGated(request.method, path) ? await mayPass(request, roomGate) : null;
      const answer = gated ?? (await handle(ctx, request));
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
    knockRejections: ctx.knockRejections,
    touch: (roomId) => ctx.store.touch(roomId),
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
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
