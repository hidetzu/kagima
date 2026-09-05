// ⚠⚠ **The wall around the thing every other wall reads through** (`test/source-text.ts`).
//
// ⚠ **A comment stripper that eats real code makes every check above it a decoration** — ⚠ **the
//   ⚠ line it cannot see is a line it cannot fail on, ⚠ and that looks exactly like a pass.**
// ⚠ **This happened here on 2026-09-06** (`CLAUDE.md` § 9).
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { blindSpots, codeOf } from "./source-text.ts";

const filesUnder = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await filesUnder(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
};

test("⚠⚠ a glob in a comment does not swallow the code after it", () => {
  // ⚠⚠ **The shape that hid `src/static.ts` from the persistence wall, reproduced.**
  //
  // ⚠ **The opener is a glob inside a line comment** — ⚠ **a slash, a star.**
  // ⚠ **The closer is the end of an ordinary doc comment further down.**
  // ⚠ **Nothing between them is a comment, ⚠ and stripping blocks first ate all of it.**
  // ⚠ **Both halves have to be here: ⚠ a fixture that closes inside the same comment eats
  //   ⚠ nothing, ⚠ and passes whichever order is used.**
  const source = [
    "// ⚠ Only files under `public/` and `src/client/*.ts` are served.",
    'import { readFileSync } from "node:fs";',
    'export const ROOT = "..";',
    "/** ⚠ A doc comment, and its end is what the glob above found. */",
    "export const serve = () => ROOT;",
  ].join("\n");

  const code = codeOf(source);

  assert.match(code, /from "node:fs"/, "the import was swallowed by a comment");
  assert.match(code, /export const ROOT/, "the export was swallowed by a comment");
  // ⚠ And the comments really did go — ⚠ otherwise this passes for the wrong reason.
  assert.doesNotMatch(code, /public\//, "the line comment survived, so this proves nothing");
  assert.doesNotMatch(code, /A doc comment/, "the block comment survived");
});

test("⚠ a real block comment is still removed", () => {
  const code = codeOf(["/**", " * ⚠ A doc comment.", " */", 'const x = "kept";'].join("\n"));
  assert.doesNotMatch(code, /A doc comment/);
  assert.match(code, /const x/);
});

test("⚠⚠ no file any wall reads has code hidden from it", async () => {
  // ⚠⚠ **Measured against the real tree, ⚠ not argued from the regex** — ⚠ **the regex looked
  //   ⚠ right for months** (`.claude/rules/evidence.md`: ⚠ **not observed ≠ did not happen**).
  //
  // ⚠ **What this is: ⚠ a watch on the tree.** ⚠ **It fails when a comment somebody writes next
  //   ⚠ starts hiding code, ⚠ whatever the stripper does.**
  // ⚠ **What this is NOT: ⚠ the wall on the stripper.** ⚠ **Putting the old order back leaves it
  //   ⚠ green today, ⚠ because the one file that had the shape no longer has it.**
  //   ⚠ **The case above is the one that fails on the order, ⚠ and that was watched.**
  const files = new Map<string, string>();
  for (const dir of ["src", "test", "scripts", "e2e", "external"]) {
    for (const file of await filesUnder(dir)) files.set(file, await readFile(file, "utf8"));
  }

  const blind = blindSpots(files);
  // ⚠ The denominator, announced by the thing that measured it (`.claude/rules/evidence.md`).
  console.log(`  observed: ${files.size} files read, ${blind.length} with code hidden from a wall`);
  assert.deepEqual(blind, [], `a wall cannot see part of: ${blind.join(", ")}`);
});
