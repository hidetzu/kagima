# Rules

⚠ **This directory holds "how to write it".**
⚠ **"How to work" is [`CLAUDE.md`](../../CLAUDE.md), "what this product is and promises" is
[`docs/PRODUCT.md`](../../docs/PRODUCT.md), "what may be claimed" is
[`docs/SPEC.md`](../../docs/SPEC.md), and "why" is [`docs/adr/`](../../docs/adr/).**

⚠ **Never duplicate.** ⚠ **Written in two places, one of them goes stale.**
⚠ **If a subject already has an owner, this directory only says "look there".**

## ⚠ Language

⚠ **`CLAUDE.md` and everything under `.claude/` is English. `README.md` and everything under
`docs/` is Japanese.** ⚠ **This is a decision, not an accident.**

⚠ **Grounds: `.claude/` is a port of [`hidetzu/claude-dev-template`](https://github.com/hidetzu/claude-dev-template),
and it is kept diffable against upstream so improvements can be sent back.**
⚠ **Translating it would end that, and [`evidence.md`](evidence.md) says in its own text that
re-wording it is how it gets softened.** ⚠ **`docs/` is the owner's language, because that is
where product judgement lives.**

## Two kinds of rule, and they are not interchangeable

```text
Engineering constraint          Learned pitfall
grounded in the language,       something this repository
the protocol, or the fact       actually paid for
that the input is hostile              |
        |                              |
binds from the first line       lives in CLAUDE.md §9,
of code                         with the test that stops
        |                       it happening again
lives here, with its grounds
```

⚠ **Everything in this directory is an engineering constraint.** ⚠ **It binds now.**
⚠ **It does not wait for an accident here to earn its place.**
⚠ **Each section states its grounds** — cite those, never an anecdote.

⚠ **Never demote a constraint to "we will see" because nothing has gone wrong yet.**
⚠ **Never promote one into `CLAUDE.md` §9 by inventing an incident.**

⚠ **A learned pitfall can add a rule here.** ⚠ **When it does, the grounds it cites is the
incident, and `CLAUDE.md` §9 keeps the row.**
⚠ **The two records point at each other; neither replaces the other.**

## What is here

| File | What it holds | Where it came from |
|---|---|---|
| [`evidence.md`](evidence.md) | ⚠ **What may be said to have been observed.** Denominators, counts, outcomes | template, ⚠ **plus kagima's two domain lines** |
| [`verification.md`](verification.md) | The three tiers, partial runs, `PASS` / `FAIL` / `NOT-VERIFIED` | template, verbatim |
| [`owner-decisions.md`](owner-decisions.md) | Decide yourself vs. ask, `ready-for-ai` | ⚠ **diverged.** Minus the Slack and `visual-decision` clauses, ⚠ **and the `ready-for-ai` clause rewritten** ([`../../docs/adr/0006-let-the-ai-apply-ready-for-ai-and-gate-on-merge-instead.md`](../../docs/adr/0006-let-the-ai-apply-ready-for-ai-and-gate-on-merge-instead.md)) |
| [`git.md`](git.md) | Commits, permission, forbidden operations, what never goes public | ⚠ **diverged.** The Loop Controller exception no longer covers merge (same ADR) |
| [`security.md`](security.md) | ⚠ **Identifiers, the passphrase, logging, rate limits, the join token, media, secrets, what survives a room** | ⚠ **kagima's own.** Grounds stated in the file |

⚠ **`security.md` is not here because security is nice to have.**
⚠ **It is here because the promise it protects is the product** — ⚠ **its grounds hold before
any code exists, which is exactly what makes it an engineering constraint and not a pitfall.**

> ⚠ **Files this project still owes itself.** ⚠ **Named, so the gap is a decision and not an
> oversight** ([`docs/adr/`](../../docs/adr/) says what a named gap means).
> ⚠ **The layer split and the language rules cannot be written before the first ADR that
> settles them lands.** ⚠ **Add them here, each with its grounds, the moment they do.**

⚠ **`MUST` = required, `SHOULD` = default, `MAY` = optional.**
⚠ **`⚠` marks "it hurts if you step on it"** (same convention as `CLAUDE.md`).

## ⚠ Subjects owned elsewhere

⚠ **Do not copy these here.**

| Subject | Owner |
|---|---|
| not observed ≠ did not happen / never dress a guess as a measurement / denominators | [`evidence.md`](evidence.md) |
| Wording a human reads (never open with what does not work) | `CLAUDE.md` §4 |
| Which checks to run, in what order | [`../skills/verify/SKILL.md`](../skills/verify/SKILL.md) |
| How to review a change (scope, rules, stale results) | [`../skills/change-review/SKILL.md`](../skills/change-review/SKILL.md) |
| Whether an issue can be handed over | [`../skills/issue-ready/SKILL.md`](../skills/issue-ready/SKILL.md) |
| What kagima is, what v0.1.0 is, and what only the owner may change | [`../../docs/PRODUCT.md`](../../docs/PRODUCT.md) |
