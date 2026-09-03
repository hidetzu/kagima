#!/usr/bin/env node
// Count who applied `ready-for-ai`, and ⚠ say plainly which half of that is inferred.
//
// ⚠ **This is not scoring.** ⚠ **Observation only** (same contract as `telemetry-eval.mjs`).
// ⚠ **Read-only.** ⚠ **It writes nothing, and it never applies or removes a label.**
//
// ## Why this tool exists
//
// ⚠ **kagima let the AI apply `ready-for-ai` itself on 2026-09-04**
//   (`docs/adr/0006-let-the-ai-apply-ready-for-ai-and-gate-on-merge-instead.md`).
// ⚠ **The question that change has to keep answering is: how often does the owner still have to
//   ⚠ do it?** ⚠ **A number that only ever goes down without being looked at is not evidence
//   ⚠ of autonomy; it is evidence that nobody looked.**
//
// ## ⚠ What is observed, and what is inferred
//
//     observed   how many times the label was applied, from GitHub's own timeline
//     observed   how many of those the AI recorded applying, from .claude/telemetry/labels.jsonl
//     ⚠ INFERRED  the remainder, attributed to the owner
//
// ⚠ **The remainder is a subtraction, not a measurement.** ⚠ **It is labelled as such in the
//   ⚠ output, every time, and that label is not to be removed to make the report read better.**
//
// ### ⚠ Why the actor field cannot be used
//
// ⚠ **`gh` authenticates as the repository owner's account.** ⚠ **So GitHub records the same
//   ⚠ actor whether a human clicked the label or the AI called the API.**
//   ⚠ **The timeline's `actor` therefore answers a different question than the one asked here,
//   ⚠ and using it would be dressing a guess as a measurement** (`.claude/rules/evidence.md`).
//
// ### ⚠ What this still cannot show
//
//     ⚠ a label the AI applied on another machine    the record is local, so it reads as the owner's
//     ⚠ a label applied before this tool existed     no record exists, so it reads as the owner's
//     ⚠ a label applied and then removed and re-applied   the timeline counts each application
//     ⚠ whether applying it was the right call       ⚠ nothing here judges that
//
// ⚠ **Every one of those biases the inferred number upward — ⚠ toward the owner.**
//   ⚠ **That is the safe direction for this particular question, ⚠ and saying so is not the same
//   ⚠ as correcting for it.** ⚠ **No correction is applied.**
//
// ## Usage
//
//   node .claude/tools/label-eval.mjs
//   node .claude/tools/label-eval.mjs --json
//
//   # ⚠ Read a different record (⚠ how a test exercises this without touching the real one)
//   CLAUDE_DEV_TELEMETRY_DIR=/tmp/xxx node .claude/tools/label-eval.mjs
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { READY_FOR_AI_LABEL, labelLogPath } from "../ready-for-ai-label.mjs";

const JSON_OUT = process.argv.includes("--json");
const gh = (a) => execFileSync("gh", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// ---- the local record (⚠ what the AI says it did) --------------------------
// ⚠ **Never discard a broken line silently.** ⚠ **Report how many could not be read** —
//   ⚠ **discarded quietly, nobody can tell the denominator shrank.**
const log = labelLogPath();
const recorded = [], unreadable = [];
if (existsSync(log)) {
  readFileSync(log, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const r = JSON.parse(line);
      if (r.event === "label_applied" && r.label === READY_FOR_AI_LABEL && r.by === "ai") recorded.push(r);
    } catch { unreadable.push(i + 1); }
  });
}
const recordedKeys = new Set(recorded.map((r) => `${r.repo}#${r.issue}`));

// ---- GitHub's timeline (⚠ what actually happened) --------------------------
let repo, applications = [], reachable = true, why = null;
try {
  repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  // ⚠ **Every issue, not only the ones currently labelled** — ⚠ a label that was later removed
  //   ⚠ was still applied once, and the question is about applications.
  const numbers = JSON.parse(
    gh(["issue", "list", "--state", "all", "--limit", "500", "--json", "number"]),
  ).map((i) => i.number);
  for (const n of numbers) {
    let events;
    try {
      events = JSON.parse(gh(["api", `repos/${repo}/issues/${n}/timeline`, "--paginate"]));
    } catch { continue; }
    for (const e of events) {
      if (e.event === "labeled" && e.label?.name === READY_FOR_AI_LABEL) {
        applications.push({ issue: n, at: e.created_at });
      }
    }
  }
} catch (e) {
  // ⚠ **Could not be obtained ≠ there were none** (`.claude/rules/evidence.md`).
  reachable = false;
  why = e?.message?.split("\n")[0] ?? String(e);
}

const total = applications.length;
const byAi = applications.filter((a) => recordedKeys.has(`${repo}#${a.issue}`)).length;
const inferredOwner = total - byAi;

if (JSON_OUT) {
  console.log(JSON.stringify({
    label: READY_FOR_AI_LABEL,
    timeline_reachable: reachable,
    timeline_error: why,
    observed_applications_total: reachable ? total : null,
    observed_applications_recorded_by_ai: reachable ? byAi : null,
    inferred_applications_by_owner: reachable ? inferredOwner : null,
    inferred: ["inferred_applications_by_owner"],
    local_records: recorded.length,
    unreadable_record_lines: unreadable,
  }, null, 2));
  process.exit(0);
}

console.log(`ready-for-ai — who applied it`);
console.log(`Label: ${READY_FOR_AI_LABEL}`);
console.log("");

if (!reachable) {
  // ⚠ **Say it could not be obtained.** ⚠ **Never print 0 and let it read as "none happened".**
  console.log(`⚠ GitHub's timeline could not be read: ${why}`);
  console.log(`⚠ That is not the same as "the label was never applied."`);
  console.log(`⚠ Nothing below is a count of applications.`);
  console.log("");
  console.log(`Local record only (⚠ what the AI says it did, ⚠ not a denominator):`);
  console.log(`  applications recorded by the AI: ${recorded.length}`);
  if (unreadable.length) console.log(`  ⚠ unreadable lines in the record: ${unreadable.join(", ")}`);
  process.exit(0);
}

console.log(`Observed (GitHub timeline)`);
console.log(`  applications, total:              ${total}`);
console.log(`  of those, recorded by the AI:     ${byAi}`);
console.log("");
console.log(`⚠ INFERRED — this is a subtraction, not a measurement`);
console.log(`  attributed to the owner:          ${inferredOwner}`);
console.log("");
console.log(`Local record`);
console.log(`  lines the AI wrote:               ${recorded.length}`);
if (unreadable.length) console.log(`  ⚠ unreadable lines:               ${unreadable.join(", ")}`);
console.log("");
console.log(`How to read this`);
console.log(`  ! the owner figure is total minus what the AI recorded. It is not observed.`);
console.log(`  ! gh authenticates as the owner, so the timeline's actor cannot separate them.`);
console.log(`  ! a label the AI applied on another machine, or before this tool existed,`);
console.log(`    has no local record and is counted as the owner's.`);
console.log(`  ! every one of those biases the inferred figure toward the owner.`);
console.log(`    ! no correction is applied for that.`);
console.log(`  ! nothing here says whether applying the label was the right call.`);
