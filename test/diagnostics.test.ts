// ⚠ **The one thing this instrument must never do is emit an address.**
//
// ⚠ **A tester will paste its output into a public issue.** ⚠ **That is what it is for.**
// ⚠ **So the check is not "does it look right" — ⚠ it is "can an address get out".**
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  arrivedAt,
  familyOf,
  firstFrameAt,
  formatReport,
  HOLD_TARGET_MS,
  msToFrameSinceArrival,
  type Snapshot,
  selectedPairIdOf,
  verdictOf,
} from "../src/diagnostics/report.ts";

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  localCandidates: [
    { type: "host", protocol: "udp", family: "v4" },
    { type: "srflx", protocol: "udp", family: "v4" },
  ],
  remoteCandidates: [{ type: "srflx", protocol: "udp", family: "v4" }],
  selected: {
    local: { type: "srflx", protocol: "udp", family: "v4" },
    remote: { type: "srflx", protocol: "udp", family: "v4" },
  },
  transitions: [{ at: 120, what: "iceConnectionState", value: "connected" }],
  msToFirstFrame: 800,
  heldMs: HOLD_TARGET_MS,
  socketClosed: null,
  framesDecoded: 900,
  ...over,
});

// ── ⚠ the address wall ──────────────────────────────────────────────────────

/** ⚠ **What must never appear.** ⚠ IPv4, IPv6, and the `.local` mDNS names ICE also produces. */
const ADDRESSY = [
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3,}\b/i,
  /[0-9a-f-]{20,}\.local\b/i,
];

test("⚠⚠ an address handed in cannot come out", () => {
  // ⚠ Handed in deliberately, on every field a caller could get wrong.
  //   ⚠ The type says these are types and protocols; ⚠ nothing enforces that at runtime, and
  //   ⚠ the wall has to hold even when the caller is careless.
  const poisoned = snapshot({
    localCandidates: [
      { type: "host 192.168.1.42", protocol: "udp", family: "v4 192.168.1.42" },
      { type: "srflx", protocol: "udp 203.0.113.7", family: "2400:4050:b701:9800::1" },
    ],
    remoteCandidates: [
      { type: "srflx fe80::1ff:fe23:4567:890a", protocol: "udp", family: "fe80::1" },
    ],
    selected: {
      local: { type: "srflx 203.0.113.7", protocol: "udp", family: "203.0.113.7" },
      remote: { type: "srflx 198.51.100.9", protocol: "udp", family: "v6 198.51.100.9" },
    },
    transitions: [
      { at: 10, what: "candidate", value: "candidate:1 1 udp 2122 192.168.1.42 5 typ host" },
    ],
  });
  const said = formatReport(poisoned);

  // ⚠ This is the assertion that matters. ⚠ Everything else in this file is secondary.
  for (const pattern of ADDRESSY) {
    assert.doesNotMatch(said, pattern, `an address reached the report:\n${said}`);
  }
});

/**
 * ⚠ **Source with comments gone, ⚠ and with the one sanctioned address reader gone too.**
 *
 * ⚠⚠ **`familyOf` is allowed to see an address** (`docs/adr/0012`). ⚠ **Nothing else is.**
 * ⚠ **So the wall is not "the word never appears" any more — ⚠ it is "the word appears in
 * exactly one place, ⚠ and that place is a function that can only return three values".**
 * ⚠ **Cutting the exception out and checking what is left is how a narrow exception stays narrow.**
 */
const sourceWithoutTheOneReader = async (file: string): Promise<string> =>
  (await readFile(file, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // ⚠ The definition, in report.ts.
    .replace(/export const familyOf =[\s\S]*?\n};/, "")
    // ⚠ Every call site, anywhere.
    .replace(/familyOf\([^)]*\)/g, "")
    // ⚠ The field's declaration. ⚠ Declaring it is what lets `familyOf` be handed it;
    //   ⚠ ⚠ *reading* it anywhere else is what the next assertion forbids outright.
    .replace(/readonly address\?: string;/, "")
    // ⚠ Quoted text. ⚠ The report says "addresses are deliberately absent" in its own footer,
    //   ⚠ and a check that trips over the sentence describing it is checking the wrong thing
    //   (`CLAUDE.md` § 5: ⚠ strip the words before reading the code).
    .replace(/"[^"]*"|'[^']*'/g, '""');

