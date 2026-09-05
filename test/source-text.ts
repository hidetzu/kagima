// ⚠⚠ **Reading source as a check, ⚠ without reading the words written to describe it.**
//
// ⚠ **`CLAUDE.md` § 5: ⚠ when a check reads source or documentation, strip the comments first.**
// ⚠ **Several walls in `test/` do exactly that** — ⚠ the passphrase never reaching a log
//   (`.claude/rules/security.md` § 2), ⚠ nothing under `src/` importing a way to persist a room
//   (`docs/adr/0005`), ⚠ no `Math.random` behind an id.
//
// ## ⚠ Why this is one file
//
// ⚠ **It was six copies, ⚠ and all six were wrong the same way** (`CLAUDE.md` § 9, 2026-09-06).
// ⚠ **`CLAUDE.md` § 3: ⚠ never keep two implementations that answer the same question.**
//
// ## ⚠ What this is not
//
// ⚠ **It is not a parser.** ⚠ **It does not know a string from a comment**, ⚠ so a `//` inside a
//   ⚠ string literal is still treated as a comment.
// ⚠ **That direction is the safe one for a wall**: ⚠ it hides text from the check, and a wall that
//   ⚠ sees less can only produce a false pass on a line that is genuinely comment-shaped.
// ⚠ **The direction that bit us was the other one, ⚠ and `blindSpots` below is what watches it.**

/**
 * ⚠ **Source with its comments taken out.**
 *
 * ⚠⚠ **Line comments go first, ⚠ and the order is the whole point.**
 *
 * ⚠ **Taking block comments out first meant a `/*` inside a line comment — ⚠ a glob such as
 * `src/client/*` followed by `.ts` — opened a block that ran on until the next `*` `/`, ⚠ eating
 * real code on the way** (`CLAUDE.md` § 9, 2026-09-06).
 * ⚠ **Stripping the line comment first removes the `/*` with it.**
 */
export const codeOf = (text: string): string =>
  text.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * ⚠ **Files where `codeOf` swallowed a line that is not a comment.**
 *
 * ⚠ **A wall that cannot see a line cannot fail on it, ⚠ and it looks exactly like a wall that
 * passed.** ⚠ **So the stripper is measured against the real tree rather than trusted**
 * (`.claude/rules/evidence.md`: ⚠ **not observed ≠ did not happen**).
 *
 * ⚠ **`import` and `export` are what it looks for, ⚠ because those are what every wall using this
 * is looking at.** ⚠ **It is a sample of the code, ⚠ not all of it, ⚠ and it is said that way.**
 */
export const blindSpots = (files: ReadonlyMap<string, string>): readonly string[] => {
  const declarations = (text: string): number =>
    text.split("\n").filter((line) => /^\s*(import|export)\s/.test(line)).length;

  return [...files]
    .filter(([, text]) => declarations(codeOf(text)) < declarations(text))
    .map(([file]) => file)
    .sort();
};
