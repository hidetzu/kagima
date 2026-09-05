// ⚠⚠ **Putting what a person typed into the one form the comparison expects.**
//
// ⚠ **This is its own file because the browser needs it too, ⚠ and `passphrase.ts` imports
//   ⚠ `node:crypto`** — ⚠ **so it cannot be served to a page.**
// ⚠ **Without this split the page would carry a second copy of the rule, ⚠ and two copies of one
//   ⚠ decision drift** (`CLAUDE.md` § 3). ⚠ **Here the drift would be silent and cruel: ⚠ the page
//   ⚠ would say "that looks fine" about something the server then refuses.**
//
// ⚠ **Nothing here decides whether a passphrase is right.** ⚠ **That is a constant-time comparison,
//   ⚠ on the server, ⚠ and it stays there.** ⚠ **This only removes the ways two people can write
//   ⚠ the same thing.**

/** ⚠ **Not a letter**, so normalisation can rebuild it from whatever the person typed between words. */
export const SEPARATOR = "-";

/**
 * Put what a person typed into the one form the comparison expects.
 *
 * ⚠ **This does not decide whether the passphrase is right.** ⚠ **That is kagima#4, and it
 * compares in constant time.** ⚠ **This only removes the ways two people can write the same thing.**
 */
export const normalizePassphrase = (input: string): string =>
  input
    // ⚠ Full-width letters and the ideographic space arrive from Japanese IMEs.
    //   ⚠ NFKC folds them to ASCII; without it "ｓａｋｕｒａ" never matches "sakura".
    .normalize("NFKC")
    .toLowerCase()
    // ⚠ Any run of non-letters becomes one separator — spaces, hyphens, underscores, dots.
    //   ⚠ People retype a spoken phrase with whatever separator they reach for.
    .replace(/[^a-z]+/g, SEPARATOR)
    // ⚠ Leading and trailing separators come from the replace above, and from stray punctuation.
    .replace(/^-+|-+$/g, "");
