# kagima — how we work

This file holds **how to work**.

⚠ **What kagima is, what v0.1.0 is, and what only the owner may change, is
[`docs/PRODUCT.md`](docs/PRODUCT.md), and that file is the single source.**
**What may be claimed** goes in [`docs/SPEC.md`](docs/SPEC.md); **why a decision was made** goes in
[`docs/adr/`](docs/adr/). ⚠ **How to write code** (the layer split, security, testing priorities,
forbidden git operations) lives in [`.claude/rules/`](.claude/rules/).

⚠ **Never duplicate.** ⚠ **Written in two places, one of them goes stale.**
⚠ **In particular: never restate the product here.** ⚠ **Not the concept, not the v0.1.0 flow,
not the non-goals, not the privacy promises.** ⚠ **Link to `docs/PRODUCT.md` instead.**
⚠ **When the product changes, change that file. This one does not move.**

Before starting work, read [`.claude/rules/README.md`](.claude/rules/README.md).

⚠ **`⚠` marks "it hurts if you step on it".** ⚠ It is not decoration.

---

## 0. What this repository is

kagima is a web service. ⚠ **What it is, is [`docs/PRODUCT.md`](docs/PRODUCT.md).** ⚠ Not here.

⚠ **How it gets built is also a subject of this repository**, and that half is not in
`PRODUCT.md`'s gift alone: ⚠ **how far an AI can carry a product on its own is being measured
here, with `.claude/hooks/telemetry.mjs` and `.claude/tools/telemetry-eval.mjs`**
(`docs/PRODUCT.md` § 7 states what that means for how you behave).

