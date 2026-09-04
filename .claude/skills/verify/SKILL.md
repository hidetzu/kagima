---
name: verify
description: Run kagima's checks and return PASS / FAIL / NOT-VERIFIED with the regression guard and the mutation check. Use after implementing, before opening a PR, and whenever the loop controller reaches a verify stage.
---

# Verify — kagima

⚠ **The contract is [`../../rules/verification.md`](../../rules/verification.md).**
⚠ **It names no command. This file names the commands and nothing else.**
⚠ **Never restate the contract here** (rule: never two implementations of one question).

⚠ **Read that file before using this one.** ⚠ **The verdict shape, the three values of
`Regression guard`, and "it failed ≠ it failed for the intended reason" all live there.**

---

## ⚠ 1. What exists today, and what does not

⚠ **This section is the honest part of this skill, and it is the part that goes stale.**
⚠ **Re-read it against the repository before quoting it** — ⚠ **never quote it from memory.**

| Tier | Entry point | State |
|---|---|---|
| **Fast / inner** | `node .claude/tools/docs-check.mjs` | ⚠ **exists** |
| **Fast / inner** | `npm run check` (types, lint, format, unit) | ⚠ **exists** |
| **Final gate** | `npm run e2e` (two browser contexts, fake media, a real room) | ⚠ **does not exist yet** |
| **External** | a second browser engine, and a STUN server we did not write | ⚠ **does not exist yet** |

- MUST: ⚠ **Confirm the row before trusting it.** `ls`, `npm run`, or read `package.json`.
  ⚠ **A row saying "exists" is a claim, and a claim gets checked** ([`../../rules/evidence.md`](../../rules/evidence.md)).
- MUST: ⚠ **A tier that does not exist yet is `NOT-VERIFIED`, never a silent pass.**
  ⚠ **Say which tier did not run and why** — ⚠ **"there is no such command yet" is a reason,
  and it is one that must appear in the report.**
- MUST NOT: ⚠ **Never write `PASS` because the only tier that exists passed.**
  ⚠ **`PASS` means every tier ran and every tier passed.**
- MUST: ⚠ **When a change adds an entry point, add its row here in the same PR.**
  ⚠ **A table that lags the repository is worse than no table**, because it is believed.

### ⚠ CI runs a subset of this table, and says which

⚠ **`.github/workflows/ci.yml` runs the fast tier and writes, into every run's summary, which
tiers it did not run.** ⚠ **A green tick is evidence about the rows it ran and nothing else.**

- MUST: ⚠ **Never read a green tick as covering the final gate or the external tier.**
  ⚠ **Neither has an entry point yet.**
- MUST: ⚠ **When one lands, CI must run it.**
  ⚠ **`docs-check` case `ci-names-every-entry-point` fails if `package.json` declares a tier
  entry point that the workflow never invokes** — ⚠ **so a tier cannot go missing from CI quietly.**
- ⚠ **That case cannot check that the workflow's prose is true.** ⚠ **It checks that a declared
  entry point is not silently absent.** ⚠ **Those are different, and only the second is a wall.**

---

## 2. Fast / inner

⚠ **What can be known without building an environment.**

```bash
node .claude/tools/docs-check.mjs                    # every case
node .claude/tools/docs-check.mjs --list             # ⚠ name the cases, run none, load nothing
node .claude/tools/docs-check.mjs --only=links       # one case
```

⚠ **It announces the subset and the count on its own first line.**
⚠ **Copy that number into the report. Never write it into a document**
([`../../rules/evidence.md`](../../rules/evidence.md)).

```bash
npm run check                    # every case
npm run check -- --list          # ⚠ name them, run none, load nothing heavy
npm run check -- --only=types    # one case
```

⚠ **Its cases are `types`, `lint`, `format`, `unit`.** ⚠ **`--list` says what each one can see;
read that rather than assuming from the name.**

- ⚠ **`types` exists because Node strips types to run them and never checks them.**
  ⚠ **Without it a type error runs happily.**
- ⚠ **`format` checks and never writes.** ⚠ **A check that edits the tree cannot be trusted to
  have measured it.**
- ⚠ **An unknown `--only=` is an error, not an empty run.**
  ⚠ **Zero cases exiting 0 is indistinguishable from a clean run**, ⚠ **and that is the way a
  check suite silently stops checking anything.** ⚠ **`test/cases.test.ts` holds that shut.**

⚠ **`.claude/` is deliberately outside what `lint` and `types` look at** (`biome.json`,
`tsconfig.json`). ⚠ **Those files are a port kept diffable against upstream**
([`../../rules/README.md`](../../rules/README.md) § Language); ⚠ **linting them would generate
pressure to edit them, which is the opposite of what they are for.**
⚠ **They are not unchecked** — ⚠ **`docs-check.mjs` is what holds them.**

