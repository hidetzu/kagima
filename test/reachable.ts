// ⚠⚠ **What a file actually pulls in** (kagima#69).
//
// ⚠ **A wall that reads one file's text asks "does this file reach for the platform".**
// ⚠ **The question worth asking is "does anything this file *loads* reach for the platform"** —
//   ⚠ **because that is what runs.**
//
// ⚠ **`src/signaling/session.ts` said it was platform-free and the wall agreed.**
// ⚠ **It imports `./messages.ts`, ⚠ which used `Buffer`.** ⚠ **One step away was far enough to be
//   ⚠ invisible.**
//
// ## ⚠ What this is not
//
// ⚠ **Not a module resolver.** ⚠ **It follows relative specifiers inside the tree and nothing
//   ⚠ else** — ⚠ **a bare specifier is somebody else's package, ⚠ and `node:` is the thing being
//   ⚠ looked for rather than followed.**
// ⚠ **`import type` is followed too.** ⚠ **It is erased at runtime, ⚠ so following it is stricter
//   ⚠ than it needs to be** — ⚠ **and strict is the safe direction for a wall.**
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { codeOf } from "./source-text.ts";

/** ⚠ Relative specifiers only. ⚠ Comments are stripped first (`CLAUDE.md` § 5). */
const importsOf = (code: string): string[] =>
  [...codeOf(code).matchAll(/from\s+"(\.[^"]*)"/g)].map((m) => m[1] ?? "");

/**
 * ⚠ **Every file reachable from `entries`, ⚠ including the entries themselves.**
 *
 * ⚠ **Paths come back repo-relative and sorted**, ⚠ so a failure names them the same way twice.
 * ⚠ **A specifier that does not resolve to a file is skipped rather than thrown on** — ⚠ **this
 * is a wall, ⚠ and a wall that crashes on an unrelated typo stops being run.**
 */
export const reachableFrom = async (entries: readonly string[]): Promise<string[]> => {
  const seen = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    let code: string;
    try {
      code = await readFile(file, "utf8");
    } catch {
      seen.delete(file);
      continue;
    }
    for (const specifier of importsOf(code)) {
      queue.push(normalize(join(dirname(file), specifier)));
    }
  }
  return [...seen].sort();
};