⚠ **`.claude/` is a port of [`hidetzu/claude-dev-template`](https://github.com/hidetzu/claude-dev-template).**
⚠ **It is kept diffable against upstream on purpose** — ⚠ **when this project has to fight the
template to do the right thing, the template is wrong, and the fix goes back there naming the
project it broke in.** `README.md` records what was ported and what deliberately was not.

## 1. The first principle

> **The promise before the feature.**

⚠ **The order is never swapped.** ⚠ **kagima sells a promise about what does not happen**
(no recording, nothing kept, nobody else in the room). ⚠ **A feature that costs a piece of that
promise is not a trade to weigh — it is an owner decision, every time**
(`docs/PRODUCT.md` § 6, [`.claude/rules/security.md`](.claude/rules/security.md)).

⚠ **Whatever it says, it never outranks the evidence rules.**
⚠ **Those are [`.claude/rules/evidence.md`](.claude/rules/evidence.md), and they hold everywhere** —
in the code, in the tests, and in every report.

⚠ **Never restate them here.** ⚠ **They are the one thing this project does not re-word**,
because re-wording them is how they get softened.

## 2. Verification

⚠ **The contract is [`.claude/rules/verification.md`](.claude/rules/verification.md).**
⚠ **What to actually run is [`.claude/skills/verify/SKILL.md`](.claude/skills/verify/SKILL.md).**
⚠ Neither belongs here (never two copies).

⚠ **That skill's § 1 says which tiers exist today and which do not.**
⚠ **Read it against the repository before quoting it.**

## 3. Architecture boundaries

⚠ **Media never reaches a server we run.** Browser to browser, and nothing in between that can
see a frame. ⚠ **The control plane carries who may join; it never carries what they say.**
⚠ **Room state lives in one process's memory and nowhere else** — no database, no cache, no disk.
⚠ **Internet exposure is one tunnel for HTTP and WebSocket only**, ⚠ **never a pipe for media.**
⚠ **Each of those four is settled in [`docs/adr/`](docs/adr/), with what was rejected and why.**

⚠ **Not to be introduced without a reason recorded in an ADR:**

```text
a database, or anything else that survives the process
a media server, an SFU, a recorder, a transcoder
a second runtime or a second build system
a UI framework, or a server framework beyond what one process needs
a paid service with a running cost (⚠ this is an owner decision, not an ADR — PRODUCT.md § 6)
a dependency that reaches the network at runtime
```

Two clauses hold regardless of the domain:

- ⚠ **Never keep two implementations that answer the same question.**
  If one is unavoidable, cross-check them mechanically.
  ⚠ **Writing the same decision in two places is how the two silently diverge.**
- ⚠ **A layer split belongs in an ADR before it belongs in code.**

## 4. Words

- **Never leak internal state into what a human reads.** Not an error code, but a sentence
  that says what happened and what to do about it.
- **Name things after the concept the domain already named, not after the data structure.**
  ⚠ **Borrow the existing name exactly.** ⚠ If a name here differs, that difference is a claim —
  justify it.
- **Never rename in bulk.** Changing a term does not license a sweep through the ADRs and past
  discussions.

⚠ **Where kagima's names come from**, in this order:

```text
the RFCs             ICE, STUN, TURN, SDP, DTLS-SRTP — ⚠ borrow the RFC's word exactly
the W3C WebRTC and Media Capture specs   ⚠ track, sender, transceiver, connection state
docs/PRODUCT.md      room, host, guest, passphrase, nickname — ⚠ the product's own words
```

⚠ **Two marks are already spoken for and must not be reused for anything else:**

- ⚠ **"passphrase" is the thing a human says out loud.** ⚠ **Never call a token, a secret, a key,
  or a room id a passphrase**, and ⚠ **never call the passphrase a password** — a password
  belongs to an account, and kagima has no accounts.
- ⚠ **"closed" means the room is over and its state is gone.** ⚠ **Never use it for a socket
  that dropped**, which is `disconnected` and is recoverable.

⚠ **Language: this file and `.claude/` are English; `README.md` and `docs/` are Japanese.**
⚠ **The grounds are in [`.claude/rules/README.md`](.claude/rules/README.md) § Language.** ⚠ Not here.

### 4-1. Never open with what does not work

⚠ **This is not about hiding anything.** §1 outranks it, and **limitations are always stated**.
What changes is the **order, the subject, and the tense** — not whether it is said.

- **Say what this does first.** What it does not do comes after, with the reason
  and with what to do instead.
- **Do not use the progressive tense for a state.** "not receiving" reads as something
  happening right now on the reader's machine.
- **Never phrase our own gap as the other side's fault.** If we never implemented it,
  do not report it as "no response". ⚠ **The reader's next move depends on which it is** —
  retry, wait, or give up.
- **Do not sound stalled.** "not implemented yet" beats "unavailable": leave a reason to come back.

⚠ **This one bites hard in kagima**, because the user-facing failures are all of this shape:
⚠ **"could not connect" is not the same as "the other person has not arrived", and neither is
the same as "the passphrase was wrong"** — ⚠ **and telling the user the wrong one either scares
them off or hands an attacker a fact** ([`.claude/rules/security.md`](.claude/rules/security.md) § 3).

## 5. Comments

Comments carry **why this, why this value, what is being avoided**. That is an asset.
⚠ **But a stale comment misleads harder than stale code**, because it is believed.

Change code, and update the whole set:

```
implementation → test → comment → README → docs/SPEC.md
```

⚠ **When a check reads documentation or comments, strip the comments first.**
⚠ Otherwise the check picks up the very words written to describe it.

## 6. How to write numbers

⚠ **Owned by [`.claude/rules/evidence.md`](.claude/rules/evidence.md).** ⚠ Not here.

## 7. How to proceed

1. **Measure before polishing.** Before fixing anything, state what it does now, in numbers.
2. Report **observation** (measured values, captured output) and **inference** (interpretation)
   separately.
3. Never report as confirmed what was not verified.
4. Do not widen a change past its `Non-goals`. The smallest change that meets the goal is the default.

⚠ **Deciding yourself vs. asking, and `ready-for-ai`, are owned by
[`.claude/rules/owner-decisions.md`](.claude/rules/owner-decisions.md).**
⚠ **The kagima-specific list of what is the owner's is `docs/PRODUCT.md` § 6.** ⚠ Neither is here.

## 8. git

⚠ **Owned by [`.claude/rules/git.md`](.claude/rules/git.md)** — Conventional Commits, permission
for `git push` and merge, how to split commits, and what never goes into anything public.
⚠ Not here.

## 9. Pitfalls we have stepped on

⚠ **This table starts empty, and that is correct.**

⚠ **Nothing goes in here that did not happen in this repository.** Not an analogy from another
project, not something plausible, not something an AI expects to be true.
⚠ **A pitfall is a measurement**: it names what happened, and what to do instead.

⚠ **This is not where engineering constraints go.** A rule that holds because of the language,
because of a protocol, or because the input is hostile ⚠ **belongs in `.claude/rules/`, and binds
already.** ⚠ **In particular, nothing in `.claude/rules/security.md` belongs here** — ⚠ **its
grounds hold before any code exists.**
⚠ **Never manufacture an incident to move a constraint in here**, and
⚠ **never soften a constraint on the grounds that this table has no row for it yet.**

⚠ **When you fill a row in, also leave the test behind.** A row with no test is a note;
a row with a test is a wall.
⚠ **If the incident also produces a new rule, the rule goes to `.claude/rules/` citing this row.**
⚠ **Both records stay. Neither replaces the other.**

| What happened | What to do instead |
|---|---|
| ⚠ **2026-09-04.** A verification run set `CLAUDE_DEV_TELEMETRY_DIR` to keep itself out of the real record, and read that as "this run is an exercise". ⚠ **It was not.** ⚠ **The variable redirects the local record and nothing else** — ⚠ **`gh` still spoke to GitHub, and `ready-for-ai` went onto two real issues.** ⚠ **One of them had already been judged unfit for it** | ⚠ **Treat every outward call as real unless something explicitly blocked it.** ⚠ **Redirecting where a run *records* is not redirecting what it *does*.** ⚠ **When a tool can tell it is being exercised, it refuses to change anything outside this process** — ⚠ **fail closed, and say which flag means it.** ⚠ **The wall is `test/exercise-never-touches-github.test.ts`**, ⚠ **and it works by putting a stub on `PATH` and asserting the stub was never reached** |
| ⚠ **2026-09-06.** ⚠ **The walls that read source strip comments first** (§ 5). ⚠ **Six copies of that stripper took block comments out *before* line comments.** ⚠ **A glob inside a line comment — `` `src/client/*.ts` `` — opened a block that ran on to the next `*/`, ⚠ four `import` lines later.** ⚠ **`src/static.ts` imported `node:fs` the whole time and the persistence wall for `docs/adr/0005` reported nothing.** ⚠ **It was found by accident, ⚠ by adding one more import to that file** | ⚠ **Strip line comments first.** ⚠ **Then the glob goes away with the line that held it.** ⚠ **One implementation, in `test/source-text.ts`** (§ 3). ⚠ **The wall is `test/source-text.test.ts`**: ⚠ **a fixture in the exact shape — ⚠ opener in a line comment, ⚠ closer in a doc comment *after* the code — ⚠ plus a sweep that fails when any file in the tree starts hiding a declaration.** ⚠ **A fixture that closes inside the same comment eats nothing and passes either way; ⚠ the first attempt did that and the mutation went green** |
| ⚠ **2026-09-06.** ⚠ **`docs-check` enumerated with `git ls-files`, ⚠ which lists only what is *tracked*.** ⚠ **A document written minutes earlier is invisible to it.** ⚠ **`docs/PORTING.md` was written, the wall was run, it announced `links — every relative link resolves (292 checked, in 37 files)` and `8 of 8 cases passed`, ⚠ and it had not opened the new file.** ⚠ **Two broken links shipped, ⚠ and CI caught them only after `git add` made the file visible** | ⚠ **Enumerate with `--cached --others --exclude-standard`** — ⚠ **tracked, plus untracked-and-not-ignored, ⚠ which is the set about to be committed.** ⚠ **One helper, `filesUnderGit`, ⚠ used by every case that walks the tree** (§ 3). ⚠ **Proven by putting a broken link in an untracked file: ⚠ the fixed version reports it, ⚠ the old version says all 292 resolve.** ⚠ **A wall that enumerates is only as wide as its enumeration, ⚠ and its count is what makes the gap invisible** — ⚠ **`292 checked` reads as thorough** |
