// ⚠ **What is under test is case selection, not the tools the cases run.**
//
// ⚠ **Grounds for testing this at all:** ⚠ **a `--only=` that matches nothing produces no output
//   ⚠ and exits 0.** ⚠ **That is indistinguishable from a clean run**, and it is the way a check
//   ⚠ suite silently stops checking anything (`.claude/rules/verification.md` — ⚠ **every entry
//   ⚠ point must be able to run in part, and a partial run must say what it ran**).
//
// ⚠ **`the test passed ≠ the behaviour is correct`** (`.claude/rules/evidence.md`).
//   ⚠ **These assert the contract — what goes in, what comes out — not the implementation's steps.**
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES, type Case, caseNames, selectCases } from "../scripts/cases.ts";

const fixture: readonly Case[] = [
  { name: "alpha", sees: "a", command: ["true"] },
  { name: "beta", sees: "b", command: ["true"] },
];

test("no --only runs every case", () => {
  const { chosen, unknown } = selectCases(fixture);
  assert.deepEqual(caseNames(chosen), ["alpha", "beta"]);
  assert.equal(unknown, null);
});

test("--only picks exactly the named case", () => {
  const { chosen, unknown } = selectCases(fixture, "beta");
  assert.deepEqual(caseNames(chosen), ["beta"]);
  assert.equal(unknown, null);
});

test("⚠ an unknown --only reports the name and chooses nothing", () => {
  // ⚠ The important half is `unknown`. ⚠ An empty `chosen` on its own would let the runner
  //   print "0 of 0 passed" and exit 0 — ⚠ which is the failure this whole file exists for.
  const { chosen, unknown } = selectCases(fixture, "gamma");
  assert.deepEqual(chosen, []);
  assert.equal(unknown, "gamma");
});

test("⚠ --only is exact, never a prefix or a substring", () => {
  // ⚠ A prefix match would make `--only=alph` quietly run `alpha`, and the first line would
  //   announce a subset the caller did not ask for.
  assert.equal(selectCases(fixture, "alph").unknown, "alph");
  assert.equal(selectCases(fixture, "lpha").unknown, "lpha");
});

test("⚠ an empty --only= runs everything rather than nothing", () => {
  // ⚠ `--only=` with nothing after it is a caller mistake, not a request for zero cases.
  assert.deepEqual(caseNames(selectCases(fixture, "").chosen), ["alpha", "beta"]);
});

test("⚠ the real case list has unique names", () => {
  // ⚠ Two cases with one name makes --only= ambiguous, and the runner would announce
  //   "running 1 of N" while running two.
  const names = caseNames(CASES);
  assert.equal(new Set(names).size, names.length, `duplicate case name in ${names.join(", ")}`);
});

test("⚠ every real case names an argv, never a shell string", () => {
  // ⚠ A shell string would need quoting, and quoting is where injection lives.
  for (const c of CASES) {
    assert.ok(c.command.length > 0, `${c.name} has no command`);
    for (const part of c.command) assert.equal(typeof part, "string");
  }
});
