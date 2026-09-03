# Owner decisions

⚠ **`MUST` = required, `SHOULD` = default, `MAY` = optional.**

⚠ **This file is the owner of `CLAUDE.md` §7-1 and §7-2.** ⚠ **Never restate them there.**

## Grounds

⚠ **Stalling costs more than deciding.** ⚠ **But a decision the owner cannot walk back costs
more than either.** ⚠ **The line between them is the only thing this file draws.**

## Decide yourself vs. ask

⚠ **The default is: decide, and carry it through to the end.**
Ask only where **being wrong cannot be walked back**.

| Decide yourself | Ask |
|---|---|
| Implementation order, how to split it, where tests go | ⚠ **Anything a human reads** on screen or in output |
| What to measure and how | ⚠ **When the scope moves** (crossing `Non-goals`) |
| A bug with exactly one sensible fix | ⚠ **When what may be claimed changes** (`docs/SPEC.md`) |
| Adding docs, comments, tests | Two presentable options that **measurement cannot settle** |

- MUST: Ask with **`AskUserQuestion`**. ⚠ **Never bury the question in prose** (it gets missed).
  ⚠ **kagima did not port the template's Slack hook** (README § 移植しなかったもの).
  ⚠ **So the question reaches the owner in the terminal, and nowhere else.**
- MUST: ⚠ **Nothing but a question is ever pushed at the owner** — no progress, no completions,
  no failures (⚠ **they would bury the one thing that needs an answer**).
- MUST NOT: ⚠ **Never ask what measuring would settle.** Measure first.
- MUST: ⚠ **Asking stops the work.** Finish everything that does not depend on the answer
  **before** asking.
- MUST: ⚠ **Record what was asked.** Once decided, put the reason in `docs/adr/`.
- SHOULD: ⚠ **When the thing being settled is how something looks, hand over the artefacts, not
  a description of them** — the current state and two or three candidates, the recommendation
  and what it costs, and what was dropped.
  ⚠ **kagima did not port the template's `visual-decision` skill** (README § 移植しなかったもの).
  ⚠ **Until it is here, that shape is this clause and nothing enforces it.**

## ⚠ An owner decision outranks your judgement

- MUST: ⚠ **Copy `Owner Decisions` out of an issue verbatim**, and never change one on your own
  judgement.
- MUST: ⚠ **A later comment overrides the issue body.** ⚠ **A decision made mid-flight often
  exists only in a comment.**
- MUST: ⚠ **When body and comment conflict and you cannot tell which is authoritative, ask.**
- MUST: ⚠ **When the issue, the spec, the ADRs and the code disagree, do not decide which is
  right.** ⚠ **Return that a human must decide.**

## ⚠ `ready-for-ai`

⚠ **This is not a priority label.** It marks "an AI can carry this to the end without a human
deciding mid-way".

- MUST: ⚠ **Only a human applies it.** The AI goes as far as producing the verdict
  (`.claude/skills/issue-ready/SKILL.md`).
- MUST NOT: ⚠ **Never apply it, and never remove it.**
- MUST: ⚠ **The label is an entry condition, not a guarantee that it can be implemented.**
  ⚠ **Bodies and comments change after a label is applied, and labels get applied by mistake** —
  ⚠ **so re-run the gate every time.**
- MUST: ⚠ **Even with the label, permission for `git push` and merge is taken every time**
  ([`git.md`](git.md)). ⚠ **The one exception is the Loop Controller's**, and it is written out
  in full there.
