// ⚠⚠ **Field-test mode. ⚠ Off unless asked for, ⚠ and loud when it is on.**
//
// ⚠ **This file costs two pieces of the promise on purpose**
//   (`docs/adr/0011-turn-on-a-field-test-mode-that-costs-two-promises-on-purpose.md`):
//
// ```text
// the passphrase gets short      ⚠ so it can be typed on a phone
// observations get collected     ⚠ so they need not be copied by hand off two devices
// ```
//
// ⚠ **Both are the owner's decision, ⚠ taken for the kagima#16 field test, ⚠ and both are meant
//   ⚠ to be taken back** (`docs/PRODUCT.md` § 6).
//
// ## ⚠ Why one flag and not two
//
// ⚠ **Two flags means one of them gets left on.** ⚠ **One flag is one thing to remember, ⚠ and
//   ⚠ the banner names both of its consequences ⚠ so neither can be turned on unknowingly.**
//
// ## ⚠ Fail closed
//
// ⚠ **Read once, at startup.** ⚠ **A mode that can turn itself on later is a mode nobody can
//   ⚠ reason about** — ⚠ **and this project has already paid for "the run thought it was an
//   ⚠ exercise and it was not"** (`CLAUDE.md` § 9).
import { randomBytes } from "node:crypto";

export const FIELD_TEST_ENV = "KAGIMA_FIELD_TEST";

/** ⚠ **Read once.** ⚠ Never re-read: the mode a process is in must not change under it. */
export const FIELD_TEST = process.env[FIELD_TEST_ENV] === "1";

// ── ⚠ the short passphrase ──────────────────────────────────────────────────

/**
 * ⚠ **Sixteen letters. ⚠ Letters, ⚠ and nothing else.**
 *
 * ⚠⚠ **`normalizePassphrase` folds every run of non-`a-z` away** (`src/passphrase/passphrase.ts`).
 * ⚠ **A digit in here would be deleted on the way in, ⚠ and the passphrase would never match.**
 * ⚠ **`test/field-test.test.ts` holds that shut the same way the word list is held shut:**
 * ⚠ **normalising a generated one must return it unchanged.**
 *
 * ⚠ **Dropped on purpose: ⚠ `b`/`d`/`p`/`t` and `i`/`l`/`o`/`q`/`v`/`z` — ⚠ heard or read as
 * something else.** ⚠ **This one is still said out loud; ⚠ short does not mean silent.**
 * ⚠ **Sixteen is not a round number chosen for looks** — ⚠ **it is a power of two, ⚠ so masking
 * is uniform without rejection sampling, ⚠ the same discipline `words.ts` is held to.**
 */
export const SHORT_ALPHABET = "acefghjkmnrsuwxy";

/** ⚠ **How many characters.** ⚠ Two, because a phone keyboard is the reason this exists. */
export const SHORT_LENGTH = 2;

const SHORT_BITS_PER_CHAR = Math.log2(SHORT_ALPHABET.length);

/**
 * ⚠ **The strength claim, derived, never typed** (`.claude/rules/evidence.md`).
 *
 * ⚠ **It is small, ⚠ and it is written here rather than argued away.**
 * ⚠ **`SHORT_ALPHABET.length ** SHORT_LENGTH` guesses exhausts it.**
 * ⚠ **The rate limit is what stands in front of that, ⚠ exactly as it does for the real
 * passphrase** (`.claude/rules/security.md` § 1) — ⚠ **the difference is only how much it is
 * carrying.**
 */
export const SHORT_PASSPHRASE_BITS = SHORT_LENGTH * SHORT_BITS_PER_CHAR;

const SHORT_MASK = SHORT_ALPHABET.length - 1;

/** ⚠ **Pure, so the mapping is checked against fixtures rather than sampled.** */
export const shortPassphraseFromBytes = (bytes: Uint8Array): string => {
  if (bytes.length < SHORT_LENGTH) {
    // ⚠ Never quietly produce a shorter one. ⚠ Even here, ⚠ the claim must not weaken silently.
    throw new RangeError(`need ${SHORT_LENGTH} bytes, got ${bytes.length}`);
  }
  let out = "";
  for (let i = 0; i < SHORT_LENGTH; i++) {
    out += SHORT_ALPHABET[(bytes[i] as number) & SHORT_MASK];
  }
  return out;
};

/** ⚠ **`randomBytes` here too.** ⚠ **Short is not a licence to stop using a CSPRNG.** */
export const generateShortPassphrase = (): string =>
  shortPassphraseFromBytes(randomBytes(SHORT_LENGTH));

// ── ⚠ the collected observations ────────────────────────────────────────────

/** ⚠ **In this process's memory, ⚠ and nowhere else** (`docs/adr/0005`). ⚠ **Never a file.** */
export type Observation = {
  readonly roomId: string;
  readonly side: string;
  readonly report: string;
  readonly at: number;
};

/** ⚠ **Bounded.** ⚠ An unbounded debug buffer is a memory leak that only shows up in the field. */
export const MAX_OBSERVATIONS = 40;

/** ⚠ **What a report may not carry, ⚠ checked at the door.**
 *
 * ⚠ **The client already cannot produce an address** (`src/diagnostics/report.ts`).
 * ⚠ **This is the second wall, ⚠ and it is here because the client is the part that can be
 * changed by whoever is holding the phone.** ⚠ **A promise kept only by the sender is not kept.**
 */
const ADDRESSY = [
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3,}\b/i,
  /[0-9a-f-]{20,}\.local\b/i,
];

export type ObservationStore = {
  /** @returns ⚠ **why it was refused**, or `null` when it was kept. */
  put(o: Observation): string | null;
  all(): readonly Observation[];
};

export const createObservationStore = (): ObservationStore => {
  // ⚠ Keyed by room and side, ⚠ so a device refreshing its report replaces its own line rather
  //   ⚠ than filling the buffer with near-copies of itself.
  const held = new Map<string, Observation>();
  return {
    put(o) {
      if (o.report.length > 4096) return "too long to be a report";
      for (const pattern of ADDRESSY) {
        // ⚠⚠ Refused, ⚠ and the refusal never quotes what was sent (`security.md` § 2).
        if (pattern.test(o.report)) return "that report carries an address";
      }
      if (held.size >= MAX_OBSERVATIONS && !held.has(`${o.roomId}/${o.side}`)) {
        return "too many observations are being held";
      }
      held.set(`${o.roomId}/${o.side}`, o);
      return null;
    },
    all: () => [...held.values()].sort((a, b) => a.at - b.at),
  };
};

/** ⚠ **What the operator sees at startup.** ⚠ **Both consequences, named.** */
export const fieldTestBanner = (): readonly string[] => [
  `⚠ ${FIELD_TEST_ENV}=1 — this is NOT how kagima is meant to run`,
  `⚠ the passphrase is ${SHORT_LENGTH} characters (${SHORT_PASSPHRASE_BITS} bits), not four words`,
  "⚠ every diagnostic report is collected in memory and readable at /api/observations",
  "⚠ unset it and restart to put both back",
];
