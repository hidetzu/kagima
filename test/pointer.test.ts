import assert from "node:assert/strict";
import test from "node:test";
import {
  flipPoint,
  isFresh,
  type Point,
  POINTER_CHANNEL,
  readPoint,
  writePoint,
} from "../src/call/pointer.ts";

const P: Point = { at: "your-screen", x: 0.25, y: 0.5, n: 7 };

test("what one side writes is what the other side reads", () => {
  assert.deepEqual(readPoint(writePoint(P)), P);
  assert.deepEqual(readPoint(writePoint({ at: "nowhere", x: 0, y: 0, n: 8 })), {
    at: "nowhere",
    x: 0,
    y: 0,
    n: 8,
  });
});

test("⚠ read from the other side, and read back, is where it started", () => {
  // ⚠ **The flip is its own inverse, ⚠ or one of the two ends draws on the wrong picture.**
  for (const at of ["my-camera", "your-camera", "my-screen", "your-screen", "nowhere"] as const) {
    assert.deepEqual(flipPoint(flipPoint({ ...P, at })), { ...P, at });
  }
  assert.equal(flipPoint(P).at, "my-screen");
  assert.equal(flipPoint({ ...P, at: "my-camera" }).at, "your-camera");
});

test("nothing but the one shape gets through", () => {
  // ⚠ malformed — ⚠ it is not JSON at all
  assert.equal(readPoint("{"), null);
  // ⚠ well-formed JSON, ⚠ and not ours
  assert.equal(readPoint("null"), null);
  assert.equal(readPoint("[]"), null);
  assert.equal(readPoint("{}"), null);
  assert.equal(readPoint(new ArrayBuffer(4)), null);
  // ⚠ a picture nobody has
  assert.equal(readPoint('{"at":"my-face","x":0,"y":0,"n":1}'), null);
  // ⚠ a field left out is not a field set to zero
  assert.equal(readPoint('{"at":"nowhere","x":0,"y":0}'), null);
  assert.equal(readPoint('{"at":"nowhere","x":0,"n":1}'), null);
  assert.equal(readPoint('{"at":"nowhere","x":"0","y":0,"n":1}'), null);
});

test("⚠ a fraction outside the picture is dropped, and never squeezed into it", () => {
  // ⚠⚠ **Clamping would turn nonsense into somebody pointing at the corner.**
  assert.equal(readPoint('{"at":"my-screen","x":1.5,"y":0.5,"n":1}'), null);
  assert.equal(readPoint('{"at":"my-screen","x":-0.1,"y":0.5,"n":1}'), null);
  assert.equal(readPoint('{"at":"my-screen","x":0.5,"y":2,"n":1}'), null);
  assert.equal(readPoint('{"at":"my-screen","x":null,"y":0.5,"n":1}'), null);
  // ⚠ the edges themselves are inside the picture
  assert.deepEqual(readPoint('{"at":"my-screen","x":0,"y":1,"n":1}'), {
    at: "my-screen",
    x: 0,
    y: 1,
    n: 1,
  });
});

test("⚠ an older position never puts the dot back", () => {
  // ⚠⚠ **The channel is unordered on purpose.** ⚠ **Arrival order is not send order.**
  assert.equal(isFresh(7, { ...P, n: 8 }), true);
  assert.equal(isFresh(7, { ...P, n: 7 }), false);
  assert.equal(isFresh(7, { ...P, n: 6 }), false);
});

test("the channel is the one the other side opens", () => {
  assert.equal(POINTER_CHANNEL, "kagima.pointer");
});
