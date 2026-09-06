// ⚠⚠ **The one thing kagima keeps on a device** (`docs/adr/0021`, kagima#75).
//
// ⚠ **Measured on a real phone on 2026-09-06: ⚠ the browser discarded the backgrounded tab and
//   ⚠ reloaded it from scratch.** ⚠ **The Host's key lived in a variable, ⚠ so it went with the
//   ⚠ page** — ⚠ **and the room stayed alive on the server with nobody able to open its door.**
// ⚠ **That happens in the one window that matters: ⚠ while the Host is handing the URL over.**
//
// ## ⚠ What is kept, and what that costs
//
// ⚠ **`docs/PRODUCT.md` § 5 promises no accounts and ⚠ no way to identify a user over time.**
// ⚠ **A room's key is not a user's identifier** — ⚠ **it is one door, ⚠ and it stops meaning
//   ⚠ anything when that room ends.**
// ⚠⚠ **But a pile of them would be a record of how many rooms this device has made**, ⚠ **and
//   ⚠ that is close to the thing we promised not to have.**
// ⚠ **So: ⚠ exactly one, ⚠ replaced rather than appended, ⚠ and removed the moment it is dead.**
//
// ## ⚠ What is never kept
//
// ⚠ **The join token.** ⚠ **Short-livedness is the whole point of it**
//   (`.claude/rules/security.md` § 4) — ⚠ **writing it down takes that away.**
// ⚠ **Anybody's nickname.** ⚠ **That belongs to whoever knocked, ⚠ not to the Host**
//   (`docs/PRODUCT.md` § 5: ⚠ **誰がノックしたかを記録に残さない**).

/** ⚠ **One key.** ⚠ **Not a prefix, ⚠ not a namespace** — ⚠ **there is only ever one room.** */
const KEY = "kagima.room";

/** ⚠ **The whole of what is written down.** ⚠ **Two strings.** */
export type RememberedRoom = {
  readonly roomId: string;
  readonly hostKey: string;
};

/**
 * ⚠ **Storage that may not be there.**
 *
 * ⚠ **A private window, ⚠ a browser told to block site data, ⚠ an embedded view** — ⚠ **reaching
 * for `localStorage` can throw, ⚠ not merely return nothing.**
 * ⚠ **kagima works without it; ⚠ it just loses this one convenience.**
 *
 * ⚠⚠ **This does NOT catch.** ⚠ **Every caller below already wraps the whole thing, ⚠ so a guard
 * here would be unreachable** — ⚠ **and a guard no check can tell apart is one nobody can keep
 * right.** ⚠ **A mutation proved exactly that: ⚠ removing it changed nothing.**
 */
const store = (): Storage | null => globalThis.localStorage ?? null;

/** ⚠ **Replaces.** ⚠ **Never appends** — ⚠ **a pile is the thing we promised not to keep.** */
export const remember = (room: RememberedRoom): void => {
  try {
    store()?.setItem(KEY, JSON.stringify({ roomId: room.roomId, hostKey: room.hostKey }));
  } catch {
    // ⚠ Full, or refused. ⚠ Not being able to remember is not a failure of the call.
  }
};

/**
 * ⚠ **What was written down, ⚠ or `null`.**
 *
 * ⚠ **Anything that is not exactly two strings is treated as absent and removed** — ⚠ **a shape
 * we did not write is not ours to interpret, ⚠ and leaving it there means reading it again.**
 */
export const recall = (): RememberedRoom | null => {
  const raw = (() => {
    try {
      return store()?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  })();
  if (raw === null) return null;

  try {
    const value = JSON.parse(raw) as { roomId?: unknown; hostKey?: unknown };
    if (typeof value.roomId !== "string" || typeof value.hostKey !== "string") {
      forget();
      return null;
    }
    if (value.roomId === "" || value.hostKey === "") {
      forget();
      return null;
    }
    return { roomId: value.roomId, hostKey: value.hostKey };
  } catch {
    forget();
    return null;
  }
};

/**
 * ⚠⚠ **Called when the room is over, ⚠ and when the server says the key opens nothing.**
 *
 * ⚠ **Holding a dead key is how one becomes a pile.**
 */
export const forget = (): void => {
  try {
    store()?.removeItem(KEY);
  } catch {
    // ⚠ Nothing to do, and nothing to say to anybody about it.
  }
};
