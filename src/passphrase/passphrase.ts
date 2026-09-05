// Generate and normalise a passphrase.
//
// ⚠ **The passphrase is the second wall.** ⚠ **The room URL is the first, and it travels over a
//   ⚠ channel we do not control** (`.claude/rules/security.md` § 1).
//
// ⚠ **It is short, because a person says it out loud.** ⚠ **So it is the rate limit that makes it
//   ⚠ safe, not the passphrase** (`docs/adr/0004`, kagima#5).
//   ⚠ **Never argue a rate limit away by pointing at the length of this.**
//
// ⚠ **What may be claimed about the strength is `PASSPHRASE_BITS`, and it is computed, never
//   ⚠ typed.** ⚠ **"hard to guess" is not a claim; a number with its derivation is**
//   (`.claude/rules/evidence.md`).
//
// ## ⚠ Why normalising does not cost entropy here
//
// ⚠ **Normalising usually lowers entropy**, because it merges values the generator could produce
//   (⚠ folding case when the generator emits mixed case is the classic way).
// ⚠ **It does not here, and the reason is specific: the generator only ever emits the canonical
//   ⚠ form** — lowercase ASCII words joined by `SEPARATOR`. ⚠ **So normalisation merges inputs a
//   ⚠ person typed, and merges nothing the generator can emit.**
// ⚠ **`test/passphrase.test.ts` holds that shut**: ⚠ **normalising any generated passphrase must
//   ⚠ return it unchanged.** ⚠ **The day the generator emits something non-canonical, the claim
//   ⚠ breaks and that test fails.**
import { randomBytes } from "node:crypto";
import { SEPARATOR } from "./normalize.ts";
import { BITS_PER_WORD, WORDS } from "./words.ts";

// ⚠ Re-exported so every existing caller keeps one import. ⚠ The rule itself lives in one file.
export { SEPARATOR, normalizePassphrase } from "./normalize.ts";

/** ⚠ **How many words are said.** ⚠ Four is the trade recorded in `docs/adr/0007`. */
export const WORD_COUNT = 4;

/**
 * ⚠ **The strength claim, derived from the two numbers it depends on.**
 * ⚠ **Never write this value into a document** (`.claude/rules/evidence.md`) —
 * ⚠ **it changes the moment either input does.**
 */
export const PASSPHRASE_BITS = WORD_COUNT * BITS_PER_WORD;

// ⚠ Selects the low BITS_PER_WORD bits. ⚠ Uniform only because WORDS.length is exactly
//   2 ** BITS_PER_WORD — ⚠ a test asserts that, and without it this masking is biased.
const INDEX_MASK = (1 << BITS_PER_WORD) - 1;

/**
 * Build a passphrase from raw bytes.
 *
 * ⚠ **Pure, so the mapping can be tested against fixtures rather than sampled.**
 * ⚠ **A statistical test of `generatePassphrase` would be flaky and would still not show that
 * both ends of the range are reachable.**
 *
 * @param bytes ⚠ **One byte per word.** ⚠ Fewer throws; extra bytes are ignored.
 */
export const passphraseFromBytes = (bytes: Uint8Array): string => {
  if (bytes.length < WORD_COUNT) {
    // ⚠ Never quietly produce a shorter passphrase. ⚠ It would weaken the claim silently.
    throw new RangeError(`need ${WORD_COUNT} bytes, got ${bytes.length}`);
  }
  const words: string[] = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    const byte = bytes[i] as number;
    words.push(WORDS[byte & INDEX_MASK] as string);
  }
  return words.join(SEPARATOR);
};

/**
 * ⚠ **The generator.** ⚠ **`randomBytes` is a CSPRNG; `Math.random` is not and must never appear
 * anywhere near this** (`.claude/rules/security.md` § 1).
 */
export const generatePassphrase = (): string => passphraseFromBytes(randomBytes(WORD_COUNT));
