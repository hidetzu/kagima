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

import type { DiscardFacts } from "./discards.ts";

/** ⚠ **A candidate, reduced to the two things that are safe and the two that matter.** */
export type CandidateFact = {
  /** ⚠ `host` / `srflx` / `prflx` / `relay`. ⚠ **Never the line it came from.** */
  readonly type: string;
  /** ⚠ `udp` / `tcp`. */
  readonly protocol: string;
  /**
   * ⚠ `v4` / `v6` / `?`. ⚠ **Never an address** — ⚠ see `familyOf`.
   *
   * ⚠⚠ **Why it is here: ⚠ a `host/host` pair over IPv4 and one over IPv6 are different
   * observations, ⚠ and without this they get written down identically.**
   * ⚠ **It does not settle what the network was** — ⚠ **it stops two different things being
   * recorded as one.**
   */
  readonly family: string;
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
  /**
   * ⚠⚠ **The shadow heartbeat, ⚠ and what the browser did to this page**
   * (`docs/adr/0020`, kagima#62).
   *
   * ⚠ **`null` when nothing is watching** — ⚠ **which is the case for every check that predates
   * this, ⚠ so they keep reporting exactly what they did before.**
   */
  readonly heartbeat: HeartbeatFacts | null;
  /**
   * ⚠⚠ **How long this page has lasted while nobody was looking** (`discards.ts`, kagima#96).
   * ⚠ **`null` when nothing is watching**, ⚠ so every check that predates it is unchanged.
   */
  readonly discards: DiscardFacts | null;
  /**
   * ⚠⚠ **When this snapshot was taken, ⚠ on the same clock as `transitions`** (kagima#91).
   *
   * ⚠ **Without it, ⚠ an outage that is still going has no end, ⚠ and `held for` cannot be said
   * to span anything.** ⚠ **`heldMs` was already measured against this moment; ⚠ this makes it
   * something the report can read rather than something it has to assume.**
   */
  readonly atMs: number;
};

/**
 * ⚠⚠ **How much of the time there was no connection** (kagima#91).
 *
 * ⚠ **Measured on 2026-09-06: ⚠ a panel said `verdict: frames, held` and `held for: 1121s` for a
 * call that had been down for about 635 of those seconds, ⚠ across four drops, ⚠ the longest 512.**
 * ⚠ **`heldMs` is a wall clock from the first frame; ⚠ it never looked at whether media was
 * flowing.** ⚠ **The number was right and it was read as something else.**
 */
export type Outages = {
  readonly count: number;
  readonly totalMs: number;
  readonly longestMs: number;
  /** ⚠ **Still down when the snapshot was taken.** ⚠ **Not the same as a drop that ended.** */
  readonly openAtEnd: boolean;
};

/**
 * ⚠ **Read off the transitions, ⚠ not kept separately** — ⚠ **the same reasoning as `arrivedAt`.**
 *
 * ⚠ **`disconnected`, `failed` and `closed` all mean "not carrying media".** ⚠ **They arrive in a
 * run** (⚠ measured: `disconnected` then `failed` 10.0 seconds later), ⚠ **and that is one outage,
 * ⚠ not two** — ⚠ **so a second one does not open while one is already open.**
 * ⚠ **`connected` is the only thing that closes one.**
 */
export const outagesOf = (s: Snapshot): Outages => {
  const DOWN = new Set(["disconnected", "failed", "closed"]);
  let openedAt: number | null = null;
  let count = 0;
  let totalMs = 0;
  let longestMs = 0;
  const close = (at: number): void => {
    if (openedAt === null) return;
    const ms = at - openedAt;
    count += 1;
    totalMs += ms;
    longestMs = Math.max(longestMs, ms);
    openedAt = null;
  };
  for (const t of s.transitions) {
    if (t.what !== "connectionState") continue;
    if (t.value === "connected") close(t.at);
    else if (DOWN.has(t.value) && openedAt === null) openedAt = t.at;
  }
  const openAtEnd = openedAt !== null;
  // ⚠ Still down. ⚠ It runs to the moment this was read, ⚠ which is what `atMs` is for.
  close(s.atMs);
  return { count, totalMs, longestMs, openAtEnd };
};

/**
 * ⚠ **What can be said about the heartbeat without saying anything about anybody.**
 *
 * ⚠ **Times are milliseconds since the page loaded.** ⚠ **Never a date, ⚠ never a clock.**
 */
