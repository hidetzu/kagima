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
  right.** ⚠ **Return that a human must decide** — ⚠ **except for the one conflict below.**

### ⚠ The one conflict the AI resolves itself

⚠ **kagima added this on 2026-09-04, by owner decision**
([`../../docs/adr/0008-let-product-md-outrank-an-issues-acceptance-criteria.md`](../../docs/adr/0008-let-product-md-outrank-an-issues-acceptance-criteria.md)).

⚠ **When an issue's `Acceptance Criteria` contradict [`../../docs/PRODUCT.md`](../../docs/PRODUCT.md),
`PRODUCT.md` wins.** ⚠ **Decide it, build to `PRODUCT.md`, and report what you did.**
⚠ **Do not stop and ask.**

⚠ **Grounds: `PRODUCT.md` is the product's single source, and an issue's acceptance criteria are
drafted downstream of it — usually by the AI itself.** ⚠ **Treating a drafting slip as an owner
question spends the owner's attention on a document they did not write.**

- MUST: ⚠ **Say it in the completion report and on the PR**, ⚠ **naming the criterion, what
  `PRODUCT.md` requires, and what was built.** ⚠ **A silent resolution is not this clause.**
- MUST: ⚠ **Propose the corrected criterion.** ⚠ **Never edit the issue's `Acceptance Criteria`
  to match what was built** — ⚠ **that erases the evidence that they disagreed.**
- MUST NOT: ⚠ **Never widen scope through this clause.** ⚠ **It resolves a contradiction; it does
  not license work `PRODUCT.md` merely permits.**

⚠ **This carve-out is exactly one pair, and it does not generalise:**

| Conflict | Who resolves it |
|---|---|
| ⚠ **an issue's `Acceptance Criteria` vs. `PRODUCT.md`** | ⚠ **the AI. Build to `PRODUCT.md`, report it** |
| an issue's `Owner Decisions` vs. anything | ⚠ **the owner.** ⚠ **`Owner Decisions` are never overridden** |
| `PRODUCT.md` vs. an ADR | ⚠ **the owner** |
| an ADR vs. the code | ⚠ **the owner** |
| `docs/SPEC.md` vs. the code | ⚠ **the owner** |

⚠ **Precedence, when nothing above applies:**

```text
Owner Decisions in the issue, and any later comment   ⚠ highest. Never overridden
docs/PRODUCT.md                                       ⚠ the product's single source
docs/adr/                                             why it was decided that way
docs/SPEC.md                                          what may be claimed today
the issue's own Acceptance Criteria and body          ⚠ drafted downstream of all of the above
```

⚠ **Knowing the order is not permission to apply it.** ⚠ **Only the one pair above is yours.**

## ⚠ `ready-for-ai`

⚠ **This is not a priority label.** It marks "an AI can carry this to the end without a human
deciding mid-way".

⚠ **kagima changed this clause on 2026-09-04, by owner decision.**
⚠ **Upstream, only a human may apply the label. Here, the AI applies it under the conditions
below** ([`../../docs/adr/0006-let-the-ai-apply-ready-for-ai-and-gate-on-merge-instead.md`](../../docs/adr/0006-let-the-ai-apply-ready-for-ai-and-gate-on-merge-instead.md)
carries the decision, the grounds, and what moved to pay for it).
⚠ **This divergence from the template is deliberate and recorded.** ⚠ **Never quietly re-align it.**

### ⚠ The gate did not get weaker. It moved.

```text
before   human applies ready-for-ai  ->  human approves the plan  ->  ... -> merge (covered by that approval)
now      AI applies ready-for-ai     ->  ... -> PR                ->  ⚠ human approves the merge
```

- MUST: ⚠ **Exactly one human gate exists per issue, and it is the merge.**
  ⚠ **Never end up with zero.** ⚠ **If you find yourself about to merge without having asked,
  you have misread this file.**
- MUST: ⚠ **`git push` and opening the PR are covered inside the Loop Controller and nowhere else**
  ([`git.md`](git.md)). ⚠ **Merge never is.**

