// kagima's external tier. ⚠ **The contract is `.claude/rules/verification.md`**:
// ⚠ **at least one check must have the other end be something we did not write.**
// ⚠ **This is that tier, and it is the one that gets skipped.**
//
// ## Usage
//
//   npm run external                              every case
//   npm run external -- --list                    ⚠ name them without running (⚠ loads no browser)
//   npm run external -- --only=chromium-to-firefox one case
//
// ⚠ **Both ends here are browsers we did not write, and they disagree with each other in ways
//   ⚠ neither of them is wrong about.** ⚠ **That disagreement is the point.**
//
// ⚠ **A failure here is still a `FAIL`** — ⚠ **but it is not evidence that our code broke.**
//   ⚠ **The case says plainly which side did not do what** (`.claude/rules/verification.md`).

import { spawnSync } from "node:child_process";
import { SCENARIOS, scenarioNames, titleOf } from "../external/scenarios.ts";
import { build } from "./build.ts";

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? null;

// ⚠ Counting must not load anything heavy. ⚠ `scenarios.ts` imports nothing.
if (argv.includes("--list")) {
  console.log(`external: ${SCENARIOS.length} cases, none run`);
  for (const s of SCENARIOS) console.log(`  ${s.name.padEnd(14)} ${s.sees}`);
  process.exit(0);
}

if (only !== null && only !== "" && !scenarioNames().includes(only)) {
  // ⚠ Never run zero cases and exit 0. ⚠ A typo would read as "everything passed".
  console.error(
    `external: no case named "${only}". ⚠ --list names them: ${scenarioNames().join(", ")}`,
  );
  process.exit(1);
}

// ⚠⚠ **Build before the gate runs** (`docs/adr/0016`).
//
// ⚠ **The browser is served `dist/`, ⚠ not `src/`.** ⚠ **A gate run against a stale `dist/`
//   ⚠ measures the previous run** (`.claude/rules/verification.md`: ⚠ **am I measuring what I
//   ⚠ think I am measuring**).
// ⚠ **It is built here rather than being required of the caller** — ⚠ **a step every caller has
//   ⚠ to remember is not a step, it is a hope.**
// ⚠ **After `--list`, ⚠ because counting must not do work.**
console.log(`external: built ${build().length} files into dist/ first`);

const chosen = only ? [only] : scenarioNames();
// ⚠ Announce the subset on the first line, before anything else.
console.log(
  only
    ? `external: running 1 of ${SCENARIOS.length} cases (--only=${only})`
    : `external: running ${chosen.length} of ${SCENARIOS.length} cases`,
);

// ⚠ Options BEFORE the file list. ⚠ With the glob first, `--test-name-pattern` was accepted and
//   ⚠ ignored: the runner announced "running 1 of 3" and ran all three.
//   ⚠ Announcing one subset while running another is exactly what this obligation exists to stop
//   (`.claude/rules/verification.md`), ⚠ and it was found by reading the count, not the code.
const args = ["--test"];
// ⚠ The pattern is built from the shared title, so selecting cannot drift from naming.
if (only) args.push("--test-name-pattern", titleOf(only).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
args.push("external/**/*.external.ts");

const result = spawnSync("node", args, {
  stdio: "inherit",
  env: {
    ...process.env,
    // ⚠ Where the browser is. ⚠ Named here so a run does not depend on the caller remembering.
    PLAYWRIGHT_BROWSERS_PATH:
      process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? `${process.env["HOME"]}/.cache/ms-playwright`,
  },
});

console.log(
  result.status === 0
    ? `\nexternal: ${chosen.length} of ${chosen.length} cases passed`
    : `\nexternal: the run failed (exit ${result.status})`,
);
process.exit(result.status ?? 1);
