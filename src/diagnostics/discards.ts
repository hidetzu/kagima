// ⚠⚠ **How long a hidden page survives before the browser throws it away** (kagima#96).
//
// ⚠ **Owner decision, 2026-09-06: ⚠ kagima#90 is not decided yet.** ⚠ **Measure first** —
//   ⚠ **all four options there cost a piece of `docs/PRODUCT.md` § 5, ⚠ and the material for
//   ⚠ deciding is five observations from one afternoon.**
//
// ## ⚠ The hard part
//
// ⚠⚠ **A page that was thrown away remembers nothing.** ⚠ **So it has to be written down before
//   ⚠ it goes**, ⚠ **and read by the page that gets built in its place.**
//
// ## ⚠ What is never written
//
// ⚠ **No wall clock.** ⚠ **"this device was in a kagima room at this time of day" is close to the
//   ⚠ thing `docs/PRODUCT.md` § 5 says kagima does not have.** ⚠ **Only elapsed milliseconds.**
// ⚠ **No nickname, ⚠ no token, ⚠ no host key** (`src/client/remember.ts` says why).
// ⚠ **One room's worth, ⚠ and it goes when the room does** — ⚠ **a pile across rooms would be a
//   ⚠ record of how this device has been used, ⚠ which is the same objection.**
//
// ## ⚠ What the number is, and is not
//
// ⚠⚠ **It is a lower bound.** ⚠ **How often the page can write while hidden is the browser's
//   ⚠ decision, ⚠ not ours** — ⚠ **so the last value written is "it was still alive at least
//   ⚠ this long", ⚠ not "it died at exactly this moment"** (`.claude/rules/evidence.md`).
// ⚠ **And a person reloading a hidden page looks the same from here.** ⚠ **Writing only while
//   ⚠ hidden narrows it; ⚠ it does not close it.** ⚠ **The report says so.**

/** ⚠ **The whole of what is written down.** ⚠ **One room, ⚠ two numbers and a list.** */
export type HiddenRecord = {
  readonly roomId: string;
  /**
   * ⚠ **How long this page has been hidden, ⚠ as last written.**
   * ⚠ **`null` while the page is visible** — ⚠ **which is the same as "nothing to explain".**
   */
  readonly hiddenForMs: number | null;
  /** ⚠ **Each time a page was built in place of one that went away while hidden.** */
  readonly survivedMs: readonly number[];
};

/**
 * ⚠ **How many survivals are kept.** ⚠ **A bound, ⚠ not a sample size** — ⚠ **`remember.ts` makes
 * the same argument: ⚠ a pile is the thing that was promised away.**
 */
export const MAX_SURVIVALS = 12;

/** ⚠ **A room that has just been entered, ⚠ with nothing yet observed.** */
export const freshRecord = (roomId: string): HiddenRecord => ({
  roomId,
  hiddenForMs: null,
  survivedMs: [],
});

/**
 * ⚠ **The page went out of sight.** ⚠ **Start saying how long it has been gone.**
 */
export const wentHidden = (record: HiddenRecord, forMs: number): HiddenRecord => ({
  ...record,
  hiddenForMs: Math.max(0, Math.round(forMs)),
});

/**
 * ⚠⚠ **The page came back, ⚠ alive.** ⚠ **Nothing was thrown away, ⚠ so nothing is counted.**
 *
 * ⚠ **This is the whole of how a survival is told from an ordinary return**, ⚠ **and it is why
 * the value has to be cleared rather than left to be overwritten.**
 */
export const cameBack = (record: HiddenRecord): HiddenRecord => ({ ...record, hiddenForMs: null });

/**
 * ⚠⚠ **A page is being built, ⚠ and something was left behind.**
 *
 * ⚠ **A value still sitting there means the page that wrote it never came back to clear it.**
 * ⚠ **That is one survival, ⚠ and the value is how long it lasted.**
 *
 * ⚠ **A record from another room is not ours to read** — ⚠ **it is dropped, ⚠ not carried over.**
 */
export const builtInPlaceOf = (
  record: HiddenRecord | null,
  roomId: string,
): { readonly record: HiddenRecord; readonly counted: boolean } => {
  if (record === null || record.roomId !== roomId) {
    return { record: freshRecord(roomId), counted: false };
  }
  if (record.hiddenForMs === null) return { record, counted: false };
  return {
    record: {
      roomId,
      hiddenForMs: null,
      // ⚠ Oldest first, ⚠ and the oldest is what falls off. ⚠ The bound is the list's length.
      survivedMs: [...record.survivedMs, record.hiddenForMs].slice(-MAX_SURVIVALS),
    },
    counted: true,
  };
};

/**
 * ⚠ **What can be said about this, ⚠ in the report.**
 *
 * ⚠ **`null` when nothing is watching** — ⚠ **the same shape as the heartbeat, ⚠ so a check that
 * predates this keeps reporting exactly what it reported before.**
 */
export type DiscardFacts = {
  readonly survivedMs: readonly number[];
  /** ⚠ **Hidden right now, ⚠ and for how long as last written.** ⚠ `null` while visible. */
  readonly hiddenForMs: number | null;
};
