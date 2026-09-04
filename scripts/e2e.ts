// kagima's final gate. ⚠ **The contract is `.claude/rules/verification.md`**, and
// ⚠ **`.claude/skills/verify/SKILL.md` § 3 is what points here.** ⚠ Neither is restated below.
//
// ## Usage
//
//   npm run e2e                        every case
//   npm run e2e -- --list              ⚠ name them without running (⚠ loads no browser)
//   npm run e2e -- --only=frames       one case
//
// ⚠ **This starts a server and launches Chromium.** ⚠ **That is what makes it the final gate
//   ⚠ rather than part of `npm run check`**, ⚠ **and why the cases live in `e2e/` where the fast
//   ⚠ tier cannot pick them up.**
//
// ⚠ **A green run here is evidence about the browser it ran in, and nothing else**
//   (⚠ the external tier — a second engine — is kagima#14, and it is not this).
import { spawnSync } from "node:child_process";
import { SCENARIOS, scenarioNames, titleOf } from "../e2e/scenarios.ts";

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? null;

// ⚠ Counting must not load anything heavy. ⚠ `scenarios.ts` imports nothing.
if (argv.includes("--list")) {
  console.log(`e2e: ${SCENARIOS.length} cases, none run`);
  for (const s of SCENARIOS) console.log(`  ${s.name.padEnd(14)} ${s.sees}`);
  process.exit(0);
}

if (only !== null && only !== "" && !scenarioNames().includes(only)) {
  // ⚠ Never run zero cases and exit 0. ⚠ A typo would read as "everything passed".
  console.error(`e2e: no case named "${only}". ⚠ --list names them: ${scenarioNames().join(", ")}`);
  process.exit(1);
}

const chosen = only ? [only] : scenarioNames();
// ⚠ Announce the subset on the first line, before anything else.
console.log(
  only
    ? `e2e: running 1 of ${SCENARIOS.length} cases (--only=${only})`
    : `e2e: running ${chosen.length} of ${SCENARIOS.length} cases`,
);

// ⚠ Options BEFORE the file list. ⚠ With the glob first, `--test-name-pattern` was accepted and
//   ⚠ ignored: the runner announced "running 1 of 3" and ran all three.
//   ⚠ Announcing one subset while running another is exactly what this obligation exists to stop
//   (`.claude/rules/verification.md`), ⚠ and it was found by reading the count, not the code.
const args = ["--test"];
// ⚠ The pattern is built from the shared title, so selecting cannot drift from naming.
if (only) args.push("--test-name-pattern", titleOf(only).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
args.push("e2e/**/*.e2e.ts");

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
    ? `\ne2e: ${chosen.length} of ${chosen.length} cases passed`
    : `\ne2e: the run failed (exit ${result.status})`,
);
process.exit(result.status ?? 1);
