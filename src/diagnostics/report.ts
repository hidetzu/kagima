// Turning what a call did into something a person can paste into an issue.
//
// ⚠ **The whole point of this file is what it CANNOT emit.**
//
// ⚠ **An ICE candidate carries an address.** ⚠ **A tester pasting one into a public repository
//   ⚠ publishes their home line's address and their phone's** (`.claude/rules/git.md`).
// ⚠ **"Be careful what you paste" is not a rule, it is a hope** — ⚠ **the same thing
//   ⚠ `security.md` § 2 says about redaction.** ⚠ **So the instrument cannot produce one.**
//
// ⚠ **This module never sees an address.** ⚠ **It takes a snapshot that already holds only
//   ⚠ types and protocols**, ⚠ **and `test/diagnostics.test.ts` feeds it addresses anyway to
//   ⚠ confirm none can come out.**
//
// ⚠ **It also names nothing from the media APIs** — ⚠ **`test/no-media-on-the-server.test.ts`
//   ⚠ forbids that for everything outside `src/client`, and this file lives outside it so the
//   ⚠ pure part can be checked in the fast tier.**

/** ⚠ **A candidate, reduced to the two things that are safe and the two that matter.** */
export type CandidateFact = {
  /** ⚠ `host` / `srflx` / `prflx` / `relay`. ⚠ **Never the line it came from.** */
  readonly type: string;
  /** ⚠ `udp` / `tcp`. */
  readonly protocol: string;
};

/** ⚠ **How the two ends actually reached each other.** ⚠ The answer the field test is after. */
export type PairFact = {
  readonly local: CandidateFact;
  readonly remote: CandidateFact;
};

export type Transition = {
  /** ⚠ Milliseconds since the call started. ⚠ Never a wall clock — ⚠ that would say when. */
  readonly at: number;
  readonly what: string;
  readonly value: string;
};

export type Snapshot = {
  /** ⚠ Counted by type, so the shape is visible without any of the lines. */
  readonly localCandidates: readonly CandidateFact[];
  readonly remoteCandidates: readonly CandidateFact[];
  readonly selected: PairFact | null;
  readonly transitions: readonly Transition[];
  readonly msToFirstFrame: number | null;
  /** ⚠ How long it was held after the first frame. ⚠ `null` when no frame ever arrived. */
  readonly heldMs: number | null;
  /** ⚠ The signalling socket. ⚠ `null` while it is still open. */
  readonly socketClosed: { readonly code: number; readonly at: number } | null;
  readonly framesDecoded: number;
};

/** ⚠ **How long the field test asks a call to be held** (`docs/FIELD-TEST.md`). */
export const HOLD_TARGET_MS = 30_000;

// ⚠ **The wall, and it is a closed vocabulary rather than a filter.**
//
// ⚠ **The first version copied `type` and `protocol` straight through, ⚠ and the check caught it:**
//   ⚠ **the types say "these are types", ⚠ but nothing enforces that at runtime, and a caller
//   ⚠ handing in a whole candidate line would have had it printed.**
// ⚠ **Filtering out what looks like an address is the wrong shape** — ⚠ **it has to be right about
//   ⚠ every format an address can take.** ⚠ **Allowing only what is known is right about all of
//   ⚠ them by construction.**

/** ⚠ **Every candidate type ICE defines.** ⚠ Anything else is reported as `other`, never echoed. */
const KNOWN_TYPES = new Set(["host", "srflx", "prflx", "relay"]);
/** ⚠ **Every transport a candidate can name.** */
const KNOWN_PROTOCOLS = new Set(["udp", "tcp", "tls"]);
/** ⚠ **The state machines worth recording.** */
const KNOWN_WHAT = new Set([
  "iceConnectionState",
  "iceGatheringState",
  "connectionState",
  "signalingState",
  "socket",
]);
/** ⚠ **Every value those state machines can take.** ⚠ Plus the socket's own words. */
const KNOWN_VALUES = new Set([
  "new",
  "checking",
  "connected",
  "completed",
  "disconnected",
  "failed",
  "closed",
  "connecting",
  "gathering",
  "have-local-offer",
  "have-remote-offer",
  "stable",
  "open",
  "closing",
  // ⚠ Found by the browser check, not by reading the spec: ⚠ a real call reported
  //   ⚠ `iceGatheringState -> other`, ⚠ because `complete` had been left out. ⚠ A closed
  //   ⚠ vocabulary is safe by construction and wrong by omission, ⚠ and the omission is silent.
  "complete",
  "have-local-pranswer",
  "have-remote-pranswer",
]);

const only = (value: string, allowed: ReadonlySet<string>): string =>
  allowed.has(value) ? value : "other";

/** ⚠ **Numbers print as numbers.** ⚠ A string in a number field is another way an address travels. */
const num = (v: number | null, absent: string): string =>
  v === null ? absent : Number.isFinite(v) ? String(Math.round(v)) : "?";

const countByType = (candidates: readonly CandidateFact[]): string => {
  if (candidates.length === 0) return "none";
  const seen = new Map<string, number>();
  for (const c of candidates) {
    // ⚠ Through the vocabulary, always. ⚠ Never the value as handed in.
    const key = `${only(c.type, KNOWN_TYPES)}/${only(c.protocol, KNOWN_PROTOCOLS)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k}×${n}`)
    .join(", ");
};

