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

/**
 * ⚠⚠ **What the page can say about the heartbeat it is answering** (`docs/adr/0020`).
 *
 * ⚠ **Held here rather than in a page, ⚠ because the answering happens here.**
 * ⚠ **It is per browsing context, ⚠ not per socket** — ⚠ **the question being measured is
 * "was this page running", ⚠ and a page outlives its sockets.**
 *
 * ⚠ **Times are milliseconds since the page loaded**, ⚠ not wall clock — ⚠ **nothing here is a
 * date, ⚠ and nothing here identifies anybody.**
 */
export type HeartbeatObservation = {
  /** ⚠ How many pings this page has answered. */
  readonly answered: number;
  /** ⚠ When the last one was answered. ⚠ `null` when none has been. */
  readonly lastAnsweredAt: number | null;
  /** ⚠ The ping number last echoed back. */
  readonly lastNumber: number | null;
};

const heartbeat = (() => {
  let answered = 0;
  let lastAnsweredAt: number | null = null;
  let lastNumber: number | null = null;
  return {
    answered(n: number) {
      answered += 1;
      lastAnsweredAt = Math.round(performance.now());
      lastNumber = n;
    },
    read: (): HeartbeatObservation => ({ answered, lastAnsweredAt, lastNumber }),
  };
})();

/** ⚠ **Read by the diagnostics panel**, ⚠ so the Owner can copy it off a real device. */
export const heartbeatObservation = (): HeartbeatObservation => heartbeat.read();

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

      // ⚠⚠ **The heartbeat, answered here and nowhere else** (`docs/adr/0020`).
      //
      // ⚠ **The pages never see it.** ⚠ **Two pages remembering to answer is two places to
      //   ⚠ forget** — ⚠ **and the one that forgets would be read as a dead page.**
      // ⚠ **`n` is echoed back, ⚠ so the answer says "this arrived here" rather than
      //   ⚠ "something is running".**
      // ⚠ **This is what a Worker will rely on** — ⚠ **it has no protocol ping** (`docs/adr/0015`).
      //   ⚠ **Today it decides nothing; ⚠ the server is only watching.**
      if (message.type === "ping") {
        const n = (parsed as { n?: unknown }).n;
        if (typeof n === "number") {
          socket.send(JSON.stringify({ type: "pong", n }));
          heartbeat.answered(n);
        }
        return;
      }
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
