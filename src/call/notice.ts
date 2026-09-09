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
 * ⚠⚠ **What one side is putting into the call right now.** ⚠ **All three, ⚠ every time.**
 *
 * ⚠ **A whole state rather than "what changed"**: ⚠ **a notice that arrives twice, ⚠ or out of
 * an order this code did not choose, ⚠ leaves the reader in the same place either way.**
 *
 * ⚠ **It has to be said, ⚠ because the media path does not say it.** ⚠ **Measured 2026-09-09,
 * Chromium: ⚠ `replaceTrack(null)` on the sending side leaves the receiving track live and
 * unmuted, ⚠ and the `<video>` holds the last frame** — ⚠ **a screen that is no longer shared,
 * ⚠ and a face that is no longer on camera, ⚠ both keep looking like they are still there.**
 *
 * ⚠ **One polarity: ⚠ every field is "is this going out right now".**
 * ⚠ **The product says "mute"** (`docs/PRODUCT.md` § 3); ⚠ **that is `microphone: false`, ⚠ and
 * the word "mute" belongs to the page, ⚠ not to the wire.**
 */
export type SideState = {
  /** ⚠ **A screen is in the call.** */
  readonly showing: boolean;
  /** ⚠ **The camera is on.** ⚠ **Off means the track was stopped** (`docs/adr/0033` 決定 4). */
  readonly camera: boolean;
  /** ⚠ **The microphone is on.** ⚠ **Off means `enabled = false`, ⚠ not a stopped track.** */
  readonly microphone: boolean;
};

/**
 * ⚠ **Untrusted: ⚠ it came from the other browser** (`.claude/rules/security.md` § Grounds 3).
 * ⚠ **Anything but the one shape is dropped**, ⚠ and dropping is the whole answer — ⚠ there is
 * nothing to tell the other side, and nothing a page should do differently.
 */
export const readNotice = (data: unknown): SideState | null => {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const said = parsed as Record<string, unknown>;
  // ⚠ **Every field, ⚠ or none of it.** ⚠ **A half-read notice would let one missing field mean
  //   ⚠ "off", ⚠ and "the other side did not say" is not "the other side said no"
  //   (`.claude/rules/evidence.md` § Silence is not permission).
  if (
    typeof said.showing !== "boolean" ||
    typeof said.camera !== "boolean" ||
    typeof said.microphone !== "boolean"
  ) {
    return null;
  }
  return { showing: said.showing, camera: said.camera, microphone: said.microphone };
};

/** ⚠ **One writer, ⚠ so the two ends cannot drift into different words.** */
export const writeNotice = (state: SideState): string =>
  JSON.stringify({
    showing: state.showing,
    camera: state.camera,
    microphone: state.microphone,
  });

/**
 * ⚠⚠ **What to tell this side about the other one** (`CLAUDE.md` § 4).
 *
 * ⚠ **Here rather than in each page, ⚠ because the branching is the part that goes wrong** —
 * ⚠ **two copies would drift on the both-at-once case first.**
 * ⚠ **A fact about the other person, ⚠ not a failure**: ⚠ **nothing here says anything did not
 * work** (`CLAUDE.md` § 4-1).
 * ⚠ **Empty when there is nothing to say.** ⚠ **A call where everything is on needs no line.**
 *
 * ⚠ **`showing` is deliberately not in here.** ⚠ **A shared screen either appears or does not,
 * ⚠ and a sentence about it would say the same thing twice.**
 */
export const peerWords = (state: SideState): string => {
  if (!state.camera && !state.microphone) return "相手はカメラとマイクを切っています。";
  if (!state.camera) return "相手はカメラを切っています。";
  if (!state.microphone) return "相手はマイクを切っています。";
  return "";
};