### ⚠ When the AI may apply it

- MAY: ⚠ **Apply it only when [`../skills/issue-ready/SKILL.md`](../skills/issue-ready/SKILL.md)
  returns `Ready for AI: YES`**, ⚠ **and the verdict was posted to the issue first.**
  ⚠ **The reasoning goes on the issue before the label does** — ⚠ **a label with no verdict behind
  it is indistinguishable from one applied by mistake.**
- MUST: ⚠ **Apply it with `node .claude/tools/ready-for-ai.mjs`, never with `gh issue edit`.**
  ⚠ **That tool posts the verdict, applies the label, marks it and records the outcome in one step.**
  ⚠ **A rule every call site has to remember is not a rule, it is a hope**
  ([`security.md`](security.md) says the same thing about redaction).
- MUST: ⚠ **The tool applies `applied-by-ai` alongside `ready-for-ai`.**
  ⚠ **That mark is what makes "who applied it" a measurement rather than a subtraction:**
  ⚠ **`gh` acts as the owner, so the timeline's actor is the owner whoever pressed the button,**
  ⚠ **and a file on one machine cannot know about an application made on another.**
  ⚠ **An application with no mark beside it, in a log that is complete for this repository,
  is an observed absence.**
- MUST NOT: ⚠ **Never apply `applied-by-ai` by hand.**
  ⚠ **Doing so makes an owner's application read as the AI's, and nothing can tell afterwards.**
- MUST: ⚠ **Every refusal is recorded too.** ⚠ **A refusal leaves no trace on GitHub at all**,
  ⚠ **so the local record is the only place "how often did the gate say no" can be counted** —
  ⚠ **and an uncounted refusal is indistinguishable from one that never happened**
  ([`evidence.md`](evidence.md)).
- MUST: ⚠ **Re-run the gate immediately before work starts, every time**, even on an issue the AI
  labelled itself. ⚠ **Bodies and comments change after a label is applied.**

### ⚠ When the AI must not apply it

⚠ **Any one of these means no label.** ⚠ **Not "probably fine". No label.**

| # | ⚠ Condition | ⚠ Why |
|---|---|---|
| 1 | The issue carries `needs-decision` | ⚠ **The owner has not decided yet** |
| 2 | ⚠ **A named dependency is still open** | ⚠ **The work cannot be finished, only started** |
| 3 | ⚠ **The environment cannot run the verification the issue needs** | ⚠ **Then nobody can show it green** (`issue-ready` clause 10) |
| 4 | ⚠ **An unsettled question touches the product** — the concept, the v0.1.0 experience, a non-goal | ⚠ **[`../../docs/PRODUCT.md`](../../docs/PRODUCT.md) § 6** |
| 5 | ⚠ **An unsettled question touches security or privacy** | ⚠ **Weakening a promise is the owner's, always** |
| 6 | ⚠ **It would introduce a continuing running cost** | ⚠ **Same** |
| 7 | `issue-ready` returned anything but `YES` | ⚠ **The gate already said no** |

- MUST NOT: ⚠ **Never remove the label.** ⚠ **Applying and removing are not symmetric:**
  ⚠ **removing one the owner applied overrides the owner.**
  ⚠ **When an issue should lose it, say so and stop.**
- MUST NOT: ⚠ **Never apply it to an issue the AI wrote in order to unblock itself**
  without the gate having run on it like any other.
- MUST: ⚠ **When 4, 5 or 6 is what stopped it, mark the issue `needs-decision` and move on to
  another issue.** ⚠ **Do not stall the whole queue on one owner question.**

### ⚠ The label is still only an entry condition

- MUST: ⚠ **It is not a guarantee that the issue can be implemented.**
  ⚠ **Labels get applied by mistake — ⚠ including by the AI.**
- MUST: ⚠ **The Loop Controller re-runs the gate before touching anything, and stops on `NO`**
  ([`../skills/loop-controller/SKILL.md`](../skills/loop-controller/SKILL.md)).
