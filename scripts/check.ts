// kagima's fast / inner tier. ⚠ **The contract is `.claude/rules/verification.md`**, and
// ⚠ **`.claude/skills/verify/SKILL.md` § 2 is what points here.** ⚠ Neither is restated below.
//
// ## Usage
//
//   npm run check                    every case
//   npm run check -- --list          ⚠ name them without running (⚠ loads nothing heavy)
//   npm run check -- --only=types    one case
//
// ⚠ **It announces which subset it ran on its first line, and the count when it finishes**
//   (`.claude/rules/verification.md`). ⚠ **Never copy that count into a document**
//   (`.claude/rules/evidence.md`) — ⚠ **it is stale the moment it is written.**
//
// ⚠ **A failing case prints what it printed, verbatim.** ⚠ **A summary makes the next reader
//   ⚠ redo the work**, and "it failed" is not the same as "it failed for the reason intended".
//
// Exit: 0 when every case that ran passed, 1 otherwise.
import { spawnSync } from "node:child_process";
import { CASES, caseNames, selectCases } from "./cases.ts";

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? null;

// ⚠ Counting must not load anything heavy (`.claude/rules/verification.md`).
if (argv.includes("--list")) {
  console.log(`check: ${CASES.length} cases, none run`);
  for (const c of CASES) console.log(`  ${c.name.padEnd(8)} ${c.sees}`);
  process.exit(0);
}

const { chosen, unknown } = selectCases(CASES, only);
if (unknown !== null) {
  // ⚠ **Never run zero cases and exit 0.** ⚠ **A typo in --only= would read as "everything passed".**
  console.error(
    `check: no case named "${unknown}". ⚠ --list names them: ${caseNames(CASES).join(", ")}`,
  );
  process.exit(1);
}

// ⚠ Announce the subset on the first line, before anything else.
console.log(
  only
    ? `check: running 1 of ${CASES.length} cases (--only=${only})`
    : `check: running ${chosen.length} of ${CASES.length} cases`,
);

let failed = 0;
for (const c of chosen) {
  const [bin, ...args] = c.command;
  // ⚠ No shell. ⚠ Nothing here is built from anything that came from outside.
  const r = spawnSync(bin as string, args, { encoding: "utf8" });

  if (r.error) {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${c.name} — the case could not run: ${r.error.message}`);
    // ⚠ Could not be run ≠ passed, and ≠ failed on its merits (`.claude/rules/evidence.md`).
    continue;
  }
  if (r.status === 0) {
    console.log(`  \x1b[32mok\x1b[0m   ${c.name} — ${c.sees}`);
    continue;
  }

  failed++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${c.name} — exit ${r.status}. ⚠ What it printed, verbatim:`);
  const said = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd();
  for (const line of (said || "(it printed nothing)").split("\n")) console.log(`    | ${line}`);
}

console.log(
  failed > 0
    ? `\ncheck: ${failed} of ${chosen.length} cases failed`
    : `\ncheck: ${chosen.length} of ${chosen.length} cases passed`,
);
process.exit(failed > 0 ? 1 : 0);
