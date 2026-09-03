# Security and privacy

⚠ **`MUST` = required, `SHOULD` = default, `MAY` = optional.**

⚠ **This file is an engineering constraint, not a learned pitfall** ([`README.md`](README.md)).
⚠ **It binds from the first line of code.** ⚠ **It does not wait for an incident here.**

## Grounds

⚠ **Three facts, and each of them holds today, before any code exists.**

1. ⚠ **The product's value *is* the promise.** kagima sells "a private space that opens for a
   while and then is gone" ([`../../docs/PRODUCT.md`](../../docs/PRODUCT.md)).
   ⚠ **A feature that leaks is not a degraded kagima. It is not kagima.**
2. ⚠ **The repository is public.** ⚠ **Assume every commit body, issue, PR and comment is read
   by anyone** ([`git.md`](git.md) owns what never goes public; ⚠ **this file does not restate it**).
3. ⚠ **The input is hostile by construction.** ⚠ **A room URL is handed to someone over a channel
   we do not control**, and the passphrase is the only thing standing behind it.

⚠ **Where a security decision has more than one defensible answer, it is not simplified here.**
⚠ **It becomes an ADR or an issue** ([`owner-decisions.md`](owner-decisions.md)).
⚠ **Never weaken a clause below on your own judgement** — ⚠ **that is an owner decision every time**
([`../../docs/PRODUCT.md`](../../docs/PRODUCT.md) § Owner が決めること).

---

## 1. Identifiers and the passphrase

- MUST: ⚠ **Generate a room id from a CSPRNG.** ⚠ **Never from a counter, a timestamp, a PID,
  `Math.random`, or anything derived from them.**
  ⚠ **Grounds: the URL is the outer wall, and a guessable wall is not a wall.**
- MUST: ⚠ **State the entropy of the room id and of the passphrase, in bits, and say which
  alphabet and length produce it** ([`evidence.md`](evidence.md) — ⚠ **a number carries how it
  was derived**).
- MUST: ⚠ **The passphrase is for a human to say out loud.** ⚠ **Its entropy is therefore low**,
  ⚠ **so it is the rate limit, not the passphrase, that makes it safe** (§ 3).
  ⚠ **Never argue a rate limit away by pointing at the passphrase's length.**
- MUST: ⚠ **Compare the passphrase with a constant-time comparison.**
  ⚠ **Never with `===` on the raw string.**
- SHOULD: ⚠ **Normalise before comparing** (case, whitespace, Unicode form) —
  ⚠ **and say so, because normalising lowers the entropy stated above.**

## 2. What must never be written down

- MUST NOT: ⚠ **Never log the passphrase.** ⚠ **Not at any level, not "only in development",
  ⚠ not inside an object that gets serialised whole.**
  ⚠ **The common way this breaks is not a `log(passphrase)` line — it is
  `log(requestBody)` and `log(err)` with the body attached.**
- MUST NOT: ⚠ **Never log a join token, a room id together with its passphrase, or a TURN
  credential.**
- MUST: ⚠ **A log line about a failed join says that a join failed, and never what was tried.**
- MUST: ⚠ **Redact at the boundary that builds the line, not at the call site.**
  ⚠ **A rule that every call site must remember is not a rule, it is a hope.**
- MUST: ⚠ **Leave a check behind that fails when a secret reaches a log**
  ([`verification.md`](verification.md) — ⚠ **a fixed bug leaves a check behind**).
  ⚠ **Without it, "we do not log the passphrase" is a promise and not a wall.**

## 3. Standing in front of a guess

- MUST: ⚠ **Rate-limit passphrase attempts per room**, ⚠ **and independently per source.**
  ⚠ **Per-source alone lets a botnet through; per-room alone lets one attacker lock a room's
  real guest out** (⚠ **that second one is a denial of service we would have built ourselves**).
- MUST: ⚠ **Count every rejection well enough to tell them apart**
  ([`evidence.md`](evidence.md) § Outcomes are not one outcome).
  ⚠ **An uncounted rejection is indistinguishable from a request that never arrived.**
- MUST: ⚠ **A wrong passphrase and an unknown room must be indistinguishable from outside** —
  ⚠ **same response, same shape, same timing class.**
  ⚠ **Otherwise the endpoint answers "does this room exist?" for free.**
- MUST: ⚠ **Say which of the outcomes in [`evidence.md`](evidence.md) can occur for this
  endpoint, and say explicitly that the rest cannot.**

## 4. The join token

- MUST: ⚠ **The passphrase is exchanged for a short-lived token, once**, and
  ⚠ **nothing after that point re-reads the passphrase.**
- MUST: ⚠ **Bind the token to the room it was issued for.** ⚠ **A token that works on another
  room turns one leaked link into all of them.**
- MUST: ⚠ **State the lifetime, and state what happens when it expires mid-call.**
  ⚠ **"It probably will not happen" is not an answer** — ⚠ **name the outcome.**
- MUST NOT: ⚠ **Never put the passphrase, or anything derived from it, inside the token.**

## 5. Media

- MUST: ⚠ **Audio and video never reach a server we run, and never reach disk.**
  ⚠ **This is a spec, not a default** — ⚠ **see [`../../docs/adr/`](../../docs/adr/).**
- MUST NOT: ⚠ **Never add recording, transcription, thumbnailing, or a "just for debugging"
  frame dump.** ⚠ **That is an owner decision and the answer is currently no.**
- MUST: ⚠ **When a relay is unavoidable, it relays and does not decrypt**, and
  ⚠ **the ADR says who can see what at every hop.**
- MUST: ⚠ **Stop the tracks, not just the UI.** ⚠ **A hidden `<video>` with a live track is a
  camera that is still on**, ⚠ **and the tally light is the only thing the user can see.**

## 6. Secrets in the repository

- MUST NOT: ⚠ **Never commit a Cloudflare credential, a TURN key or token, a signing key,
  or a `.env`.**
- MUST: ⚠ **`.env.example` carries names and never values.**
  ⚠ **A placeholder that looks like a real value is how a real one gets committed next.**
- MUST: ⚠ **Hold `.env.example` to that with a check, not with care**
  (`.claude/tools/docs-check.mjs`, case `env-example-has-no-values`).
- MUST: ⚠ **A leaked credential is rotated first and cleaned up second.**
  ⚠ **Removing it from git is not rotation**, and
  ⚠ **an old commit stays readable by SHA until the host collects it** ([`git.md`](git.md)).

## 7. After the room closes

- MUST: ⚠ **Closing a room drops its state.** ⚠ **Say what "drops" means for each thing held** —
  the passphrase, the token, the participant list, the signalling buffers.
- MUST: ⚠ **An expired or closed room answers exactly like a room that never existed** (§ 3).
- MUST NOT: ⚠ **Never keep a record "just to be able to debug it."**
  ⚠ **What may be retained is a product decision, and it is currently: nothing.**

---

## ⚠ Subjects owned elsewhere

⚠ **Do not copy these here.**

| Subject | Owner |
|---|---|
| What never goes into a commit, issue, PR or comment | [`git.md`](git.md) |
| Denominators, counts, and the list of outcomes | [`evidence.md`](evidence.md) |
| The tiers, `PASS` / `FAIL` / `NOT-VERIFIED`, regression guard | [`verification.md`](verification.md) |
| Which checks to run, and how | [`../skills/verify/SKILL.md`](../skills/verify/SKILL.md) |
| Whether to decide or ask | [`owner-decisions.md`](owner-decisions.md) |
| What kagima promises its users | [`../../docs/PRODUCT.md`](../../docs/PRODUCT.md) |
