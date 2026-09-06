// ⚠⚠ **Writing down how long this page lasted while nobody was looking** (kagima#96).
//
// ⚠ **The reasoning, ⚠ what is never written, ⚠ and what the number is not, ⚠ are all in
//   ⚠ `src/diagnostics/discards.ts`.** ⚠ **This file is the storage and the timer, ⚠ and nothing
//   ⚠ decides anything here** — ⚠ **the same split as `src/client/diagnostics.ts`.**
import type { DiscardFacts, HiddenRecord } from "../diagnostics/discards.ts";
import { builtInPlaceOf, cameBack, freshRecord, wentHidden } from "../diagnostics/discards.ts";

/** ⚠ **One key.** ⚠ **Not a prefix** — ⚠ **there is only ever one room** (`remember.ts`). */
const KEY = "kagima.hidden";

/**
 * ⚠ **How often the elapsed value is rewritten while hidden.**
 *
 * ⚠⚠ **A chosen value, ⚠ not a measured one** (`.claude/rules/evidence.md`).
 * ⚠ **How often it actually runs is the browser's decision** — ⚠ **a backgrounded page's timers
 * are throttled hard, ⚠ and that is exactly why the number it produces is a lower bound.**
 */
export const WRITE_EVERY_MS = 5_000;

const store = (): Storage | null => globalThis.localStorage ?? null;

/** ⚠ **Anything that is not the shape we wrote is treated as absent and removed.** */
const read = (): HiddenRecord | null => {
  try {
    const raw = store()?.getItem(KEY);
    if (typeof raw !== "string") return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const { roomId, hiddenForMs, survivedMs } = parsed as Partial<HiddenRecord>;
    if (typeof roomId !== "string") return null;
    if (hiddenForMs !== null && typeof hiddenForMs !== "number") return null;
    if (!Array.isArray(survivedMs) || survivedMs.some((n) => typeof n !== "number")) return null;
    return { roomId, hiddenForMs, survivedMs };
  } catch {
    return null;
  }
};

const write = (record: HiddenRecord): void => {
  try {
    store()?.setItem(KEY, JSON.stringify(record));
  } catch {
    // ⚠ Full, or refused. ⚠ Not being able to measure is not a failure of the call.
  }
};

/** ⚠ **The room ended.** ⚠ **The record goes with it** (`src/diagnostics/discards.ts`). */
export const forgetHidden = (): void => {
  try {
    store()?.removeItem(KEY);
  } catch {
    // ⚠ Nothing to do about it, and nothing depends on it.
  }
};

export type Discards = { facts(): DiscardFacts; stop(): void };

/**
 * ⚠ **Start watching, ⚠ for this room.**
 *
 * ⚠⚠ **Called once the page is in the room** — ⚠ **a page still at the door has nothing to
 * survive.** ⚠ **Reading first is what counts the previous page**: ⚠ **a value left behind means
 * whoever wrote it never came back to clear it.**
 */
export const watchDiscards = (
  roomId: string,
  target: Pick<Document, "addEventListener" | "visibilityState"> = document,
  now: () => number = () => performance.now(),
): Discards => {
  const { record: started } = builtInPlaceOf(read(), roomId);
  let record = started;
  write(record);

  let hiddenSince: number | null = target.visibilityState === "hidden" ? now() : null;

  const note = (): void => {
    if (hiddenSince === null) return;
    record = wentHidden(record, now() - hiddenSince);
    write(record);
  };

  // ⚠ The interval keeps the value fresh. ⚠ How often it truly runs is not ours to decide.
  const timer = setInterval(note, WRITE_EVERY_MS);

  target.addEventListener("visibilitychange", () => {
    if (target.visibilityState === "hidden") {
      hiddenSince = now();
      note();
      return;
    }
    // ⚠⚠ Back, and alive. ⚠ Clearing this is the whole of how a survival is told from an
    //   ⚠ ordinary return (`src/diagnostics/discards.ts`).
    hiddenSince = null;
    record = cameBack(record);
    write(record);
  });

  // ⚠⚠ The last moment before the browser may throw the page away. ⚠ Write there too, ⚠ because
  //   ⚠ the interval may not have run for a long time by then.
  target.addEventListener("freeze", note);

  return {
    facts: () => ({ survivedMs: record.survivedMs, hiddenForMs: record.hiddenForMs }),
    stop: () => clearInterval(timer),
  };
};
