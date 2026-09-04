// ⚠ **The one thing this instrument must never do is emit an address.**
//
// ⚠ **A tester will paste its output into a public issue.** ⚠ **That is what it is for.**
// ⚠ **So the check is not "does it look right" — ⚠ it is "can an address get out".**
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  HOLD_TARGET_MS,
  type Snapshot,
  formatReport,
  verdictOf,
} from "../src/diagnostics/report.ts";

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  localCandidates: [
    { type: "host", protocol: "udp" },
    { type: "srflx", protocol: "udp" },
  ],
  remoteCandidates: [{ type: "srflx", protocol: "udp" }],
  selected: {
    local: { type: "srflx", protocol: "udp" },
    remote: { type: "srflx", protocol: "udp" },
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
      { type: "host 192.168.1.42", protocol: "udp" },
      { type: "srflx", protocol: "udp 203.0.113.7" },
    ],
    remoteCandidates: [{ type: "srflx fe80::1ff:fe23:4567:890a", protocol: "udp" }],
    selected: {
      local: { type: "srflx 203.0.113.7", protocol: "udp" },
      remote: { type: "srflx 198.51.100.9", protocol: "udp" },
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

test("⚠ the module that formats the report never reads a raw candidate line", async () => {
  // ⚠ The runtime check above holds only for what the snapshot carries.
  //   ⚠ This one holds the shape: ⚠ the formatter must not know how to parse a candidate at all,
  //   ⚠ because a parser is how an address gets in.
  const code = (await readFile("src/diagnostics/report.ts", "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\baddress\b/i, "the formatter names an address field");
  assert.doesNotMatch(code, /candidate:\s*\d/, "the formatter parses a candidate line");
  assert.doesNotMatch(code, /\.candidate\b/, "the formatter reads a raw candidate string");
});

test("⚠⚠ the collector never reads an address either", async () => {
  // ⚠ **The formatter is checked above; ⚠ the collector is where an address would come from.**
  //
  // ⚠ **A mutation proved this gap was real: ⚠ making the collector read `stat.address` changed
  //   ⚠ nothing that any check could see, ⚠ because the closed vocabulary swallowed it into
  //   ⚠ "other".** ⚠ **The wall held and the mistake was invisible** — ⚠ **which is how the next
  //   ⚠ one, on a field the vocabulary does not cover, would get through.**
  // ⚠ **So the collector is held to the same shape, in source.**
  const code = (await readFile("src/client/diagnostics.ts", "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\baddress\b/i, "the collector names an address field");
  assert.doesNotMatch(code, /\.candidate\b/, "the collector reads a raw candidate string");
  assert.doesNotMatch(code, /\brelatedAddress\b/i, "the collector reads a related address");
  // ⚠ `getStats()` is the safe door: ⚠ it hands over `candidateType` and `protocol` already
  //   ⚠ separated from the address. ⚠ Reading the SDP or the event's candidate line is not.
  assert.match(code, /candidateType/, "the collector does not read candidate types at all");
});

// ── ⚠ the three failures, kept apart ────────────────────────────────────────

test("⚠⚠ no srflx is reported as before-NAT, not as a NAT failure", () => {
  // ⚠ Collapsing these is how a NAT gets blamed for something that never reached it.
  const s = snapshot({
    framesDecoded: 0,
    msToFirstFrame: null,
    heldMs: null,
    localCandidates: [{ type: "host", protocol: "udp" }],
    selected: null,
  });
  assert.match(verdictOf(s), /before NAT/);
});

test("⚠ srflx without a pair is reported as the NAT not being traversed", () => {
  const s = snapshot({
    framesDecoded: 0,
    msToFirstFrame: null,
    heldMs: null,
    selected: null,
  });
  assert.match(verdictOf(s), /NAT was not traversed/);
});

test("⚠ a pair with no frames is reported as something other than the NAT", () => {
  const s = snapshot({ framesDecoded: 0, msToFirstFrame: null, heldMs: null });
  assert.match(verdictOf(s), /other than the NAT/);
});

test("⚠ a relay candidate counts as reflexive for the purpose of that split", () => {
  // ⚠ If a relay was used, the NAT question was answered — ⚠ by relaying, which is the thing
  //   ⚠ kagima#16 is deciding whether to allow. ⚠ Reporting it as "before NAT" would hide that.
  const s = snapshot({
    framesDecoded: 0,
    msToFirstFrame: null,
    heldMs: null,
    localCandidates: [{ type: "relay", protocol: "udp" }],
    selected: null,
  });
  assert.match(verdictOf(s), /NAT was not traversed/);
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
