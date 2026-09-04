// ⚠ **What is under test is the passphrase's stated properties**, not the words themselves.
//
// ⚠ **Every claim `docs/adr/0007` makes has a case here.** ⚠ **A claim with no case is a promise**
//   (`.claude/rules/verification.md`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  PASSPHRASE_BITS,
  SEPARATOR,
  WORD_COUNT,
  generatePassphrase,
  normalizePassphrase,
  passphraseFromBytes,
} from "../src/passphrase/passphrase.ts";
import { BITS_PER_WORD, WORDS } from "../src/passphrase/words.ts";

// ── the word list ───────────────────────────────────────────────────────────
// ⚠ These are what make the entropy claim and the uniform selection true.
// ⚠ Break any of them by adding a word, and nothing else would notice.

test("⚠ the list length is exactly 2 ** BITS_PER_WORD", () => {
  // ⚠ Uniform selection masks a random byte. ⚠ With any other length that masking is biased,
  //   and some words become likelier than others — ⚠ silently.
  assert.equal(WORDS.length, 2 ** BITS_PER_WORD);
});

test("⚠ every word is unique", () => {
  // ⚠ A duplicate makes one index unreachable and another twice as likely.
  assert.equal(new Set(WORDS).size, WORDS.length);
});

test("⚠ every word is lowercase ASCII letters only", () => {
  // ⚠ Anything else needs an IME to type, and the guest is typing what they heard.
  for (const w of WORDS) assert.match(w, /^[a-z]+$/, `${w} is not lowercase ASCII`);
});

test("⚠ every word is at least 5 letters", () => {
  // ⚠ Shorter words collide constantly under the next test. ⚠ This is why the bar exists.
  for (const w of WORDS) assert.ok(w.length >= 5, `${w} is shorter than 5`);
});

test("⚠ no two words are one edit apart", () => {
  // ⚠ This is the case that costs something to keep true, and it is the one that matters.
  // ⚠ A mishearing must not land on another valid word — ⚠ the guest would then fail with a
  //   ⚠ well-formed passphrase and burn the room's rate-limit budget (kagima#5).
  //   ⚠ That is a denial of service we would have built ourselves.
  const oneEdit = (a: string, b: string): boolean => {
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) {
      let diff = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      return diff === 1;
    }
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    for (let i = 0; i < long.length; i++) {
      if (long.slice(0, i) + long.slice(i + 1) === short) return true;
    }
    return false;
  };
  const collisions: string[] = [];
  for (let i = 0; i < WORDS.length; i++) {
    for (let j = i + 1; j < WORDS.length; j++) {
      const a = WORDS[i] as string;
      const b = WORDS[j] as string;
      if (oneEdit(a, b)) collisions.push(`${a}/${b}`);
    }
  }
  assert.deepEqual(collisions, [], `words one edit apart: ${collisions.join(", ")}`);
});

test("⚠ no word spells a long vowel ambiguously", () => {
  // ⚠ "hodou" could be written hodō or hodoo by the person retyping it.
  //   ⚠ Doubled i (torii, shiitake) is not this: it is the only correct spelling.
  for (const w of WORDS) {
    assert.doesNotMatch(w, /(ou|uu|oo)/, `${w} has an ambiguously romanised long vowel`);
  }
});

// ── the strength claim ──────────────────────────────────────────────────────

test("⚠ PASSPHRASE_BITS is derived, not asserted independently", () => {
  // ⚠ The point is that the number moves when either input moves. ⚠ A hard-coded 28 here would
  //   keep passing after someone changed WORD_COUNT, and the claim would quietly become false.
  assert.equal(PASSPHRASE_BITS, WORD_COUNT * BITS_PER_WORD);
  assert.equal(PASSPHRASE_BITS, WORD_COUNT * Math.log2(WORDS.length));
});

// ── generation ──────────────────────────────────────────────────────────────

test("a passphrase is WORD_COUNT words from the list", () => {
  const words = generatePassphrase().split(SEPARATOR);
  assert.equal(words.length, WORD_COUNT);
  for (const w of words) assert.ok(WORDS.includes(w), `${w} is not in the list`);
});

