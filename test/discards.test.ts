// ⚠⚠ **The claim: ⚠ a page that came back alive is never counted as one that was thrown away,
//   ⚠ and nothing written down is a wall clock** (`src/diagnostics/discards.ts`, kagima#96).
//
// ⚠ **What this tier cannot show: ⚠ that a browser actually throws a page away.**
// ⚠ **That is the thing being measured, ⚠ and it only happens on a real device**
//   (`.claude/rules/evidence.md`).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  builtInPlaceOf,
  cameBack,
  freshRecord,
  MAX_SURVIVALS,
  wentHidden,
} from "../src/diagnostics/discards.ts";
import { codeOf } from "./source-text.ts";

const ROOM = "abcdefgh12345678";

test("⚠⚠ a page that came back alive is not counted", () => {
  const hidden = wentHidden(freshRecord(ROOM), 61_000);
  const back = cameBack(hidden);
  const { record, counted } = builtInPlaceOf(back, ROOM);
  assert.equal(counted, false, "it came back — nothing was thrown away");
  assert.deepEqual(record.survivedMs, []);
});

test("⚠⚠ a value left behind is one page that never came back", () => {
  const hidden = wentHidden(freshRecord(ROOM), 348_000);
  const { record, counted } = builtInPlaceOf(hidden, ROOM);
  assert.equal(counted, true);
  assert.deepEqual(record.survivedMs, [348_000], "the value is how long it lasted");
  assert.equal(record.hiddenForMs, null, "counted once, and not again on the next load");
});

test("⚠ counting twice is what a second load must not do", () => {
  const once = builtInPlaceOf(wentHidden(freshRecord(ROOM), 61_000), ROOM).record;
  const twice = builtInPlaceOf(once, ROOM);
  assert.equal(twice.counted, false);
  assert.deepEqual(twice.record.survivedMs, [61_000]);
});

test("⚠ another room's record is not ours to read", () => {
  const other = wentHidden(freshRecord("zzzzzzzz99999999"), 61_000);
  const { record, counted } = builtInPlaceOf(other, ROOM);
  assert.equal(counted, false);
  assert.deepEqual(record, freshRecord(ROOM), "it starts over rather than carrying anything");
});

test("⚠⚠ the list is bounded, and it is the oldest that falls off", () => {
  let record = freshRecord(ROOM);
  for (let i = 1; i <= MAX_SURVIVALS + 3; i += 1) {
    record = builtInPlaceOf(wentHidden(record, i * 1_000), ROOM).record;
  }
  assert.equal(record.survivedMs.length, MAX_SURVIVALS);
  assert.equal(record.survivedMs.at(0), 4_000, "the first three fell off");
  assert.equal(record.survivedMs.at(-1), (MAX_SURVIVALS + 3) * 1_000);
});

test("⚠ a negative elapsed is not written down as one", () => {
  // ⚠ Clocks can go backwards. ⚠ A negative "how long it lasted" would be read as a real number.
  assert.equal(wentHidden(freshRecord(ROOM), -5).hiddenForMs, 0);
});

test("⚠⚠ neither file reaches for a wall clock", async () => {
  // ⚠⚠ **"this device was in a kagima room at this time of day" is close to the thing
  //   ⚠ `docs/PRODUCT.md` § 5 says kagima does not have.** ⚠ **Only elapsed milliseconds.**
  // ⚠ Comments stripped first, or this finds the sentence describing it (`CLAUDE.md` § 5).
  const { readFile } = await import("node:fs/promises");
  for (const file of ["src/diagnostics/discards.ts", "src/client/discarded.ts"]) {
    const code = codeOf(await readFile(file, "utf8"));
    for (const clock of ["Date.now", "new Date", "toISOString", "getTime"]) {
      assert.ok(!code.includes(clock), `${file} names a wall clock: ${clock}`);
    }
  }
});
