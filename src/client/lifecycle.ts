// ⚠⚠ **What the browser did to this page** (`docs/adr/0020`, kagima#62).
//
// ⚠ **The heartbeat is moving from a frame the browser answers to a message the page answers.**
// ⚠ **So the question stops being "is the socket alive" and becomes "was this page running"** —
//   ⚠ **and those come apart exactly when a page is put in the background.**
//
// ## ⚠ Why three states and not one
//
// ⚠ **"background" is not one thing, ⚠ and the reader's next move differs for each**
//   (`CLAUDE.md` § 4-1):
//
// ```text
// ⚠ hidden    the page is not on screen. ⚠ It may still be running
// ⚠ frozen    the browser stopped running it. ⚠ It can come back (`resume`)
// ⚠ ⚠ neither of those is "the socket closed", ⚠ and none of them is measured here as one
// ```
//
// ⚠ **kagima has measured NONE of this** (`.claude/rules/evidence.md`).
// ⚠ **This file exists so the Owner can, ⚠ on a real device, ⚠ rather than so anyone can argue
//   ⚠ about what browsers do.**
//
// ## ⚠ What is recorded, and what is not
//
// ⚠ **Times are milliseconds since the page loaded.** ⚠ **Never a date, ⚠ never a clock.**
// ⚠ **Nothing here identifies a person, a device, or a network** (`docs/adr/0012`).

/** ⚠ **A closed vocabulary.** ⚠ Anything the browser calls something else is not printed. */
export type LifecycleEvent = "hidden" | "visible" | "frozen" | "resumed";

export type LifecycleObservation = {
  readonly events: ReadonlyArray<{ readonly what: LifecycleEvent; readonly at: number }>;
  /** ⚠ **The longest stretch the page was not visible.** ⚠ `null` while it never left. */
  readonly longestHiddenMs: number | null;
  /** ⚠ **Whether the browser ever froze it.** ⚠ ⚠ Not "whether it can" — ⚠ whether it did. */
  readonly wasFrozen: boolean;
};

const MAX_EVENTS = 200;

/**
 * ⚠ **Starts watching, ⚠ and returns how to read it.**
 *
 * ⚠ **`freeze` and `resume` are not in every browser.** ⚠ **Where they are absent, nothing is
 * recorded and `wasFrozen` stays false** — ⚠ **which is "not observed", ⚠ not "did not happen"**
 * (`.claude/rules/evidence.md`). ⚠ **The report says so in as many words.**
 */
export const watchLifecycle = (
  target: Pick<Document, "addEventListener" | "visibilityState"> = document,
): (() => LifecycleObservation) => {
  const events: Array<{ what: LifecycleEvent; at: number }> = [];
  let hiddenSince: number | null = null;
  let longestHiddenMs: number | null = null;
  let wasFrozen = false;

  const now = () => Math.round(performance.now());
  const record = (what: LifecycleEvent) => {
    // ⚠ Bounded. ⚠ A page left open for hours must not grow a list without end.
    if (events.length < MAX_EVENTS) events.push({ what, at: now() });
  };

  target.addEventListener("visibilitychange", () => {
    if (target.visibilityState === "hidden") {
      hiddenSince = now();
      record("hidden");
      return;
    }
    if (hiddenSince !== null) {
      const away = now() - hiddenSince;
      longestHiddenMs = longestHiddenMs === null ? away : Math.max(longestHiddenMs, away);
      hiddenSince = null;
    }
    record("visible");
  });

  // ⚠ Page Lifecycle. ⚠ Registered unconditionally: ⚠ a browser without them simply never fires.
  target.addEventListener("freeze", () => {
    wasFrozen = true;
    record("frozen");
  });
  target.addEventListener("resume", () => record("resumed"));

  return () => ({
    events: [...events],
    // ⚠ Still away? ⚠ Then the stretch so far counts — ⚠ otherwise a page read while hidden
    //   ⚠ reports nothing about the very thing being measured.
    longestHiddenMs:
      hiddenSince === null ? longestHiddenMs : Math.max(longestHiddenMs ?? 0, now() - hiddenSince),
    wasFrozen,
  });
};
