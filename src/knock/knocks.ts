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
// ```
//
// ⚠ **All three look like "still waiting".** ⚠ **Anything else answers "does this room exist?"
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
export type KnockRejection = "no-such-room" | "too-many-waiting";

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
  const counts: Record<KnockRejection, number> = { "no-such-room": 0, "too-many-waiting": 0 };
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
  /** ⚠ **Unknown ids answer `waiting`.** ⚠ Same reason. */
  read(roomId: string, id: string): { state: KnockState; token?: string };
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
  /** ⚠ **Which rooms exist.** ⚠ Injected so this file never reaches into the store. */
  readonly roomExists: (roomId: string) => boolean;
};

export const createKnocks = (options: KnocksOptions): Knocks => {
  const maxWaiting = options.maxWaiting ?? MAX_WAITING;
  const rooms = new Map<string, Map<string, Knock>>();

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

    decide(roomId, id, admit, token) {
      const found = rooms.get(roomId)?.get(id);
      // ⚠ Already decided stays decided. ⚠ A second admit must not mint a second token.
      if (found === undefined || found.state !== "waiting") return;
      if (admit && token !== null) {
        found.state = "admitted";
        found.token = token;
        return;
      }
      found.state = "over";
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
      for (const k of rooms.get(roomId)?.values() ?? []) {
        if (k.state === "waiting") k.state = "over";
      }
    },
  };
};