test("⚠ the module that formats the report reads an address in one place and nowhere else", async () => {
  const code = await sourceWithoutTheOneReader("src/diagnostics/report.ts");
  assert.doesNotMatch(code, /\baddress\b/i, "the formatter names an address outside familyOf");
  // ⚠⚠ The sharp one: ⚠ nothing anywhere may read the field except through `familyOf`.
  assert.doesNotMatch(code, /\.address\b/, "the formatter reads an address directly");
  assert.doesNotMatch(code, /candidate:\s*\d/, "the formatter parses a candidate line");
  assert.doesNotMatch(code, /\.candidate\b/, "the formatter reads a raw candidate string");
});

// ── ⚠ the one sanctioned reader ─────────────────────────────────────────────

test("⚠⚠ familyOf answers with one of exactly three words, whatever it is handed", () => {
  // ⚠ **This is the whole wall.** ⚠ **The address goes in; ⚠ nothing but a family comes out.**
  const handed = [
    "192.168.1.42",
    "203.0.113.7",
    "255.255.255.255",
    "fe80::1ff:fe23:4567:890a",
    "2400:4050:b701:9800:4a68:4aff:fe9c:efdc",
    "::1",
    "0f8e7d6c5b4a39281706.local",
    "not-an-address-at-all",
    "",
    "1.2.3.4.5.6.7.8",
    "192.168.1.42:5000",
  ];
  for (const address of handed) {
    const said = familyOf(address);
    assert.ok(["v4", "v6", "?"].includes(said), `familyOf returned ${said} for ${address}`);
    // ⚠⚠ And it never hands any of the input back, ⚠ not even a piece of it.
    assert.ok(!said.includes("."), `familyOf leaked something from ${address}`);
    assert.ok(!said.includes(":"), `familyOf leaked something from ${address}`);
  }
  // ⚠ Anything that is not a string is not guessed at.
  for (const odd of [undefined, null, 42, {}, ["1.2.3.4"]]) {
    assert.equal(familyOf(odd), "?");
  }
});

test("⚠ the two families are told apart, and an mDNS name is not guessed at", () => {
  assert.equal(familyOf("192.168.1.42"), "v4");
  assert.equal(familyOf("2400:4050:b701:9800::1"), "v6");
  // ⚠ `?` is an answer, ⚠ not a failure. ⚠ Guessing here would be dressing a guess as a
  //   ⚠ measurement (`.claude/rules/evidence.md`).
  assert.equal(familyOf("0f8e7d6c5b4a39281706.local"), "?");
});

test("⚠⚠ the collector never reads an address either", async () => {
  // ⚠ **The formatter is checked above; ⚠ the collector is where an address would come from.**
  //
  // ⚠ **A mutation proved this gap was real: ⚠ making the collector read `stat.address` changed
  //   ⚠ nothing that any check could see, ⚠ because the closed vocabulary swallowed it into
  //   ⚠ "other".** ⚠ **The wall held and the mistake was invisible** — ⚠ **which is how the next
  //   ⚠ one, on a field the vocabulary does not cover, would get through.**
  // ⚠ **So the collector is held to the same shape, in source.**
  const code = await sourceWithoutTheOneReader("src/client/diagnostics.ts");
  assert.doesNotMatch(code, /\baddress\b/i, "the collector names an address outside familyOf");
  assert.doesNotMatch(code, /\.address\b/, "the collector reads an address directly");
  assert.doesNotMatch(code, /\.candidate\b/, "the collector reads a raw candidate string");
  assert.doesNotMatch(code, /\brelatedAddress\b/i, "the collector reads a related address");
  // ⚠ The `track` event is a negotiation event. ⚠ It must never be what times a frame again.
  assert.doesNotMatch(
    code,
    /"track"/,
    "the collector listens for track — that is a negotiation event",
  );
  // ⚠ `getStats()` is the safe door: ⚠ it hands over `candidateType` and `protocol` already
  //   ⚠ separated from the address. ⚠ Reading the SDP or the event's candidate line is not.
  assert.match(code, /candidateType/, "the collector does not read candidate types at all");
});

// ── ⚠ the three failures, kept apart ────────────────────────────────────────

test("⚠⚠ no reflexive candidate is reported as that, and no cause is named", () => {
  // ⚠ The three are kept apart because they are different observations.
  //   ⚠ ⚠ None may be reported as a cause: ⚠ the instrument cannot see one
  //   (`.claude/rules/evidence.md` — ⚠ never dress a guess as a measurement).
  const s = snapshot({
    framesDecoded: 0,
    msToFirstFrame: null,
    heldMs: null,
    localCandidates: [{ type: "host", protocol: "udp", family: "v4" }],
    selected: null,
  });
  assert.match(verdictOf(s), /no reflexive candidate was gathered/);
  assert.match(verdictOf(s), /cause undetermined/);
});

