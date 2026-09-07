// ⚠⚠ **Who is waiting at the door, and what the Host decided.**
//
// ⚠ **kagima's entry is "did the Host invite you", not "do you know a secret"**
//   (`docs/PRODUCT.md` § 1, `docs/adr/0017`).
//
// ## ⚠ What must never be distinguishable from outside
//
// ```text
// ⚠ a room that does not exist
// ⚠ a room whose Host has not answered yet
// ⚠ a knock that was dropped because too many are already waiting
// ⚠ a watcher dropped because too many are already watching   ⚠ docs/adr/0028
// ```
//
// ⚠ **All four look like "still waiting"** — ⚠ **and since `docs/adr/0028` that means a socket
//   ⚠ that is simply silent.** ⚠ **Anything else answers "does this room exist?"
//   ⚠ for free** (`.claude/rules/security.md` § 3), ⚠ **and the second one would also say
//   ⚠ whether the Host is at their desk.**
//
// ## ⚠⚠ What `over` does reveal, ⚠ said plainly
//
// ⚠ **`over` can only reach a knock that was actually registered** — ⚠ **which means the room
//   ⚠ existed and the caller had a real URL.** ⚠ **So `over` tells that caller "this URL was real".**
//
// ⚠ **What that does NOT allow: ⚠ discovering rooms by probing.** ⚠ **A knock at a URL nobody
//   ⚠ minted reads `waiting` for ever and never becomes `over`** — ⚠ **there is no Host to refuse
//   ⚠ it and no room to end.** ⚠ **So the 80-bit URL is still the wall it always was.**
//
// ⚠ **This is a real difference from the passphrase version, ⚠ where a wrong attempt on a real
//   ⚠ room and an attempt on an imaginary one were identical for ever.** ⚠ **It is written here
//   ⚠ rather than left to be discovered** (`docs/adr/0017`).
//
// ## ⚠ The cap is not a product value
//
// ⚠ **kagima is two people** (`docs/PRODUCT.md`). ⚠ **One waiting guest is all that is needed.**
// ⚠ **It is not 1 because one attacker holding the single slot would shut the real guest out** —
//   ⚠ **the same reason a hard room cap was rejected** (`docs/adr/0017`, kagima#56).
// ⚠ **So this number is abuse and memory protection, ⚠ and it is never shown to anyone.**
// ⚠ **It is a chosen value, not a measured one** (`.claude/rules/evidence.md`).

/** ⚠ **Chosen, not measured.** ⚠ Never shown, ⚠ never named to a caller. */
export const MAX_WAITING = 5;

/** ⚠ **What a Guest is told.** ⚠ Three internal outcomes, ⚠ two words. */
export type KnockState =
  /** ⚠ **Also what an unknown room says**, ⚠ and what a dropped knock says. */
  | "waiting"
  | "admitted"
  /** ⚠ **Refused, closed, or the room ended while waiting.** ⚠ One word for all of them. */
  | "over";

export type Knock = {
  readonly nickname: string;
  readonly at: number;
  state: KnockState;
  /** ⚠ **Set only when admitted.** ⚠ The Host's decision is what it is exchanged for. */
  token?: string;
};

/** ⚠ **Why a knock was not taken.** ⚠ For counting only** — ⚠ never reaches a caller. */
export type KnockRejection = "no-such-room" | "too-many-waiting" | "too-many-watching";

// ⚠⚠ **How a knock ends is the wire, ⚠ so it is owned by the file both ends read**
//   (`../signaling/protocol.ts`). ⚠ **Re-exported here so a call site that means "the door's
//   ⚠ answer" keeps reading like one** — ⚠ **one definition, ⚠ two names for the same thing.**
export type { KnockEnding } from "../signaling/protocol.ts";
import type { KnockEnding } from "../signaling/protocol.ts";

/** ⚠ **Told once, ⚠ and then never again.** */
export type KnockWatcher = (ending: KnockEnding) => void;

/**
 * ⚠ **How many may be watching one room's door at once.**
 *
 * ⚠ **Separate from `MAX_WAITING`, ⚠ which counts knocks.** ⚠ **A watcher costs a socket, ⚠ and
 * `security.md` § 3 says unbounded tracking is itself the attack.**
 * ⚠ **Chosen, not measured** (`.claude/rules/evidence.md`). ⚠ **Above `MAX_WAITING` so that a
 * page that reconnects while its old socket is still being cleaned up is not the thing that
 * hits the cap.**
 */
export const MAX_WATCHING = 10;

export type KnockRejectionCounts = Readonly<Record<KnockRejection, number>>;

/**
 * ⚠ **Counted apart, ⚠ answered alike.**
 *
 * ⚠ **An uncounted rejection is indistinguishable from a request that never arrived**
 * (`.claude/rules/evidence.md`). ⚠ **Never served over HTTP** — ⚠ **it is a fact about this
 * host, ⚠ not about any room.**
 */
