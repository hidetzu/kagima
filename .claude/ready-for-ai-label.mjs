// The label names, and where an application of `ready-for-ai` is recorded (⚠ **this one place**).
//
// ⚠ **Two tools and four documents talk about the same string.**
//
//     .claude/tools/ready-for-ai.mjs   applies the label, and appends the record
//     .claude/tools/label-eval.mjs     reads the record back, and the timeline it is compared to
//     .claude/rules/owner-decisions.md states when the label may be applied
//     .claude/skills/{issue-ready,loop-controller}/SKILL.md   run the gate around it
//
// ⚠ **The two tools import from here.** ⚠ **The documents cannot import anything.**
//   ⚠ **So `docs-check.mjs` case `ready-for-ai-label-line` asserts that the rule file actually
//   ⚠ names the string declared below** — ⚠ **renaming the label in one place alone fails.**
//   ⚠ **Same shape as `telemetry-dir.mjs` and the `.gitignore` line**, and for the same reason:
//   ⚠ **two copies of one decision drift silently unless something mechanical holds them together.**
//
// ⚠ **The record lives in the telemetry directory**, so it inherits that directory's properties:
//   ⚠ **it never enters git, and not one byte of it leaves this machine** (see `.gitignore`).
//
// ⚠ **The record is what makes "who applied this label" answerable at all.**
//   ⚠ **`gh` acts as the repository owner's account, so GitHub's own timeline shows the same
//   ⚠ actor whether a human clicked it or the AI called the API.**
//   ⚠ **Without a local record there is nothing to subtract, and the question is unanswerable.**
//   ⚠ **See `label-eval.mjs` for what that still cannot show.**
import { join } from "node:path";
import { telemetryDir } from "./telemetry-dir.mjs";

// ⚠ **The label that marks "an AI can carry this to the end"**
//   (⚠ the exact string `.claude/rules/owner-decisions.md` must name).
export const READY_FOR_AI_LABEL = "ready-for-ai";

// ⚠ **The label that means the owner has not decided.** ⚠ **Its presence forbids the other one.**
export const NEEDS_DECISION_LABEL = "needs-decision";

// ⚠ **Append-only.** ⚠ **One line per application. ⚠ Never rewritten, never compacted.**
export const LABEL_LOG_NAME = "labels.jsonl";

export const labelLogPath = () => join(telemetryDir(), LABEL_LOG_NAME);

// ⚠ **The verdict must say this before the label may be applied.**
//   ⚠ **Checked mechanically, so the tool cannot be pointed at a verdict that said anything else.**
export const YES_MARKER = /^\s*(?:⚠\s*)?\**\s*Ready for AI\s*:\s*\**\s*YES\b/im;