export type HeartbeatFacts = {
  readonly answered: number;
  readonly lastAnsweredAt: number | null;
  /** ⚠ **The longest stretch this page was not visible.** ⚠ `null` while it never left. */
  readonly longestHiddenMs: number | null;
  /** ⚠ **Whether the browser froze it.** ⚠ **`false` here is "not observed"**, ⚠ not "did not happen". */
  readonly wasFrozen: boolean;
  /** ⚠ **Whether this browser reports freezing at all.** ⚠ Without it, `wasFrozen` says nothing. */
  readonly canSeeFreezing: boolean;
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
  // ⚠⚠ **What the browser did to this page, ⚠ placed on the same clock as everything else**
  //   ⚠ (kagima#91). ⚠ **`longest hidden` said how long and never when, ⚠ so it could not be
  //   ⚠ lined up against a drop.**
  "page",
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
  // ⚠ The page's own words (`src/client/lifecycle.ts`), ⚠ through the same closed vocabulary.
  "hidden",
  "visible",
  "frozen",
  "resumed",
]);

const KNOWN_FAMILIES = new Set(["v4", "v6", "?"]);

/**
 * ⚠⚠ **The one place in kagima that is allowed to look at an address, ⚠ and all it may say is
 * which of two families it belongs to.**
 *
 * ⚠ **Why it exists: ⚠ a first cross-network observation selected `host/host`, ⚠ and a
 * `host/host` pair over IPv4 and one over IPv6 are different observations that were being
 * written down identically.** ⚠ **Recording the family keeps them apart.**
 * ⚠ **It does not by itself say what the network was** — ⚠ **that is for whoever knows how the
 * test was run** ([kagima#16](https://github.com/hidetzu/kagima/issues/16)).
 *
 * ⚠ **The address is not returned, ⚠ not stored, ⚠ not logged, ⚠ and not passed on.**
 * ⚠ **This function's return type is the wall: ⚠ three values, ⚠ and `test/diagnostics.test.ts`
 * hands it every address shape it can think of and asserts nothing else ever comes back.**
 *
 * ⚠ **`?` is a real answer, ⚠ not a failure** — ⚠ **an mDNS `.local` candidate hides its family,
 * ⚠ and saying "unknown" is the honest thing** (`.claude/rules/evidence.md`).
 */
export const familyOf = (address: unknown): string => {
  if (typeof address !== "string") return "?";
  // ⚠ A colon appears in no IPv4 address and in every IPv6 one.
  if (address.includes(":")) return "v6";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return "v4";
  // ⚠ An mDNS name, ⚠ or something we do not recognise. ⚠ Never guessed at.
  return "?";
};

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
    const key =
      `${only(c.type, KNOWN_TYPES)}/${only(c.protocol, KNOWN_PROTOCOLS)}` +
      `/${only(c.family, KNOWN_FAMILIES)}`;
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
 * ⚠ **The shape of one `RTCStats` entry, ⚠ as far as this file needs it.**
 * ⚠ **Declared here, away from the browser, ⚠ so the selection below can be held to fixtures.**
 */
export type StatLike = {
  readonly type?: string;
  readonly id?: string;
  readonly state?: string;
  readonly nominated?: boolean;
  readonly selected?: boolean;
  readonly selectedCandidatePairId?: string;
  readonly localCandidateId?: string;
  readonly remoteCandidateId?: string;
  readonly candidateType?: string;
  readonly protocol?: string;
  /** ⚠ **Only ever handed to `familyOf`.** ⚠ Never read for anything else, ⚠ never stored. */
  readonly address?: string;
  readonly kind?: string;
  readonly framesDecoded?: number;
};

/**
 * ⚠⚠ **Which candidate pair is actually carrying the call.**
 *
 * ⚠ **A first two-sided observation had the two ends disagree: ⚠ one reported `srflx/srflx`
 * and the other `host/host` ⚠ about the same single connection.** ⚠ **They cannot both be right,
 * ⚠ and which pair carried the call is one of the few things the field test can record at all**
 * ([kagima#16](https://github.com/hidetzu/kagima/issues/16)).
 *
 * ⚠ **The cause was here: ⚠ several pairs can be `nominated` and `succeeded` at once, ⚠ and the
 * first version kept whichever the engine happened to enumerate last.**
 * ⚠ **`transport.selectedCandidatePairId` is the authoritative answer, ⚠ so it is read first.**
 *
 * ⚠ **The fallbacks are named in order and none of them is "whatever came last".**
 */