test("⚠ both ends of the index range are reachable", () => {
  // ⚠ Fixtures, not sampling. ⚠ A statistical test would be flaky and would still not show
  //   that index 0 and index 127 are both produced.
  const first = WORDS[0] as string;
  const last = WORDS[WORDS.length - 1] as string;
  assert.equal(
    passphraseFromBytes(new Uint8Array([0, 0, 0, 0])),
    Array(WORD_COUNT).fill(first).join(SEPARATOR),
  );
  assert.equal(
    passphraseFromBytes(new Uint8Array([0xff, 0xff, 0xff, 0xff])),
    Array(WORD_COUNT).fill(last).join(SEPARATOR),
  );
});

test("⚠ the mask ignores the bits above BITS_PER_WORD", () => {
  // ⚠ This is what makes the selection uniform. ⚠ Byte 0x00 and byte 0x80 must be the same word;
  //   if they were not, the high bit would be carrying information the list cannot represent.
  assert.equal(
    passphraseFromBytes(new Uint8Array([0x00, 0x80, 0x01, 0x81])),
    passphraseFromBytes(new Uint8Array([0x00, 0x00, 0x01, 0x01])),
  );
});

test("⚠ too few bytes throws rather than shortening the passphrase", () => {
  // ⚠ A shorter passphrase would weaken PASSPHRASE_BITS with nothing announcing it.
  assert.throws(() => passphraseFromBytes(new Uint8Array([1, 2])), RangeError);
});

// ── normalisation ───────────────────────────────────────────────────────────

test("⚠ normalising a generated passphrase returns it unchanged", () => {
  // ⚠ This is the whole entropy argument. ⚠ Normalisation costs nothing here only because the
  //   generator emits the canonical form already. ⚠ If that stops being true, this fails.
  for (let i = 0; i < 200; i++) {
    const p = generatePassphrase();
    assert.equal(normalizePassphrase(p), p);
  }
});

test("normalising folds how a person might retype what they heard", () => {
  const canonical = "sakana-tsuki-arashi-midori";
  for (const typed of [
    "Sakana Tsuki Arashi Midori",
    "SAKANA-TSUKI-ARASHI-MIDORI",
    "  sakana_tsuki  arashi.midori  ",
    "sakana--tsuki---arashi-midori",
    "ｓａｋａｎａ　ｔｓｕｋｉ　ａｒａｓｈｉ　ｍｉｄｏｒｉ", // ⚠ full width, from a Japanese IME
  ]) {
    assert.equal(normalizePassphrase(typed), canonical, `did not fold: ${typed}`);
  }
});

test("⚠ normalising never merges two different passphrases", () => {
  // ⚠ If it did, the entropy claim would be wrong by exactly as much.
  const seen = new Map<string, string>();
  for (let i = 0; i < 500; i++) {
    const p = generatePassphrase();
    const n = normalizePassphrase(p);
    const already = seen.get(n);
    if (already !== undefined) assert.equal(already, p, `${already} and ${p} normalise alike`);
    seen.set(n, p);
  }
});

// ── ⚠ where the randomness comes from ───────────────────────────────────────
// ⚠ **Nothing above would fail if `randomBytes` were swapped for `Math.random`.**
//   ⚠ **Every property tested so far would still hold, and the passphrase would be predictable.**
//   ⚠ **`.claude/rules/security.md` § 1 forbids it, and a rule with no check is a promise.**
//
// ⚠ **So this reads the source.** ⚠ **It is not elegant, and the alternative is having no wall
//   ⚠ at all in front of the one property that matters most here.**
// ⚠ **It covers all of `src/`, not just this module**, ⚠ so it keeps holding as code arrives.

test("⚠ nothing under src/ reaches for Math.random", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const walk = async (dir: string): Promise<string[]> => {
    const out: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(p)));
      else if (e.name.endsWith(".ts")) out.push(p);
    }
    return out;
  };

  const offenders: string[] = [];
  for (const file of await walk("src")) {
    const text = await readFile(file, "utf8");
    // ⚠ Strip comments first, or this finds the sentence that describes it (`CLAUDE.md` §5).
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/Math\s*\.\s*random/.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `Math.random appears in: ${offenders.join(", ")}`);
});

test("⚠ the passphrase generator draws from node:crypto", () => {
  // ⚠ The negative test above cannot show that a CSPRNG *is* used — only that a known-bad one
  //   ⚠ is not. ⚠ "not observed ≠ did not happen" (`.claude/rules/evidence.md`), so assert it.
  const src = readFileSync("src/passphrase/passphrase.ts", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /import\s*\{[^}]*\brandomBytes\b[^}]*\}\s*from\s*"node:crypto"/);
  assert.match(code, /randomBytes\(WORD_COUNT\)/);
});
