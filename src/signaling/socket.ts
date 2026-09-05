// ⚠⚠ **The one socket shape kagima's signalling talks to.**
//
// ⚠ **`ws` on Node and `WebSocketPair` in a Worker are not the same object** (`docs/adr/0015`).
// ⚠ **Rather than let the session know which one it has, ⚠ each platform hands it this.**
//
// ⚠ **Nothing here imports a platform.** ⚠ **That is the whole point, ⚠ and `test/room.test.ts`
//   ⚠ already fails on a `node:` import anywhere under `src/`.**

/** What a session is told by the socket. ⚠ Registered once, when it opens. */
export type SocketHandlers = {
  /** ⚠ A text frame. ⚠ Already decoded — ⚠ the adapter owns how bytes became a string. */
  readonly onText: (data: string) => void;
  /**
   * ⚠ **A binary frame arrived.** ⚠ **The content is deliberately not passed on**:
   * ⚠ **signalling is text, ⚠ and the session's only answer is to hang up.**
   */
  readonly onBinary: () => void;
  /** ⚠ **The other end answered a `ping`.** ⚠ See `ping` below for what this costs. */
  readonly onPong: () => void;
  readonly onClose: () => void;
};

export type SignalingSocket = {
  readonly send: (line: string) => void;
  readonly close: (code: number, reason: string) => void;
  /**
   * ⚠⚠ **A protocol-level ping frame, ⚠ where the platform has one.**
   *
   * ⚠ **`ws` exposes it.** ⚠ **Whether a Worker's server-side WebSocket does has NOT been
   * measured here** — ⚠ **wrangler is not in this repository yet, ⚠ and the question is
   * `docs/adr/0015`'s to settle, not this file's.**
   * ⚠ **Saying "it does not" would be a guess dressed as a measurement**
   * (`.claude/rules/evidence.md`).
   *
   * ⚠ **What is true either way: ⚠ this is the seam the answer lands on.**
   * ⚠ **An adapter with no protocol ping has to keep the promise some other way — ⚠ and it must
   * not quietly do nothing**, ⚠ **because then a silent socket is never noticed and the room
   * holds a slot for somebody who left.**
   */
  readonly ping: () => void;
  readonly on: (handlers: SocketHandlers) => void;
};
