// ⚠⚠ **A mode that costs two promises, ⚠ and the checks that keep it from costing more.**
//
// ⚠ **`docs/adr/0011` records why it exists.** ⚠ **This file holds the edges it must not cross:**
//
// ```text
// ⚠ off unless the flag was set          ⚠ never on by accident
// ⚠ the short passphrase survives        ⚠ normalisation deletes anything but a-z
// ⚠ still a CSPRNG                       ⚠ short is not a licence to stop
// ⚠ an observation cannot carry an address
// ```
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  FIELD_TEST,
  MAX_OBSERVATIONS,
  SHORT_ALPHABET,
  SHORT_LENGTH,
  SHORT_PASSPHRASE_BITS,
  createObservationStore,
  fieldTestBanner,
  generateShortPassphrase,
  shortPassphraseFromBytes,
} from "../src/field-test.ts";
import { normalizePassphrase } from "../src/passphrase/passphrase.ts";

test("⚠⚠ the mode is off unless it was asked for", () => {
  // ⚠ This run did not set the flag. ⚠ If this ever fails, ⚠ something turns it on by itself,
  //   ⚠ and the passphrase would be short on a server nobody meant to weaken.
  assert.equal(FIELD_TEST, false, "field-test mode is on in a run that did not ask for it");
});

test("⚠⚠ a generated short passphrase survives normalisation unchanged", () => {
  // ⚠⚠ **The one that bites.** ⚠ `normalizePassphrase` deletes every run of non-`a-z`.
  //   ⚠ A digit in the alphabet would be silently removed and no passphrase would ever match.
  //   ⚠ The word list is held to exactly this same invariant.
  for (let i = 0; i < 200; i++) {
    const said = generateShortPassphrase();
    assert.equal(normalizePassphrase(said), said, `normalisation changed ${said}`);
  }
});

test("⚠ the alphabet is a power of two, so masking is uniform", () => {
  // ⚠ Without this, the mask below is biased and some passphrases are likelier than others.
  const bits = Math.log2(SHORT_ALPHABET.length);
  assert.equal(bits, Math.round(bits), `${SHORT_ALPHABET.length} letters is not a power of two`);
  assert.equal(new Set(SHORT_ALPHABET).size, SHORT_ALPHABET.length, "a letter appears twice");
  assert.equal(SHORT_PASSPHRASE_BITS, SHORT_LENGTH * bits);
});

test("⚠ both ends of the range are reachable, and a short input is refused", () => {
  assert.equal(shortPassphraseFromBytes(new Uint8Array([0, 0])), SHORT_ALPHABET[0]?.repeat(2));
  const last = SHORT_ALPHABET[SHORT_ALPHABET.length - 1] as string;
  assert.equal(shortPassphraseFromBytes(new Uint8Array([255, 255])), last + last);
  // ⚠ Never quietly shorter. ⚠ That would weaken the claim without saying so.
  assert.throws(() => shortPassphraseFromBytes(new Uint8Array([1])), RangeError);
});

test("⚠⚠ short is not a licence to stop using a CSPRNG", async () => {
  // ⚠ The same wall `src/passphrase` has. ⚠ A mutation to `Math.random` passed every behavioural
  //   ⚠ check once (kagima#3), ⚠ so the source is read rather than sampled.
  const code = (await readFile("src/field-test.ts", "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /Math\.random/, "field-test mode generates from Math.random");
  assert.match(code, /randomBytes/, "field-test mode does not use a CSPRNG");
});

test("⚠ the banner names both of the things the flag costs", () => {
  // ⚠ One flag, ⚠ two consequences. ⚠ A banner that named one would let the other be unknown.
  const said = fieldTestBanner().join("\n");
  assert.match(said, /passphrase/, "the banner does not say the passphrase changed");
  assert.match(said, /observations/, "the banner does not say reports are collected");
  assert.match(said, new RegExp(`${SHORT_PASSPHRASE_BITS} bits`), "the banner states no number");
});

// ── ⚠ the observation store ─────────────────────────────────────────────────

const observation = (report: string, side = "host") => ({
  roomId: "abcdefghijklmnop",
  side,
  report,
  at: 1,
});

test("⚠⚠ an observation carrying an address is refused", () => {
  // ⚠ The client cannot produce one (`src/diagnostics/report.ts`). ⚠ This is the second wall,
  //   ⚠ and it exists because the client is the half somebody is holding in their hand.
  const store = createObservationStore();
  for (const bad of [
    "selected pair: 192.168.1.42",
    "remote: fe80::1ff:fe23:4567:890a",
    "candidate 0f8e7d6c5b4a39281706.local",
  ]) {
    assert.equal(store.put(observation(bad)), "that report carries an address", bad);
  }
  assert.equal(store.all().length, 0, "a refused observation was kept anyway");
});

test("⚠ a clean observation is kept, and a device replaces its own rather than piling up", () => {
  const store = createObservationStore();
  assert.equal(store.put(observation("frames, held")), null);
  assert.equal(store.put(observation("frames, held — later")), null);
  assert.equal(store.all().length, 1, "one device filled the buffer with copies of itself");
  assert.equal(store.put(observation("frames, held", "guest")), null);
  assert.equal(store.all().length, 2, "the two sides did not stay apart");
});

test("⚠ the buffer is bounded", () => {
  // ⚠ An unbounded debug buffer is a leak that only shows up in the field, ⚠ which is the one
  //   ⚠ place nobody is watching a heap.
  const store = createObservationStore();
  for (let i = 0; i < MAX_OBSERVATIONS; i++) {
    assert.equal(store.put({ ...observation("held"), roomId: `room${i}` }), null);
  }
  assert.equal(
    store.put({ ...observation("held"), roomId: "one-too-many" }),
    "too many observations are being held",
  );
});

test("⚠ a report too long to be one is refused", () => {
  const store = createObservationStore();
  assert.equal(store.put(observation("x".repeat(4097))), "too long to be a report");
});
