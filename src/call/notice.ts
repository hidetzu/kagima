// ⚠ **What the two browsers tell each other directly** (`docs/adr/0033`).
//
// ⚠⚠ **This is not signalling.** ⚠ **It goes over an `RTCDataChannel`, ⚠ browser to browser,
//   ⚠ and never reaches a server kagima runs** (`CLAUDE.md` § 3: ⚠ **the control plane carries
//   ⚠ who may join, ⚠ and never what they say**).
// ⚠ **Sending "I am showing my screen now" over the signalling socket would hand kagima's own
//   ⚠ server a fact about the call that it has no business holding.**
//
// ⚠ **Pure on purpose.** ⚠ **Nothing here touches the DOM**, ⚠ so the shape and its reader can be
//   ⚠ checked without a browser (`src/call/restart.ts` is here for the same reason).

/** ⚠ **The channel's label.** ⚠ Checked on arrival, so another channel is never read as this one. */
export const NOTICE_CHANNEL = "kagima.notices";

/**
 * ⚠ **`showing`: ⚠ whether the sender's own screen is in the call right now.**
 *
 * ⚠ **It has to be said, ⚠ because the media path does not say it.** ⚠ **Measured 2026-09-09,
 * Chromium: ⚠ `replaceTrack(null)` on the sending side leaves the receiving track live and
 * unmuted, ⚠ and the `<video>` holds the last frame.**
 */
export type Notice = { readonly showing: boolean };

/**
 * ⚠ **Untrusted: ⚠ it came from the other browser** (`.claude/rules/security.md` § Grounds 3).
 * ⚠ **Anything but the one shape is dropped**, ⚠ and dropping is the whole answer — ⚠ there is
 * nothing to tell the other side, and nothing a page should do differently.
 */
export const readNotice = (data: unknown): Notice | null => {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const showing = (parsed as { showing?: unknown }).showing;
  if (typeof showing !== "boolean") return null;
  return { showing };
};

/** ⚠ **One writer, ⚠ so the two ends cannot drift into different words.** */
export const writeNotice = (notice: Notice): string => JSON.stringify(notice);