test("⚠ srflx without a pair is reported as no pair, and not as a NAT failure", () => {
  const s = snapshot({
    framesDecoded: 0,
    msToFirstFrame: null,
    heldMs: null,
    selected: null,
  });
  assert.match(verdictOf(s), /no ICE pair selected/);
  assert.match(verdictOf(s), /cause undetermined/);
});

test("⚠ a pair with no frames is reported as a pair with no frames", () => {
  const s = snapshot({ framesDecoded: 0, msToFirstFrame: null, heldMs: null });
  assert.match(verdictOf(s), /an ICE pair was selected/);
  assert.match(verdictOf(s), /cause undetermined/);
});

test("⚠ a relay candidate counts as reflexive for the purpose of that split", () => {
  // ⚠ A relay candidate was gathered, ⚠ so "nothing reflexive" is not what happened.
  //   ⚠ A relay being in play at all is the thing
  //   ⚠ kagima#16 is deciding about. ⚠ Lumping it in with "nothing was gathered" hides it.
  const s = snapshot({
    framesDecoded: 0,
    msToFirstFrame: null,
    heldMs: null,
    localCandidates: [{ type: "relay", protocol: "udp", family: "v4" }],
    selected: null,
  });
  assert.match(verdictOf(s), /no ICE pair selected/);
});

// ── ⚠ which pair is carrying the call ───────────────────────────────────────
//
// ⚠ **A first two-sided observation had the two ends disagree about one connection:**
// ⚠ **`srflx/srflx` on one side, ⚠ `host/host` on the other.** ⚠ **They cannot both be right,
//   ⚠ and which one is decides whether a NAT was traversed** (kagima#16).

test("⚠⚠ the transport's own answer wins over anything else", () => {
  // ⚠ Several pairs are nominated and succeeded at once. ⚠ ⚠ The first version kept whichever
  //   ⚠ the engine enumerated last, ⚠ so two engines answered differently about one call.
  const stats = [
    { type: "candidate-pair", id: "P1", state: "succeeded", nominated: true },
    { type: "candidate-pair", id: "P2", state: "succeeded", nominated: true },
    { type: "transport", id: "T", selectedCandidatePairId: "P2" },
  ];
  assert.equal(selectedPairIdOf(stats), "P2");
  // ⚠ And the order it is handed in must not change the answer.
  assert.equal(selectedPairIdOf([...stats].reverse()), "P2");
});

test("⚠ a pair flagged selected is used when no transport says otherwise", () => {
  const stats = [
    { type: "candidate-pair", id: "P1", state: "succeeded", nominated: true },
    { type: "candidate-pair", id: "P2", state: "succeeded", nominated: true, selected: true },
  ];
  assert.equal(selectedPairIdOf(stats), "P2");
});

test("⚠⚠ with several nominated and nothing to choose between them, it says nothing", () => {
  // ⚠ ⚠ Reporting "none" is a gap. ⚠ Reporting an arbitrary one is a wrong answer that reads
  //   ⚠ exactly like a right one — ⚠ and this project has to be able to tell those apart
  //   (`.claude/rules/evidence.md`).
  const stats = [
    { type: "candidate-pair", id: "P1", state: "succeeded", nominated: true },
    { type: "candidate-pair", id: "P2", state: "succeeded", nominated: true },
  ];
  assert.equal(selectedPairIdOf(stats), null);
});

test("⚠ a single nominated succeeded pair is the answer when nothing else points at one", () => {
  const stats = [
    { type: "candidate-pair", id: "P1", state: "failed", nominated: true },
    { type: "candidate-pair", id: "P2", state: "succeeded", nominated: true },
  ];
  assert.equal(selectedPairIdOf(stats), "P2");
});

test("⚠ a transport naming a pair that is not there falls through rather than inventing one", () => {
  const stats = [
    { type: "candidate-pair", id: "P1", state: "succeeded", nominated: true },
    { type: "transport", id: "T", selectedCandidatePairId: "gone" },
  ];
  assert.equal(selectedPairIdOf(stats), "P1");
});

// ── ⚠ what "time to first frame" is measured from, and what starts it ───────
//
// ⚠ **Both of these are walls around a defect a real observation found**, ⚠ **and both of them
//   ⚠ were absent when it happened** (`docs/FIELD-TEST.md`).

