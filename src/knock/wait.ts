// ⚠⚠ **The waiting socket** (`docs/adr/0028`, kagima#78, kagima#99).
//
// ⚠ **This replaces a `GET` that was read every two seconds.** ⚠ **Two things came out of that
//   ⚠ read, ⚠ and both of them are why this file exists:**
//
// ```text
// kagima#99  ⚠ the knock id was in the path, ⚠ so it was in logs we do not run
// kagima#78  ⚠ 1,800 requests/hour per waiting person, ⚠ all of them at one Durable Object
// ```
//
// ## ⚠ What this file must never do
//
// ⚠ **It must never say anything that separates the four cases** — ⚠ **a room that does not
//   ⚠ exist, ⚠ a Host who has not answered, ⚠ a knock dropped at the cap, ⚠ a watcher dropped at
//   ⚠ the cap** (`src/knock/knocks.ts`, `.claude/rules/security.md` § 3).
// ⚠ **All four are one behaviour here: ⚠ the socket is accepted, ⚠ and nothing is sent.**
// ⚠ **Refusing the handshake for any of them would answer "does this room exist?" for free.**
//
// ⚠ **Nothing here reaches for a platform.** ⚠ **`attach.ts` and `room-object.ts` bring their own
//   ⚠ socket** — ⚠ **that is the whole reason this is not written twice** (`CLAUDE.md` § 3).
import { type KnockEnding, knockEndingLine } from "../signaling/protocol.ts";
import type { KnockRejection, Knocks } from "./knocks.ts";

/**
 * ⚠ **The room this handshake is for**, ⚠ **or `null` when the path is not a waiting socket's.**
 *
 * ⚠ **Deliberately shaped like `roomIdFromPath` in `../signaling/authorize.ts`** — ⚠ **the same
 * question about a different door.** ⚠ **The knock id is NOT in here and never will be**
 * (kagima#99): ⚠ **it arrives in `sec-websocket-protocol`.**
 */
export const roomIdFromWaitPath = (url: string): string | null => {
  const m = /^\/api\/rooms\/([^/?]+)\/wait(?:\?|$)/.exec(url);
  return m ? decodeURIComponent(m[1] as string) : null;
};

/** ⚠ **The two calls this needs of a socket.** ⚠ **Nothing is ever read from one.** */
export type WaitSocket = {
  send(line: string): void;
  close(code?: number, reason?: string): void;
};

/**
 * ⚠ **Closed the same way whatever happened.**
 *
 * ⚠ **The ending is in the message; ⚠ the code carries nothing.** ⚠ **A code that differed
 * between `admitted` and `over` would be a second channel saying the same thing, ⚠ and a second
 * channel is a second thing to keep identical.**
 */
export const CLOSE_KNOCK_DECIDED = 1000;

/**
 * ⚠⚠ **Wait, ⚠ and be told once.**
 *
 * ⚠ **The socket is already accepted when this is called.** ⚠ **That is deliberate: ⚠ acceptance
 * happens before anything is known about the room, ⚠ so acceptance cannot depend on it.**
 *
 * ⚠ **`refused` is for counting and never reaches the caller** (`.claude/rules/evidence.md`:
 * ⚠ **an uncounted rejection is indistinguishable from a request that never arrived**).
 */
export const openWait = (
  knocks: Knocks,
  roomId: string,
  knockId: string,
  socket: WaitSocket,
): { stop: () => void; refused: KnockRejection | null } =>
  knocks.watch(roomId, knockId, (ending: KnockEnding) => {
    // ⚠ One line, ⚠ then closed. ⚠ Nothing else is ever sent on this socket, ⚠ in any case.
    socket.send(knockEndingLine(ending));
    socket.close(CLOSE_KNOCK_DECIDED, "");
  });