export const selectedPairIdOf = (stats: Iterable<StatLike>): string | null => {
  const pairs: StatLike[] = [];
  let fromTransport: string | null = null;
  let flaggedSelected: string | null = null;
  for (const stat of stats) {
    if (stat.type === "transport" && typeof stat.selectedCandidatePairId === "string") {
      fromTransport = stat.selectedCandidatePairId;
    }
    if (stat.type !== "candidate-pair") continue;
    pairs.push(stat);
    // ⚠ Chromium sets this on the one in use. ⚠ Not every engine does, ⚠ so it is a fallback.
    if (stat.selected === true && typeof stat.id === "string") flaggedSelected = stat.id;
  }
  if (fromTransport !== null && pairs.some((p) => p.id === fromTransport)) return fromTransport;
  if (flaggedSelected !== null) return flaggedSelected;
  // ⚠ Last resort. ⚠ ⚠ When more than one qualifies, ⚠ say so by returning nothing rather than
  //   ⚠ picking one — ⚠ an arbitrary pick is what produced two ends contradicting each other.
  const nominated = pairs.filter((p) => p.state === "succeeded" && p.nominated === true);
  return nominated.length === 1 ? ((nominated[0] as StatLike).id ?? null) : null;
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
 * ⚠ **How far the connection got, ⚠ said as what was observed and not as what caused it.**
 *
 * ⚠⚠ **This used to name causes** — ⚠ **"the NAT was not traversed", ⚠ "this is before NAT".**
 * ⚠ **It cannot know that.** ⚠ **What it can see is which of three things happened: ⚠ no
 * reflexive candidate was gathered, ⚠ candidates were gathered but no pair was selected, ⚠ or a
 * pair was selected and no frame arrived.**
 * ⚠ **Those three are worth keeping apart** — ⚠ **the reason for any of them is not here.**
 *
 * ⚠ **Naming a cause in the instrument puts a guess into the record as if it were measured**
 * (`.claude/rules/evidence.md`), ⚠ **and it gets read back out of the record as evidence.**
 */
export const verdictOf = (s: Snapshot): string => {
  // ⚠⚠ **`msToFirstFrame`, ⚠ not `framesDecoded`** (kagima#91, ⚠ owner decision 2026-09-06).
  //
  // ⚠ **`framesDecoded` is read off the stream in use now, ⚠ and a stream that was re-made
  //   ⚠ starts at zero.** ⚠ **Measured: ⚠ a panel opened after a drop said `no frames` for a
  //   ⚠ call that had run 175 seconds with video** — ⚠ **three lines above `ms to 1st frame: 504`.**
  // ⚠ **`msToFirstFrame` is set once and never unset.** ⚠ **"a frame arrived at some point" is a
  //   ⚠ fact about the call; ⚠ `framesDecoded` is a fact about this moment.**
  if (s.msToFirstFrame !== null) {
    const out = outagesOf(s);
    // ⚠⚠ **Still down when this was read.** ⚠ **Whatever it held earlier, ⚠ that is the first
    //   ⚠ thing the reader needs** — ⚠ **and it is the one case where "held" reads as a lie.**
    if (out.openAtEnd) return "frames, then it dropped and did not come back";
    const held =
      s.heldMs !== null && s.heldMs >= HOLD_TARGET_MS
        ? "frames, held"
        : "frames, but not held for the full time";
    if (out.count === 0) return held;
    // ⚠ The count goes in the verdict itself, ⚠ so a reader who reads one line still learns it
    //   ⚠ (owner decision 2026-09-06). ⚠ `of which no media` carries how long.
    return `${held} — but it dropped ${out.count === 1 ? "once" : `${out.count} times`}`;
  }
  const gotReflexive = s.localCandidates.some((c) => {
    const t = only(c.type, KNOWN_TYPES);
    return t === "srflx" || t === "relay";
  });
  // ⚠ Each says what was seen. ⚠ ⚠ None says why, ⚠ and each one says so out loud.
  if (!gotReflexive) return "no frames — no reflexive candidate was gathered (cause undetermined)";
  if (s.selected === null) {
    return "no frames — candidates gathered, no ICE pair selected (cause undetermined)";
  }
  return "no frames — an ICE pair was selected (cause undetermined)";
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
  // ⚠⚠ **Named for what it counts** (kagima#91). ⚠ **Two snapshots of one page reported 2903
  //   ⚠ and then 550: ⚠ the number went DOWN.** ⚠ **It is read off the inbound stream in use,
  //   ⚠ and a stream that was re-made starts again at zero.** ⚠ **"frames decoded" was read as
  //   ⚠ "frames this call has had", ⚠ which it never was.**
  lines.push(`  frames decoded:   ${num(s.framesDecoded, "0")}  (on the stream in use now)`);
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
  // ⚠⚠ **Next to `held for`, ⚠ because `held for` is what it corrects** (kagima#91).
  //   ⚠ **`held for` is a wall clock from the first frame and never looked at whether media was
  //   ⚠ flowing.** ⚠ **Printed always** — ⚠ **`no drops` is a fact worth reading, ⚠ and a line
  //   ⚠ that appears only sometimes gets read as "this run was special".**
  const out = outagesOf(s);
  lines.push(
    `  of which no media: ${
      out.count === 0
        ? "none — it never dropped"
        : `${num(out.totalMs / 1000, "?")}s across ${out.count}` +
          ` (longest ${num(out.longestMs / 1000, "?")}s)` +
          (out.openAtEnd ? "  ⚠ still down when this was read" : "")
    }`,
  );
  lines.push(`  local candidates: ${countByType(s.localCandidates)}`);
  lines.push(`  remote candidates:${countByType(s.remoteCandidates)}`);
  lines.push(
    `  selected pair:    ${
      s.selected === null
        ? "none"
        : `${only(s.selected.local.type, KNOWN_TYPES)}/${only(s.selected.remote.type, KNOWN_TYPES)}` +
          ` over ${only(s.selected.local.protocol, KNOWN_PROTOCOLS)}` +
          ` ${only(s.selected.local.family, KNOWN_FAMILIES)}`
      // ⚠⚠ The family, ⚠ and nothing read into it.
      //
      // ⚠ **This used to add "globally routable: there was no NAT to traverse" for a v6
      //   ⚠ host pair.** ⚠ **That is a conclusion about somebody's network, ⚠ and the
      //   ⚠ family does not establish it** — ⚠ **a v6 host pair forms just the same between
      //   ⚠ two machines on one LAN that has IPv6.**
      // ⚠ **The instrument reports candidate type, protocol, family and the selected pair.**
      // ⚠ **What that means about a network is for whoever knows how the test was run.**
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
  // ⚠⚠ **The shadow heartbeat** (`docs/adr/0020`). ⚠ **Absent from a report that was not
  //   ⚠ watching, ⚠ rather than printed as zeroes** — ⚠ **"not observed" and "none" are
  //   ⚠ different things** (`.claude/rules/evidence.md`).
  if (s.heartbeat !== null) {
    const h = s.heartbeat;
    lines.push(`  heartbeats answered: ${num(h.answered, "0")}`);
    lines.push(`  last answered at: ${num(h.lastAnsweredAt, "never")}ms`);
    lines.push(`  longest hidden:   ${num(h.longestHiddenMs, "never hidden")}ms`);
    lines.push(
      `  frozen:           ${
        // ⚠ ⚠ Three answers, ⚠ not two. ⚠ "no" and "this browser would not tell us" are
        //   ⚠ different, ⚠ and reporting them as one is exactly the mistake this file exists
        //   ⚠ to avoid.
        h.canSeeFreezing
          ? h.wasFrozen
            ? "yes"
            : "not while this page was open"
          : "not reported by this browser"
      }`,
    );
  }

  // ⚠⚠ **What the browser did to this page while nobody was looking** (kagima#96).
  //
  // ⚠ **Every number here is a LOWER BOUND** — ⚠ **how often a hidden page may write is the
  //   ⚠ browser's decision** — ⚠ **and the line says so rather than leaving the reader to know**
  //   (`.claude/rules/evidence.md`).
  if (s.discards !== null) {
    const d = s.discards;
    lines.push(
      `  thrown away while hidden: ${
        d.survivedMs.length === 0
          ? "none observed"
          : `${d.survivedMs.length} — lasted at least ` +
            `${d.survivedMs.map((ms) => `${num(ms / 1000, "?")}s`).join(", ")}` +
            "  (⚠ a reload of a hidden page reads the same)"
      }`,
    );
    if (d.hiddenForMs !== null) {
      lines.push(`  hidden right now: at least ${num(d.hiddenForMs / 1000, "?")}s`);
    }
  }

  lines.push("");
  lines.push("  ⚠ addresses are deliberately absent. ⚠ types and protocols only.");
  lines.push("  ⚠ this is one observation, on one pair of networks, at one moment.");
  lines.push("  ⚠ it is not a rate, and it must not be written up as one.");
  return lines.join("\n");
};