test("⚠⚠ a negotiation event never starts the clock — only a decoded frame does", () => {
  // ⚠ The original bug, in one line: ⚠ the clock hung off `track`, ⚠ which fires mid-negotiation.
  //   ⚠ The reported "first frame" arrived BEFORE `iceConnectionState -> connected`.
  //   ⚠ ⚠ A time to first frame that can precede the connection is not measuring a frame.
  assert.equal(firstFrameAt(null, 0, 341_889), null, "a frameless moment started the clock");
  assert.equal(firstFrameAt(null, 1, 342_300), 342_300);
});

test("⚠ the first frame is the first one, and later frames do not move it", () => {
  assert.equal(firstFrameAt(342_300, 900, 999_999), 342_300);
});

test("⚠⚠ the time is measured from the other side arriving, not from the page opening", () => {
  // ⚠ The first real observation reported `ms to 1st frame: 341889`.
  //   ⚠ ⚠ That was mostly the host sitting alone. ⚠ It answered a question nobody asked.
  const s = snapshot({
    msToFirstFrame: 342_300,
    transitions: [
      { at: 341_887, what: "signalingState", value: "have-remote-offer" },
      { at: 342_155, what: "connectionState", value: "connected" },
    ],
  });
  assert.equal(arrivedAt(s), 341_887);
  assert.equal(msToFrameSinceArrival(s), 413);

  const said = formatReport(s);
  assert.match(said, /ms to 1st frame: *413/);
  assert.match(said, /from the other side arriving/, "the number does not say what it is from");
  assert.match(said, /waited alone: *341887/, "the wait is folded into the frame time");
});

test("⚠ with nobody having arrived, the wait says so rather than printing a zero", () => {
  const s = snapshot({ msToFirstFrame: null, heldMs: null, framesDecoded: 0, transitions: [] });
  assert.match(formatReport(s), /waited alone: *nobody arrived/);
});

test("⚠⚠ no verdict names a cause, and none names a network", () => {
  // ⚠⚠ **The clause, asserted directly.** ⚠ **An instrument that names a cause puts our guess
  //   ⚠ into the record, ⚠ and it comes back out of the record as evidence.**
  const cases = [
    snapshot(),
    snapshot({ heldMs: 0 }),
    snapshot({ framesDecoded: 0, msToFirstFrame: null, heldMs: null, selected: null }),
    snapshot({ framesDecoded: 0, msToFirstFrame: null, heldMs: null }),
    snapshot({
      framesDecoded: 0,
      msToFirstFrame: null,
      heldMs: null,
      selected: null,
      localCandidates: [{ type: "host", protocol: "udp", family: "v4" }],
    }),
  ];
  for (const s of cases) {
    const said = verdictOf(s);
    assert.doesNotMatch(said, /\bNAT\b/, `a verdict names the NAT: ${said}`);
    assert.doesNotMatch(said, /same network|globally routable|traversed/i, said);
  }
});

test("⚠⚠ the report never reads a network out of the address family", () => {
  // ⚠ A v6 host pair forms just the same between two machines on one LAN that has IPv6.
  //   ⚠ ⚠ Saying otherwise would put a conclusion about somebody's network into the record.
  const said = formatReport(
    snapshot({
      selected: {
        local: { type: "host", protocol: "udp", family: "v6" },
        remote: { type: "host", protocol: "udp", family: "v6" },
      },
    }),
  );
  assert.match(said, /selected pair: *host\/host over udp v6/);
  assert.doesNotMatch(said, /globally routable/, said);
  assert.doesNotMatch(said, /no NAT to traverse/, said);
});

// ── ⚠ frames are the verdict, never a state name ────────────────────────────

test("⚠ frames held for the target reads as held", () => {
  assert.equal(verdictOf(snapshot()), "frames, held");
});

test("⚠ frames that stopped short say so rather than passing quietly", () => {
  const s = snapshot({ heldMs: HOLD_TARGET_MS - 1 });
  assert.match(verdictOf(s), /not held/);
  assert.match(formatReport(s), /short of the target/);
});

test("⚠ the report says what it is not", () => {
  // ⚠ The wording is part of the instrument. ⚠ A number pasted without it becomes a rate the
  //   ⚠ moment somebody reads it (`.claude/rules/evidence.md`).
  const said = formatReport(snapshot());
  assert.match(said, /not a rate/);
  assert.match(said, /one observation/);
  assert.match(said, /addresses are deliberately absent/);
});

test("a socket that stayed open, and one that did not, read differently", () => {
  assert.match(formatReport(snapshot()), /open throughout/);
  assert.match(
    formatReport(snapshot({ socketClosed: { code: 1006, at: 21_000 } })),
    /closed \(code 1006\) at 21000ms/,
  );
});
