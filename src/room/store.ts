// Where rooms live, and the fact that they live nowhere else.
//
// ⚠ **`docs/adr/0005-keep-room-state-in-process-memory-only.md`**: ⚠ **no database, no disk,
//   ⚠ no external cache.** ⚠ **What is not held cannot leak** — ⚠ **not from a backup, not from a
//   ⚠ snapshot, not from a log shipper.** ⚠ **That is a property of the structure, not of care.**
//
// ⚠ **A restart ends every live room. ⚠ That is the specification, not a defect.**
//
// ⚠ **`test/room.test.ts` asserts that nothing under `src/` imports a persistence module.**
//   ⚠ **That check defends "our process does not write it down".**
//   ⚠ **It does NOT show that nothing is left in memory** — ⚠ **those are different claims and
//   ⚠ only the first one has a check** (`.claude/rules/evidence.md`).
import type { Passphrase } from "./types.ts";

export type Room = {
  readonly id: string;
  /** ⚠ **Held to be compared against, and never logged** (`.claude/rules/security.md` § 2). */
  readonly passphrase: Passphrase;
  /**
   * ⚠ **The one thing only the host is given.**
   *
   * ⚠ **Not a role and not an account** — ⚠ **a capability, handed over once at creation and
   * never again** (`docs/PRODUCT.md` § 4 forbids accounts; ⚠ **this identifies nobody and dies
   * with the room**).
   * ⚠ **It exists because closing a room is the host's, and the server has no other way to tell
   * the two participants apart.**
   */
  readonly hostKey: string;
  readonly createdAt: number;
};

export type RoomStore = {
  /** ⚠ **Refuses to overwrite.** ⚠ Returns false when the id is taken, so the caller can retry. */
  add(room: Room): boolean;
  get(id: string): Room | undefined;
  /** ⚠ **Drops the room and everything held with it.** ⚠ Returns whether there was one. */
  close(id: string): boolean;
  /** ⚠ **For tests and for kagima#11.** ⚠ Never exposed over HTTP — it is a fact about the host. */
  size(): number;
};

/**
 * ⚠ **A factory, not a module-level singleton.**
 *
 * ⚠ **Grounds: a singleton makes "a fresh process has no rooms" untestable without spawning one.**
 * ⚠ **With a factory, that claim is one line, and it is the claim `docs/adr/0005` rests on.**
 */
export const createRoomStore = (): RoomStore => {
  // ⚠ The only place a room exists. ⚠ It dies with the process, on purpose.
  const rooms = new Map<string, Room>();

  return {
    add(room) {
      // ⚠ Never overwrite. ⚠ Silently replacing a room would hand a second host a live room's id.
      if (rooms.has(room.id)) return false;
      rooms.set(room.id, room);
      return true;
    },
    get(id) {
      return rooms.get(id);
    },
    close(id) {
      return rooms.delete(id);
    },
    size() {
      return rooms.size;
    },
  };
};