## 3. Final gate

⚠ **The whole thing exercised the way it is actually used, in an environment we build ourselves.**

⚠ **For kagima that means, at minimum:**

```text
a room is created            ⚠ the host's browser, not a curl
a second context joins       ⚠ URL + passphrase + nickname, as a guest does
media flows                  ⚠ the guest sees and hears the host, both directions
the host closes the room     ⚠ and the guest is told, and the tracks stop
```

- MUST: ⚠ **Drive real browsers with fake media devices.**
  ⚠ **A unit test of the signalling messages is not this tier** — ⚠ **it never touches
  `getUserMedia`, ICE, or the browser's own WebRTC stack, which is where this breaks.**
- MUST: ⚠ **Assert that a track carries frames, not that a connection object reached `connected`.**
  ⚠ **`connectionState === "connected"` with a black frame is exactly the failure this tier exists
  to catch.**
- MUST: ⚠ **Confirm the build under test is the one just built, and the server under test is the
  one just started** ([`../../rules/verification.md`](../../rules/verification.md)).
  ⚠ **A stale dev server on the same port measures the previous run.**

## 4. External — ⚠ the tier that gets skipped

⚠ **The other end must be something we did not write.**

⚠ **For kagima the other end is available for free, and there is no excuse for skipping it:**

```text
the browser's own WebRTC stack   ⚠ we do not write it. ⚠ Its ICE behaviour is not ours to assume
a second browser engine          ⚠ Chromium and Firefox disagree, and that is the point
a STUN server                    ⚠ someone else's, ⚠ so the result depends on their uptime
```

- MUST NOT: ⚠ **Never assert what a STUN or TURN server will do right now.**
  ⚠ **Record what actually came back, then judge** ([`../../rules/verification.md`](../../rules/verification.md)).
- MUST: ⚠ **A failure here is still a `FAIL`** — ⚠ **but say plainly whether it was ours or theirs,
  and never edit code to make it go quiet.**
- SHOULD: ⚠ **Prefer a fixture over someone's uptime where the claim allows it, and say when the
  fixture was captured.**

## 5. Security checks belong to a tier, not to a review

⚠ **[`../../rules/security.md`](../../rules/security.md) states the constraints.**
⚠ **This section says where each is actually caught.** ⚠ **A constraint with no row here is a
promise, not a wall** — ⚠ **and `security.md` says so about itself.**

| Constraint | Which tier catches it |
|---|---|
| `.env.example` carries no values | fast — `docs-check --only=env-example-has-no-values` |
| the passphrase never reaches a log | fast — `test/log.test.ts`. ⚠ **Two halves: the boundary redacts, ⚠ and nothing bypasses the boundary.** ⚠ **Either alone is a promise** |
| a wrong passphrase and an unknown room are indistinguishable | ⚠ **final gate.** ⚠ Compare the two responses, ⚠ **including their shape** |
| rate limiting actually rejects | ⚠ **final gate.** ⚠ **Drive it past the limit and read what came back** |
| closing a room drops its state | ⚠ **final gate.** ⚠ **Rejoin afterwards and confirm it answers like a room that never existed** |
| media never reaches the server | ⚠ **not catchable by a passing test.** ⚠ **See below** |
| a room never reaches disk | fast — `test/room.test.ts`. ⚠ **Asserts no persistence module is imported.** ⚠ **Not the same as "nothing remains in memory"** |
| the room id and the passphrase come from a CSPRNG | fast — `test/room.test.ts`, `test/passphrase.test.ts`. ⚠ **A negative check plus a positive one; ⚠ the negative alone cannot show a CSPRNG *is* used** |
| a secret is never compared with `===` | fast — `test/join.test.ts` |
| every refusal looks identical on the wire | fast — `test/server.test.ts`. ⚠ **Compares status, headers and body over a real socket.** ⚠ **A unit test cannot see the bytes** |

⚠ **That last row is the hard one.** ⚠ **"No file was written" is not evidence that no file is
ever written** ([`../../rules/evidence.md`](../../rules/evidence.md) — ⚠ **not written to disk
≠ never held**). ⚠ **The check that can exist is the negative one: assert the server has no code
path that receives a media track, and break it on purpose to watch the assertion fail.**
⚠ **Say which of the two claims the check actually defends. Never let it read as the stronger one.**

## 6. Order, and what to return

⚠ **Both are owned by [`../../rules/verification.md`](../../rules/verification.md).** ⚠ Not here.

⚠ **Two obligations this project repeats because they are the ones skipped:**

- MUST: ⚠ **Break the fix on purpose and read the failure text.**
  ⚠ **Record it verbatim.** ⚠ **"It failed" is not the mutation check.**
- MUST: ⚠ **After any fix, run the whole order again from the top.** ⚠ Never skip forward.
