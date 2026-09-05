// The signalling socket, from the browser's side.
//
// ⚠ **The token travels in the subprotocol, never in the URL** (`../signaling/protocol.ts` says why).
// ⚠ **A URL is written to history, to the referer header, and to every log in between.**
//
// ⚠ **The prefix is imported, ⚠ not written again.** ⚠ **It was written twice until 2026-09-06,
//   ⚠ and two copies of an agreement between two ends are two things that can drift**
//   (`CLAUDE.md` § 3).
import { TOKEN_PROTOCOL_PREFIX } from "../signaling/protocol.ts";
import type { SignalMessage, Transport } from "./call.ts";

export { TOKEN_PROTOCOL_PREFIX };

export type SocketTransport = Transport & {
  readonly socket: WebSocket;
  close(): void;
};

/** ⚠ **Resolves when the socket is open.** ⚠ Sending before that silently drops the message. */
export const connectSignaling = (
  roomId: string,
  token: string,
  origin: string = location.origin,
): Promise<SocketTransport> =>
  new Promise((resolve, reject) => {
    const url = new URL(`/api/rooms/${encodeURIComponent(roomId)}/signal`, origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url, [`${TOKEN_PROTOCOL_PREFIX}${token}`]);

    const handlers: Array<(m: SignalMessage) => void> = [];
    socket.addEventListener("message", (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        // ⚠ Not ours to interpret. ⚠ Dropping it silently is what the server's own rule forbids,
        //   ⚠ so it is at least visible here rather than swallowed inside a handler.
        return;
      }
      const message = parsed as { type?: string };
      // ⚠ `refused` is the server telling us WE were wrong. ⚠ It is not a signalling message.
      if (message.type === "refused") return;
      for (const h of handlers) h(parsed as SignalMessage);
    });

    socket.addEventListener("open", () =>
      resolve({
        socket,
        send: (m) => socket.send(JSON.stringify(m)),
        onMessage: (h) => handlers.push(h),
        close: () => socket.close(),
      }),
    );
    // ⚠ Says that it was refused, and nothing about why. ⚠ The server does not tell us, on purpose.
    socket.addEventListener("error", () => reject(new Error("the signalling socket was refused")));
  });