export type KnockRejectionCounter = {
  record(why: KnockRejection): void;
  counts(): KnockRejectionCounts;
};

export const createKnockRejectionCounter = (): KnockRejectionCounter => {
  const counts: Record<KnockRejection, number> = {
    "no-such-room": 0,
    "too-many-waiting": 0,
    "too-many-watching": 0,
  };
  return {
    record: (why) => {
      counts[why] += 1;
    },
    counts: () => ({ ...counts }),
  };
};

export type Knocks = {
  /**
   * ⚠ **Always returns an id.** ⚠ **Even for a room that does not exist, ⚠ even when full.**
   * ⚠ **The caller cannot tell which happened, ⚠ and that is the point.**
   */
  knock(
    roomId: string,
    nickname: string,
    at: number,
  ): { id: string; refused: KnockRejection | null };
  /**
   * ⚠ **The door's own state.** ⚠ **Unknown ids answer `waiting`**, ⚠ for the reason above.
   *
   * ⚠⚠ **No request path exposes this any more** (`docs/adr/0028`). ⚠ **It was `GET
   * /api/rooms/{roomId}/knock/{knockId}` until 2026-09-07, ⚠ read every two seconds**
   * (kagima#78) ⚠ **with the id in the path** (kagima#99).
   * ⚠ **It stays because it is how the state machine is asked what it holds** — ⚠ **`watch` is
   * the same state pushed rather than pulled, ⚠ off the same record, ⚠ so the two cannot drift.**
   */
  read(roomId: string, id: string): { state: KnockState; token?: string };
  /**
   * ⚠⚠ **Be told when this knock ends, ⚠ instead of asking every two seconds**
   * (`docs/adr/0028`, kagima#78, kagima#99).
   *
   * ⚠ **`notify` is called at most once, ⚠ and never with "waiting".**
   * ⚠ **An unknown room, ⚠ an unknown id, ⚠ a knock that was dropped at the cap, ⚠ and a watcher
   * over the cap all register nothing and are never called** — ⚠ **which is exactly what a Host
   * who has not answered looks like** (`.claude/rules/security.md` § 3).
   * ⚠ **A knock that has already ended fires immediately**, ⚠ so a socket that opens after the
   * Host pressed the button is not left waiting for an event that has been and gone.
   *
   * ⚠ **`refused` is for counting and never reaches the caller**, ⚠ the same shape as `knock`.
   */
  watch(
    roomId: string,
    id: string,
    notify: KnockWatcher,
  ): { stop: () => void; refused: KnockRejection | null };
  /**
   * ⚠⚠ **Put a knock back with the id it already had** (`docs/adr/0028`).
   *
   * ⚠ **A hibernating object loses what it held in memory** (⚠ Cloudflare の公開文書、
   * ⚠ 参照日 2026-09-07), ⚠ **and this project writes no knock to storage** (`docs/adr/0023`).
   * ⚠ **So the waiting socket carries who it is, ⚠ and this is how it says so on the way back.**
   * ⚠ **Never mints an id** — ⚠ **an id that was minted twice would be two knocks for one person.**
   */
  restore(
    roomId: string,
    id: string,
    nickname: string,
    at: number,
  ): { refused: KnockRejection | null };
  /** ⚠ **The Host's decision.** ⚠ Ignores ids it does not know, ⚠ silently. */
  decide(roomId: string, id: string, admit: boolean, token: string | null): void;
  /** ⚠ **Everyone still at the door, oldest first.** ⚠ For the Host's own screen. */
  waiting(roomId: string): ReadonlyArray<{ id: string; nickname: string; at: number }>;
  /** ⚠ **The room ended.** ⚠ Everyone waiting is told the same one word. */
  endRoom(roomId: string): void;
};

export type KnocksOptions = {
  readonly newId: () => string;
  readonly maxWaiting?: number;
  readonly maxWatching?: number;
  /** ⚠ **Which rooms exist.** ⚠ Injected so this file never reaches into the store. */
  readonly roomExists: (roomId: string) => boolean;
};

