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

/**
 * ⚠ **How long a room survives with nobody connected to it.**
 *
 * ⚠ **The clock runs from the last moment somebody was in it** — ⚠ **or from creation, for a room
 * nobody ever joined.** ⚠ **It is not a limit on how long a call may last.**
 *
 * ⚠ **Twenty minutes is long enough for the host to make a room, find the other person, and say
 * a passphrase down a phone line** — ⚠ **and short enough that a link left in a chat window is
 * dead by the time anyone scrolls back to it.**
 * ⚠ **Nobody has measured how long that actually takes.** ⚠ **This is a chosen value, not a
 * measured one, and it is said that way** (`.claude/rules/evidence.md`).
 */
export const ROOM_IDLE_MS = 20 * 60 * 1000;

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
  /**
   * ⚠ **The last moment this room was known to matter to somebody.**
   *
   * ⚠ **Moved forward while anyone is connected.** ⚠ **A room expires `ROOM_IDLE_MS` after this,
   * ⚠ not after it was made** — ⚠ **otherwise a long call would be cut off by its own room.**
   */
  readonly lastSeenAt: number;
};

export type RoomStore = {
  /** ⚠ **Refuses to overwrite.** ⚠ Returns false when the id is taken, so the caller can retry. */
  add(room: Room): boolean;
  get(id: string): Room | undefined;
  /** ⚠ **Drops the room and everything held with it.** ⚠ Returns whether there was one. */
  close(id: string): boolean;
  /** ⚠ **For tests and for the sweeper.** ⚠ Never exposed over HTTP — it is a fact about the host. */
  size(): number;
  /**
   * ⚠ **Say that somebody is still there.**
   *
   * ⚠ **Called while a room has anyone connected.** ⚠ **Without it a room dies mid-call**, ⚠ and
   * that failure would look like the network rather than like us.
   */
  touch(id: string): void;
  /**
   * ⚠ **Drop every room whose idle time has run out, and say which.**
   *
   * ⚠ **Returns the ids so the caller can hang up on anyone still holding a socket for them** —
   * ⚠ **the store knows nothing about sockets and must not learn.**
   */
  sweep(): string[];
};

/**
 * ⚠ **A factory, not a module-level singleton.**
 *
 * ⚠ **Grounds: a singleton makes "a fresh process has no rooms" untestable without spawning one.**
 * ⚠ **With a factory, that claim is one line, and it is the claim `docs/adr/0005` rests on.**
 */
export type RoomStoreOptions = {
  readonly now?: () => number;
  readonly idleMs?: number;
};

export const createRoomStore = (options: RoomStoreOptions = {}): RoomStore => {
  // ⚠ The only place a room exists. ⚠ It dies with the process, on purpose.
  const rooms = new Map<string, Room>();
  // ⚠ Injected so a test can step past an expiry instead of waiting for one.
  //   ⚠ A test that waits twenty minutes is a test nobody runs.
  const now = options.now ?? Date.now;
  const idleMs = options.idleMs ?? ROOM_IDLE_MS;

  const hasExpired = (room: Room): boolean => now() - room.lastSeenAt >= idleMs;

  return {
    add(room) {
      // ⚠ Never overwrite. ⚠ Silently replacing a room would hand a second host a live room's id.
      if (rooms.has(room.id)) return false;
      rooms.set(room.id, room);
      return true;
    },
    get(id) {
      const room = rooms.get(id);
      if (room === undefined) return undefined;
      // ⚠ Expiry is answered here as well as swept, so a room is never briefly reachable in the
      //   ⚠ window between running out and being collected.
      //   ⚠ `docs/adr/0004`: an expired room answers exactly like one that never existed, and
      //   ⚠ that is only true if this returns nothing the moment it runs out.
      if (hasExpired(room)) {
        rooms.delete(id);
        return undefined;
      }
      return room;
    },
    close(id) {
      return rooms.delete(id);
    },
    size() {
      return rooms.size;
    },

    touch(id) {
      const room = rooms.get(id);
      if (room === undefined) return;
      rooms.set(id, { ...room, lastSeenAt: now() });
    },

    sweep() {
      const gone: string[] = [];
      for (const [id, room] of rooms) {
        if (!hasExpired(room)) continue;
        rooms.delete(id);
        gone.push(id);
      }
      return gone;
    },
  };
};
