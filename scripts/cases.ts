// The cases `npm run check` runs, and the pure function that picks a subset of them.
//
// ⚠ **Kept separate from the runner on purpose.** ⚠ **Selection is the part that can be wrong
//   ⚠ silently** — ⚠ **a `--only=` that quietly matches nothing looks exactly like a clean run** —
//   ⚠ **so it is a pure function with a test, and the runner does nothing but obey it.**
//
// ⚠ **This file loads nothing.** ⚠ **`--list` must be able to count without loading anything
//   ⚠ heavy** (`.claude/rules/verification.md`), and it imports only from here.

/** One thing that can be run on its own. */
export type Case = {
  readonly name: string;
  /** ⚠ **What this case can show.** ⚠ Named after what separates it, never after how true it feels. */
  readonly sees: string;
  /** ⚠ **Argv, not a shell string.** ⚠ No shell means nothing to quote and nothing to inject. */
  readonly command: readonly string[];
};

// ⚠ **Fast / inner tier only** (`.claude/skills/verify/SKILL.md` § 2).
// ⚠ **Nothing here builds an environment, and nothing here reaches the network.**
// ⚠ **The final gate and the external tier are different entry points and do not belong here.**
export const CASES: readonly Case[] = [
  {
    name: "types",
    // ⚠ Node strips types to run them; ⚠ it does not check them. ⚠ Without this case,
    //   a type error runs happily and is discovered by a human instead of by a machine.
    sees: "the server's types, which running the code never checks",
    command: ["node_modules/.bin/tsc", "--noEmit", "-p", "tsconfig.json"],
  },
  {
    name: "types-client",
    // ⚠ A second config, not a second build system. ⚠ The browser's code is checked against the
    //   DOM and the server's is not — ⚠ so server code cannot reach for `navigator.mediaDevices`
    //   ⚠ and still type-check. ⚠ The split is what keeps `docs/adr/0001` structural rather than
    //   ⚠ a thing to remember.
    sees: "the browser's types, checked against the DOM instead of node",
    command: ["node_modules/.bin/tsc", "--noEmit", "-p", "tsconfig.client.json"],
  },
  {
    name: "lint",
    sees: "what the source says without running it",
    command: ["node_modules/.bin/biome", "lint", "."],
  },
  {
    name: "format",
    // ⚠ Check, never write. ⚠ A check that edits the tree cannot be trusted to have measured it.
    sees: "whether the source is already formatted (⚠ it never rewrites it)",
    command: ["node_modules/.bin/biome", "format", "."],
  },
  {
    name: "unit",
    sees: "pure functions against fixtures, with nothing built",
    // ⚠ A glob, not the directory. ⚠ `node --test test/` resolves `test/` as a module and dies
    //   with MODULE_NOT_FOUND, ⚠ which reads as a failing test rather than as a bad argument.
    command: ["node", "--test", "test/**/*.test.ts"],
  },
];

export type Selection = {
  readonly chosen: readonly Case[];
  /** ⚠ **Set when `--only=` named something that does not exist.** ⚠ **Never silently empty.** */
  readonly unknown: string | null;
};

/**
 * Pick the cases to run.
 *
 * ⚠ **An unknown name is an error, not an empty run.** ⚠ **Returning zero cases quietly is how
 * a typo in `--only=` reads as "everything passed".**
 */
export const selectCases = (cases: readonly Case[], only?: string | null): Selection => {
  if (!only) return { chosen: cases, unknown: null };
  const chosen = cases.filter((c) => c.name === only);
  return chosen.length > 0 ? { chosen, unknown: null } : { chosen: [], unknown: only };
};

/** ⚠ **The one line `--only=` and `--list` are described by.** ⚠ Read out of the cases, never typed twice. */
export const caseNames = (cases: readonly Case[]): string[] => cases.map((c) => c.name);