export const createKnocks = (options: KnocksOptions): Knocks => {
  const maxWaiting = options.maxWaiting ?? MAX_WAITING;
  const maxWatching = options.maxWatching ?? MAX_WATCHING;
  const rooms = new Map<string, Map<string, Knock>>();
  // ⚠ Per room, ⚠ so the cap is per room. ⚠ A watcher holds its own id rather than being keyed
  //   ⚠ by it: ⚠ two sockets may watch one knock, ⚠ and an unknown id must be storable too.
  const watchers = new Map<string, Set<{ id: string; notify: KnockWatcher }>>();

  const endingOf = (k: Knock): KnockEnding | null =>
    k.state === "admitted" && k.token !== undefined
      ? { state: "admitted", token: k.token }
      : k.state === "over"
        ? { state: "over" }
        : null;

  /** ⚠ **Told once, ⚠ then forgotten.** ⚠ A watcher that has fired is not a watcher. */
  const fire = (roomId: string, id: string, ending: KnockEnding): void => {
    const here = watchers.get(roomId);
    if (here === undefined) return;
    for (const w of [...here]) {
      if (w.id !== id) continue;
      here.delete(w);
      w.notify(ending);
    }
  };

  const of = (roomId: string): Map<string, Knock> => {
    const existing = rooms.get(roomId);
    if (existing !== undefined) return existing;
    const fresh = new Map<string, Knock>();
    rooms.set(roomId, fresh);
    return fresh;
  };

  return {
    knock(roomId, nickname, at) {
      const id = options.newId();
      // ⚠⚠ The id is minted before anything is decided, ⚠ so the caller gets the same shape
      //   ⚠ whatever happens next. ⚠ A refusal that returned nothing would be an oracle.
      if (!options.roomExists(roomId)) return { id, refused: "no-such-room" };
      const here = of(roomId);
      const stillWaiting = [...here.values()].filter((k) => k.state === "waiting").length;
      if (stillWaiting >= maxWaiting) return { id, refused: "too-many-waiting" };
      here.set(id, { nickname, at, state: "waiting" });
      return { id, refused: null };
    },

    read(roomId, id) {
      const found = rooms.get(roomId)?.get(id);
      // ⚠ Unknown answers exactly like known-and-waiting.
      if (found === undefined) return { state: "waiting" };
      return found.token === undefined
        ? { state: found.state }
        : { state: found.state, token: found.token };
    },

    watch(roomId, id, notify) {
      const found = rooms.get(roomId)?.get(id);
      if (found !== undefined) {
        const already = endingOf(found);
        // ⚠⚠ It ended before the socket got here. ⚠ Tell it now rather than never.
        if (already !== null) {
          notify(already);
          return { stop: () => {}, refused: null };
        }
      }
      const here = watchers.get(roomId) ?? new Set<{ id: string; notify: KnockWatcher }>();
      watchers.set(roomId, here);
      if (here.size >= maxWatching) {
        // ⚠⚠ Nothing is registered, ⚠ and nothing is said. ⚠ From outside this is a Host who
        //   ⚠ has not answered, ⚠ which is the only answer the door has
        //   (`.claude/rules/security.md` § 3).
        return { stop: () => {}, refused: "too-many-watching" };
      }
      const w = { id, notify };
      here.add(w);
      return {
        stop: () => {
          here.delete(w);
        },
        refused: null,
      };
    },

    restore(roomId, id, nickname, at) {
      if (!options.roomExists(roomId)) return { refused: "no-such-room" };
      const here = of(roomId);
      // ⚠ Already here. ⚠ Two sockets for one knock must not become two people at the door.
      if (here.has(id)) return { refused: null };
      const stillWaiting = [...here.values()].filter((k) => k.state === "waiting").length;
      if (stillWaiting >= maxWaiting) return { refused: "too-many-waiting" };
      here.set(id, { nickname, at, state: "waiting" });
      return { refused: null };
    },

    decide(roomId, id, admit, token) {
      const found = rooms.get(roomId)?.get(id);
      // ⚠ Already decided stays decided. ⚠ A second admit must not mint a second token.
      if (found === undefined || found.state !== "waiting") return;
      if (admit && token !== null) {
        found.state = "admitted";
        found.token = token;
        fire(roomId, id, { state: "admitted", token });
        return;
      }
      found.state = "over";
      fire(roomId, id, { state: "over" });
    },

    waiting(roomId) {
      return [...(rooms.get(roomId) ?? new Map())]
        .filter(([, k]) => k.state === "waiting")
        .map(([id, k]) => ({ id, nickname: k.nickname, at: k.at }))
        .sort((a, b) => a.at - b.at);
    },

    endRoom(roomId) {
      // ⚠ Everyone at the door hears the same word as everyone who was refused.
      // ⚠⚠ **The map is NOT deleted.** ⚠ **Deleting it would send them back to "waiting",
      //   ⚠ and they would wait for a room that is gone.** ⚠ **A browser check caught exactly that.**
      for (const [id, k] of rooms.get(roomId) ?? []) {
        if (k.state !== "waiting") continue;
        k.state = "over";
        fire(roomId, id, { state: "over" });
      }
      // ⚠⚠ **A watcher on an id this room never had is NOT told.** ⚠ **It never was told
      //   ⚠ anything, ⚠ and being told now would say the URL was a real room** — ⚠ **which is
      //   ⚠ the one thing an 80-bit URL is the wall against** (see the head of this file).
    },
  };
};
