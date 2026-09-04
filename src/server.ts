// The one process (`docs/adr/0002`). ⚠ **HTTP now; the WebSocket signalling joins it in kagima#6.**
//
// ⚠ **What this serves is who may join.** ⚠ **It never carries what they say** (`CLAUDE.md` § 3).
// ⚠ **No media path reaches this file, and `docs/adr/0001` says none ever will.**
//
// ## Usage
//
//   npm run dev            # PORT and PUBLIC_BASE_URL from the environment, with defaults
//
// ⚠ **Every room dies with this process.** ⚠ **That is the specification** (`docs/adr/0005`).
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRoom } from "./room/create-room.ts";
import { type RoomStore, createRoomStore } from "./room/store.ts";

/** ⚠ **Defaults for running it locally.** ⚠ Neither is a secret, so neither belongs in `.env.example`. */
const DEFAULT_PORT = 8787;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;

// ⚠ A body we will not read, so nothing unbounded is buffered from an unauthenticated caller.
//   ⚠ Room creation takes no input at all, so this is a hard zero rather than a limit.
const send = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    // ⚠ Never let a room-creation response sit in a cache. ⚠ It carries the passphrase.
    "cache-control": "no-store",
    // ⚠ The response is JSON and is never rendered; say so, so nothing sniffs it into HTML.
    "x-content-type-options": "nosniff",
  });
  res.end(text);
};

/**
 * ⚠ **Every outcome this endpoint can produce, and the ones it cannot**
 * (`.claude/rules/evidence.md` § Outcomes are not one outcome).
 *
 * ```text
 * accepted and handled     a room was created
 * ⚠ we have not implemented it yet   any other path or method  -> 404 / 405
 * ⚠ could not be satisfied  no free id in MAX_ID_ATTEMPTS      -> 503
 * ```
 *
 * ⚠ **Malformed cannot occur**: ⚠ **the request carries no body and no parameters, so there is
 * nothing that can be malformed.**
 * ⚠ **Well-formed but unsupported cannot occur** for the same reason.
 * ⚠ **A timer expiring cannot occur**: ⚠ **nothing here waits on anything.**
 */
export const handle = (
  store: RoomStore,
  baseUrl: string,
  req: IncomingMessage,
  res: ServerResponse,
): void => {
  const url = new URL(req.url ?? "/", baseUrl);

  if (url.pathname !== "/api/rooms") {
    // ⚠ "not implemented yet" rather than a bare 404 shape (`CLAUDE.md` § 4-1):
    //   ⚠ say what exists, not only what does not.
    send(res, 404, { error: "no such endpoint", endpoints: ["POST /api/rooms"] });
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    send(res, 405, { error: "rooms are created with POST" });
    return;
  }

  try {
    const { room, shareUrl } = createRoom(store, baseUrl);
    // ⚠ The passphrase is returned here and nowhere else, ever.
    //   ⚠ The host cannot learn it any other way, and after this the server only compares it
    //   ⚠ (`docs/adr/0004`). ⚠ It is NOT in shareUrl — see room-id.ts.
    send(res, 201, { roomId: room.id, shareUrl, passphrase: room.passphrase });
  } catch {
    // ⚠ Nothing from the error reaches the response or a log line.
    //   ⚠ `log(err)` with a room attached is exactly how the passphrase escapes
    //   ⚠ (`.claude/rules/security.md` § 2). ⚠ kagima#12 makes that a wall rather than care.
    send(res, 503, { error: "could not create a room just now, please try again" });
  }
};

export const startServer = (
  port = Number(process.env["PORT"] ?? DEFAULT_PORT),
  baseUrl = process.env["PUBLIC_BASE_URL"] ?? DEFAULT_BASE_URL,
) => {
  const store = createRoomStore();
  const server = createServer((req, res) => handle(store, baseUrl, req, res));
  server.listen(port, () => {
    // ⚠ A sentence saying what happened and what to do with it (`CLAUDE.md` § 4).
    console.log(`kagima is listening on ${baseUrl} (port ${port})`);
    console.log("⚠ rooms live in this process only — stopping it ends every room");
  });
  return server;
};

// ⚠ Only when run directly. ⚠ Importing this file for a test must not open a socket.
if (process.argv[1] && import.meta.filename === process.argv[1]) startServer();
