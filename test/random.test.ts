// ⚠⚠ **The one place kagima draws randomness, ⚠ and the wall around it.**
//
// ⚠ **Every other check says "draw from `src/random.ts`".** ⚠ **So if this file were allowed to
//   ⚠ draw from anywhere, ⚠ every one of those walls would fall at once.**
// ⚠ **This is the check that stops that.**
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { base64url, base64urlDecode, randomBytes, randomToken } from "../src/random.ts";
import { codeOf } from "./source-text.ts";

test("⚠⚠ the seam draws from the platform CSPRNG and from nothing else", async () => {
  // ⚠ `crypto.getRandomValues` is a CSPRNG in Node and in Workers alike (`docs/adr/0015`).
  //   ⚠ `Math.random` makes no such promise (`.claude/rules/security.md` § 1).
  const code = codeOf(await readFile("src/random.ts", "utf8"));
  assert.match(code, /crypto\.getRandomValues/, "the seam does not use the platform CSPRNG");
  assert.doesNotMatch(code, /Math\.random/, "the seam reaches for Math.random");
  // ⚠ And it must not quietly go back to a runtime-specific name — ⚠ that is what moved.
  assert.doesNotMatch(code, /node:crypto/, "the seam is bound to one runtime again");
  assert.doesNotMatch(code, /\bBuffer\b/, "the seam uses Buffer, which Workers does not have");
});

test("⚠ it returns the number of bytes asked for, and they are not all the same", () => {
  for (const n of [1, 4, 16, 32]) assert.equal(randomBytes(n).length, n);
  // ⚠ Not a test of randomness — ⚠ that cannot be tested here. ⚠ It catches a stub returning zeros,
  //   ⚠ which is the failure that would otherwise look exactly like working code.
  const drawn = new Set<string>();
  for (let i = 0; i < 50; i++) drawn.add(randomToken(16));
  assert.equal(drawn.size, 50, "fifty draws collided, which a CSPRNG would not do");
});

test("⚠⚠ base64url is base64url, not base64", () => {
  // ⚠ It goes into URLs and into a token. ⚠ `+`, `/` and `=` would each break something
  //   ⚠ different, ⚠ and only one of them loudly.
  for (let i = 0; i < 200; i++) {
    const said = randomToken(32);
    assert.doesNotMatch(said, /[+/=]/, `not base64url: ${said}`);
    assert.match(said, /^[A-Za-z0-9_-]+$/, said);
  }
  // ⚠ A fixed vector, ⚠ so the mapping is pinned and not merely plausible.
  assert.equal(base64url(new Uint8Array([251, 255, 190])), "-_--");
  assert.equal(base64url(new Uint8Array([0])), "AA");
  assert.equal(base64url(new Uint8Array([])), "");
});

test("⚠⚠ what base64url writes, base64urlDecode reads back", () => {
  // ⚠ **A pair that drifts apart is worse than either half being wrong** — ⚠ **the token would
  //   ⚠ verify and then decode to nonsense, ⚠ and only the second half would be noticed.**
  for (let i = 0; i < 200; i++) {
    const bytes = randomBytes(1 + (i % 40));
    assert.deepEqual([...base64urlDecode(base64url(bytes))], [...bytes], `round trip failed`);
  }
  // ⚠ Fixed vectors, ⚠ so the mapping is pinned rather than merely self-consistent.
  assert.deepEqual([...base64urlDecode("-_--")], [251, 255, 190]);
  assert.deepEqual([...base64urlDecode("AA")], [0]);
  assert.deepEqual([...base64urlDecode("")], []);
});

test("⚠ text survives the round trip, including what is not ASCII", () => {
  // ⚠ A room id is ASCII, ⚠ but the payload is built by hand and a nickname is not far away.
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  for (const text of ["room-a:123:xyz", "あきかぜ", "a:1:", "", "🌸"]) {
    assert.equal(dec.decode(base64urlDecode(base64url(enc.encode(text)))), text);
  }
});
