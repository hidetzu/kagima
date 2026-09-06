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
  readonly onClose: () => void;
};

export type SignalingSocket = {
  readonly send: (line: string) => void;
  readonly close: (code: number, reason: string) => void;
  readonly on: (handlers: SocketHandlers) => void;
};
