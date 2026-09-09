import assert from "node:assert/strict";
import test from "node:test";
import { NOTICE_CHANNEL, peerWords, readNotice, writeNotice } from "../src/call/notice.ts";

// ⚠⚠ **It arrives from the other browser** (`.claude/rules/security.md` § Grounds 3).
//   ⚠ **Malformed and well-formed-but-not-ours are different outcomes**
//   (`.claude/rules/evidence.md` § Outcomes are not one outcome) — ⚠ **and here both end the same
//   ⚠ way, ⚠ dropped, ⚠ which is said rather than left to be inferred.**
// ⚠ **The other four outcomes in that list cannot occur here: ⚠ there is nothing to accept
//   ⚠ partially, ⚠ nothing to decline while understanding it, ⚠ nothing unimplemented, ⚠ and no
//   ⚠ timer** — ⚠ **a notice either arrived on the channel or it did not.**

const WHOLE = { showing: true, camera: false, microphone: true };

test("what this side writes is what the other side reads", () => {
  assert.deepEqual(readNotice(writeNotice(WHOLE)), WHOLE);
  assert.deepEqual(readNotice(writeNotice({ showing: false, camera: true, microphone: false })), {
    showing: false,
    camera: true,
    microphone: false,
  });
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
  // ⚠ not a string at all — ⚠ a DataChannel can carry binary
  assert.equal(readNotice(new ArrayBuffer(4)), null);
  assert.equal(readNotice(undefined), null);
});

test("⚠ a field left out is not a field set to false", () => {
  // ⚠⚠ **This is the one that would go quiet.** ⚠ **Reading a missing field as `false` would turn
  //   ⚠ "the other side did not say" into "the other side said the camera is off", ⚠ and the face
  //   ⚠ would vanish from a call where nothing happened.**
  assert.equal(readNotice('{"showing":true,"camera":true}'), null);
  assert.equal(readNotice('{"camera":true,"microphone":true}'), null);
  assert.equal(readNotice('{"showing":true,"microphone":true}'), null);
  // ⚠ ours in name only — ⚠ a truthy string is not a boolean
  assert.equal(readNotice('{"showing":"false","camera":true,"microphone":true}'), null);
  assert.equal(readNotice('{"showing":1,"camera":1,"microphone":1}'), null);
});

test("the label is the one the other side opens", () => {
  assert.equal(NOTICE_CHANNEL, "kagima.notices");
});

test("⚠ what the other side is doing is said as a fact, and never as a failure", () => {
  const on = { showing: false, camera: true, microphone: true };
  assert.equal(peerWords(on), "");
  assert.equal(peerWords({ ...on, showing: true }), "");
  assert.equal(peerWords({ ...on, camera: false }), "相手はカメラを切っています。");
  assert.equal(peerWords({ ...on, microphone: false }), "相手はマイクを切っています。");
  // ⚠⚠ **The case two copies would drift on.**
  assert.equal(
    peerWords({ ...on, camera: false, microphone: false }),
    "相手はカメラとマイクを切っています。",
  );
});
