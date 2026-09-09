import assert from "node:assert/strict";
import test from "node:test";
import { NOTICE_CHANNEL, readNotice, writeNotice } from "../src/call/notice.ts";

// ⚠⚠ **It arrives from the other browser** (`.claude/rules/security.md` § Grounds 3).
//   ⚠ **Malformed and well-formed-but-not-ours are different outcomes**
//   (`.claude/rules/evidence.md` § Outcomes are not one outcome) — ⚠ **and here both end the same
//   ⚠ way, ⚠ dropped, ⚠ which is said rather than left to be inferred.**

test("what this side writes is what the other side reads", () => {
  assert.deepEqual(readNotice(writeNotice({ showing: true })), { showing: true });
  assert.deepEqual(readNotice(writeNotice({ showing: false })), { showing: false });
});

test("nothing but the one shape gets through", () => {
  // ⚠ malformed — ⚠ it is not JSON at all
  assert.equal(readNotice("{"), null);
  assert.equal(readNotice(""), null);
  // ⚠ well-formed JSON, ⚠ and not ours
  assert.equal(readNotice("null"), null);
  assert.equal(readNotice("[]"), null);
  assert.equal(readNotice('"showing"'), null);
  assert.equal(readNotice("{}"), null);
  // ⚠ ours in name only — ⚠ a truthy string is not a boolean, ⚠ and reading it as one would make
  //   ⚠ `{"showing":"false"}` mean "showing"
  assert.equal(readNotice('{"showing":"false"}'), null);
  assert.equal(readNotice('{"showing":1}'), null);
  // ⚠ not a string at all — ⚠ a DataChannel can carry binary
  assert.equal(readNotice(new ArrayBuffer(4)), null);
  assert.equal(readNotice(undefined), null);
});

test("the label is the one the other side opens", () => {
  assert.equal(NOTICE_CHANNEL, "kagima.notices");
});
