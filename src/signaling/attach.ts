// ⚠⚠ **The Node adapter.** ⚠ **Everything here exists because `ws` and `node:http` are what this
//   ⚠ process has, ⚠ and nothing here decides anything.**
//
// ```text
// authorize.ts   ⚠ whether a handshake becomes a way in     ⚠ platform-free
// session.ts     ⚠ what one connected participant does      ⚠ platform-free
// socket.ts      ⚠ the shape both platforms reduce to       ⚠ platform-free
// attach.ts      ⚠ ws + node:http, and nothing else         ← ⚠ this file
// ```
//
// ⚠ **A Worker replaces this file and no other** (`docs/adr/0015`) — ⚠ **`WebSocketPair` in place
//   ⚠ of `ws`, ⚠ a `Response` with `status: 101` in place of the upgrade dance.**
// ⚠ **That is the whole reason for the split** (`CLAUDE.md` § 3: ⚠ **never two implementations of
//   ⚠ the same question**).
//
// ⚠ **`ws` carries the frames and nothing else** (`docs/adr/0009`).
import type { Server } from "node:http";
import { type WebSocket, WebSocketServer } from "ws";
import type { KnockRejectionCounter } from "../knock/knocks.ts";
import { openWait, roomIdFromWaitPath } from "../knock/wait.ts";
import { authorizeUpgrade, valueFromProtocols } from "./authorize.ts";
import { KNOCK_PROTOCOL_PREFIX, TOKEN_PROTOCOL_PREFIX } from "./protocol.ts";
import { createSessions, MAX_MESSAGE_BYTES, type SessionOptions } from "./session.ts";
import type { SignalingSocket } from "./socket.ts";

export type SignalingOptions = SessionOptions & {
  /**
   * ⚠ **Why a waiting socket was not registered** (`docs/adr/0028`).
   * ⚠ **Counted apart, ⚠ answered alike** — ⚠ **the socket is accepted either way.**
   */
  readonly knockRejections?: KnockRejectionCounter;
};

// ⚠ The close codes and the subprotocol moved to `./protocol.ts`, ⚠ where the browser can also
//   ⚠ read them. ⚠ Re-exported here so a call site that means "the signalling protocol" keeps
//   ⚠ working — ⚠ one definition, two names for the same door.
export {
  CLOSE_BAD_MESSAGE,
  CLOSE_ROOM_CLOSED,
  CLOSE_ROOM_FULL,
  CLOSE_SILENT,
  CLOSE_UNAUTHORIZED,
  TOKEN_PROTOCOL_PREFIX,
} from "./protocol.ts";
export { HEARTBEAT_MS, MISSED_PONGS_ALLOWED } from "./session.ts";

/**
 * ⚠ **One `ws` socket, seen as the one shape signalling talks to** (`./socket.ts`).
 *
 * ⚠ **Every difference between `ws` and any other WebSocket lives in this function.**
 * ⚠ **`ws` gives `message` a `Buffer` and a flag; ⚠ the session is handed text, or told it was
 * binary and nothing else.**
 */
const asSignalingSocket = (ws: WebSocket): SignalingSocket => ({
  send: (line) => ws.send(line),
  close: (code, reason) => ws.close(code, reason),
  on: (handlers) => {
    ws.on("close", handlers.onClose);
    ws.on("message", (data, isBinary) => {
      // ⚠ Binary is answered without the content ever being decoded (`./socket.ts`).
      if (isBinary) handlers.onBinary();
      else handlers.onText(data.toString());
    });
  },
});

export const attachSignaling = (server: Server, options: SignalingOptions): WebSocketServer => {
  const now = options.now ?? Date.now;
  const sessions = createSessions(options);

  // ⚠ `noServer`, so the upgrade is ours to accept or refuse before `ws` sees it.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    // ⚠ The subprotocol must be echoed back or a browser closes the connection itself.
    //   ⚠ Echoed verbatim, which means the token appears in the response header too — ⚠ only to
    //   ⚠ the client that just sent it, over the same TLS connection.
    handleProtocols: (protocols) =>
      [...protocols].find(
        (p) => p.startsWith(TOKEN_PROTOCOL_PREFIX) || p.startsWith(KNOCK_PROTOCOL_PREFIX),
      ) ?? false,
  });

  server.on("upgrade", (req, socket, head) => {
    // ⚠ One answer for every refusal, exactly as the join endpoint does
    //   (`.claude/rules/security.md` § 3). ⚠ The reason never leaves `authorizeUpgrade`.
    const refuse = (): void => {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    };

    // ⚠⚠ **The waiting socket, ⚠ which is not a way in** (`docs/adr/0028`, `../knock/wait.ts`).
    //
    // ⚠ **It is accepted before anything is known about the room, ⚠ and that is the point:**
    //   ⚠ **a room that does not exist, ⚠ a Host who has not answered, ⚠ a knock dropped at the
    //   ⚠ cap and a watcher dropped at the cap are one behaviour** — ⚠ **accepted, ⚠ silent**
    //   (`.claude/rules/security.md` § 3).
    // ⚠ **It carries no token and opens no room.** ⚠ **All it can ever receive is one line.**
    const waitingFor = roomIdFromWaitPath(req.url ?? "");
    if (waitingFor !== null) {
      const knockId = valueFromProtocols(
        req.headers["sec-websocket-protocol"],
        KNOCK_PROTOCOL_PREFIX,
      );
      const knocks = options.knocks;
      // ⚠ Without a knock id there is nothing to watch. ⚠ Refused like any other handshake that
      //   ⚠ is not ours — ⚠ this one says nothing about any room, ⚠ only about the request.
      if (knockId === null || knocks === undefined) return refuse();
      wss.handleUpgrade(req, socket, head, (ws) => {
        const { stop, refused } = openWait(knocks, waitingFor, knockId, {
          send: (line) => ws.send(line),
          close: (code, reason) => ws.close(code, reason),
        });
        if (refused !== null) options.knockRejections?.record(refused);
        // ⚠ Nothing is ever read off this socket. ⚠ Closing is the only event it has.
        ws.on("close", stop);
        ws.on("error", stop);
      });
      return;
    }

    // ⚠ `authorizeUpgrade` never rejects, ⚠ so there is no path here that leaves a socket open
    //   ⚠ with nobody owning it. ⚠ The `catch` is belt and braces over `handleUpgrade` itself.
    void authorizeUpgrade(
      req.url ?? "",
      req.headers["sec-websocket-protocol"],
      options.secret,
      now(),
    )
      .then((checked) => {
        if (!checked.ok) return refuse();
        wss.handleUpgrade(req, socket, head, (ws) =>
          sessions.open(asSignalingSocket(ws), checked.roomId, checked.sessionId, checked.role),
        );
      })
      .catch(() => refuse());
  });

  return wss;
};