/**
 * ⚠ **When the other side arrived**, ⚠ **read from the transitions rather than kept separately.**
 *
 * ⚠ **Grounds: the clock starts when the page does, ⚠ and the host's page starts long before
 * anybody arrives.** ⚠ **A first real observation reported `ms to 1st frame: 341889` — ⚠ which
 * was mostly the host sitting alone waiting for a guest.** ⚠ **That number answered a question
 * nobody asked.**
 *
 * ⚠ **`signalingState` moving is the first moment the two sides are talking**, ⚠ **for whichever
 * end this is.** ⚠ **Before that there is nothing to time.**
 */
export const arrivedAt = (s: Snapshot): number | null => {
  const first = s.transitions.find((t) => t.what === "signalingState");
  return first === undefined ? null : first.at;
};

/**
 * ⚠ **When the clock for "first frame" may start: ⚠ on a decoded frame, ⚠ and on nothing else.**
 *
 * ⚠ **This lives here, ⚠ away from the browser, ⚠ so the fast tier can hold it.**
 * ⚠ **It used to live in the page as a `track` listener** — ⚠ **and `track` fires during
 * negotiation, ⚠ so the first observation reported a frame arriving before the connection did.**
 * ⚠ **`framesDecoded` is what the verdict turns on; ⚠ so it is what the clock turns on.**
 */
export const firstFrameAt = (
  previous: number | null,
  framesDecoded: number,
  at: number,
): number | null => (previous !== null ? previous : framesDecoded > 0 ? at : null);

/** ⚠ **From the other side arriving to a frame actually decoded.** ⚠ Not from the page opening. */
export const msToFrameSinceArrival = (s: Snapshot): number | null => {
  const from = arrivedAt(s);
  if (s.msToFirstFrame === null) return null;
  return from === null ? s.msToFirstFrame : s.msToFirstFrame - from;
};

/**
 * ⚠ **What a caller may conclude, split into the three failures the field test keeps apart**
 * (`docs/FIELD-TEST.md` § 5).
 *
 * ⚠ **"failed" is not one thing.** ⚠ **Collapsing them is how a NAT gets blamed for a codec.**
 */
export const verdictOf = (s: Snapshot): string => {
  if (s.framesDecoded > 0) {
    if (s.heldMs !== null && s.heldMs >= HOLD_TARGET_MS) return "frames, held";
    return "frames, but not held for the full time";
  }
  const gotReflexive = s.localCandidates.some((c) => {
    const t = only(c.type, KNOWN_TYPES);
    return t === "srflx" || t === "relay";
  });
  if (!gotReflexive) return "no frames — and no srflx: this is before NAT, not a NAT failure";
  if (s.selected === null) return "no frames — srflx but no pair: the NAT was not traversed";
  return "no frames — a pair formed: something other than the NAT";
};

/**
 * ⚠ **The report, as text a person can paste.**
 *
 * ⚠ **Every line comes from the snapshot, and the snapshot holds no addresses.**
 * ⚠ **Nothing here formats a value it was not given.**
 */
export const formatReport = (s: Snapshot): string => {
  const lines: string[] = [];
  lines.push("kagima field-test observation");
  lines.push(`  verdict:          ${verdictOf(s)}`);
  lines.push(`  frames decoded:   ${num(s.framesDecoded, "0")}`);
  // ⚠ **Named for what it is measured from.** ⚠ An unqualified "ms to 1st frame" was read as
  //   ⚠ "how long until you see something" ⚠ and was in fact "how long the host waited alone".
  lines.push(
    `  ms to 1st frame:  ${num(msToFrameSinceArrival(s), "no frame arrived")}` +
      (msToFrameSinceArrival(s) === null ? "" : "  (from the other side arriving)"),
  );
  lines.push(`  waited alone:     ${num(arrivedAt(s), "nobody arrived")}`);
  lines.push(
    `  held for:         ${s.heldMs === null ? "n/a" : `${num(s.heldMs / 1000, "n/a")}s`}` +
      (s.heldMs !== null && s.heldMs < HOLD_TARGET_MS ? "  ⚠ short of the target" : ""),
  );
  lines.push(`  local candidates: ${countByType(s.localCandidates)}`);
  lines.push(`  remote candidates:${countByType(s.remoteCandidates)}`);
  lines.push(
    `  selected pair:    ${
      s.selected === null
        ? "none"
        : `${only(s.selected.local.type, KNOWN_TYPES)}/${only(s.selected.remote.type, KNOWN_TYPES)}` +
          ` over ${only(s.selected.local.protocol, KNOWN_PROTOCOLS)}`
    }`,
  );
  lines.push(
    `  signalling socket:${
      s.socketClosed === null
        ? " open throughout"
        : ` closed (code ${num(s.socketClosed.code, "?")}) at ${num(s.socketClosed.at, "?")}ms`
    }`,
  );
  lines.push("  transitions:");
  if (s.transitions.length === 0) lines.push("    none recorded");
  for (const t of s.transitions) {
    // ⚠ Both halves through the vocabulary. ⚠ A transition's `value` is where a caller most
    //   ⚠ easily puts something that is not a state name.
    lines.push(
      `    ${num(t.at, "?")}ms  ${only(t.what, KNOWN_WHAT)} -> ${only(t.value, KNOWN_VALUES)}`,
    );
  }
  lines.push("");
  lines.push("  ⚠ addresses are deliberately absent. ⚠ types and protocols only.");
  lines.push("  ⚠ this is one observation, on one pair of networks, at one moment.");
  lines.push("  ⚠ it is not a rate, and it must not be written up as one.");
  return lines.join("\n");
};
