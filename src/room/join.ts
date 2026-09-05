// Exchanging a passphrase for a join token, once.
//
// ⚠ **The hard requirement here is not "accept the right passphrase".** ⚠ **It is that a wrong
//   ⚠ passphrase and a room that does not exist are indistinguishable from outside**
//   (`docs/adr/0004`, `.claude/rules/security.md` § 3).
//   ⚠ **Otherwise this endpoint answers "does this room exist?" for free, to anyone.**
//
// ⚠ **Same body, same status, and the same amount of work.**
//   ⚠ **Returning early for an unknown room would skip the comparison, and the time saved is the
//   ⚠ answer.** ⚠ **So an unknown room is compared against a decoy.**
import { normalizePassphrase } from "../passphrase/passphrase.ts";
import { constantTimeEqual, issueJoinToken } from "../token/join-token.ts";
import { isRoomId } from "./room-id.ts";
import type { RoomStore } from "./store.ts";

/**
 * ⚠ **Compared against when there is no room to compare against.**
 *
 * ⚠ **It is not a secret and it is never accepted** — ⚠ **no room holds it, because a real
 * passphrase is generated from the word list and this is not in the canonical form.**
 * ⚠ **Its only job is to make the unknown-room path cost the same as the wrong-passphrase path.**
 */
const DECOY_PASSPHRASE = "decoy-decoy-decoy-decoy";

/**
 * ⚠ **Why an attempt was refused.** ⚠ **For counting only.**
 *
 * ⚠ **`.claude/rules/evidence.md`: an uncounted rejection is indistinguishable from a request
 * that never arrived.** ⚠ **So they are counted apart** — ⚠ **and answered alike.**
 */
export type JoinRejection =
  | "malformed-room-id"
  | "unknown-room"
  | "wrong-passphrase"
  // ⚠ Added by kagima#5. ⚠ The three above keep exactly the meaning they had —
  //   ⚠ changing what a recorded value means is its own kind of breakage
  //   ⚠ (`.claude/skills/change-review/SKILL.md` § 3).
  | "rate-limited-source"
  | "rate-limited-room"
  | "at-capacity";

export type JoinOutcome =
  | { readonly ok: true; readonly token: string }
  // ⚠ `why` is for the counter on this side. ⚠ It never reaches the caller.
  | { readonly ok: false; readonly why: JoinRejection };

export type JoinDeps = {
  readonly now: () => number;
  readonly secret: string;
  /**
   * ⚠ **Injected so a test can count the comparisons.** ⚠ That count is what proves the timing class.
   *
   * ⚠ **Asynchronous because Web Crypto is** (`docs/adr/0015`). ⚠ **`node:crypto`'s synchronous
   * HMAC does not exist in Workers, ⚠ and the comparison is not a place to keep two versions.**
   */
  readonly compare: (a: string, b: string) => Promise<boolean>;
};

/**
 * ⚠ **Every outcome this can produce, and the ones it cannot**
 * (`.claude/rules/evidence.md` § Outcomes are not one outcome).
 *
 * ```text
 * accepted and handled            the passphrase matched -> a token
 * ⚠ malformed                      the room id is not a room id
 * ⚠ well-formed but declined       no such room, or the passphrase does not match
 * ⚠ not implemented yet            cannot occur here
 * ⚠ nothing arrived                cannot occur here — this is called with a value in hand
 * ⚠ a timer expired while waiting  cannot occur here — nothing in this function waits
 * ```
 *
 * ⚠ **The three that can occur are counted apart and answered alike.**
 */
export const attemptJoin = async (
  store: RoomStore,
  roomId: string,
  submitted: string,
  deps: JoinDeps,
): Promise<JoinOutcome> => {
  const given = normalizePassphrase(submitted);

  // ⚠ A malformed id still gets compared. ⚠ Refusing it early would make "that is not even a
  //   room id" measurably faster than "wrong passphrase", which is a shape oracle.
  const room = isRoomId(roomId) ? store.get(roomId) : undefined;
  const expected = room?.passphrase ?? DECOY_PASSPHRASE;

  // ⚠ Exactly one comparison on every path. ⚠ That is the property, and a test counts it.
  const matched = await deps.compare(given, expected);

  if (room === undefined) {
    return { ok: false, why: isRoomId(roomId) ? "unknown-room" : "malformed-room-id" };
  }
  if (!matched) return { ok: false, why: "wrong-passphrase" };

  return { ok: true, token: await issueJoinToken(room.id, deps.secret, deps.now()) };
};

/** ⚠ **The real comparator.** ⚠ Never `===` — see `constantTimeEqual`. */
export const defaultCompare = constantTimeEqual;

// ── counting ────────────────────────────────────────────────────────────────

export type RejectionCounts = Readonly<Record<JoinRejection, number>>;

export type RejectionCounter = {
  record(why: JoinRejection): void;
  /** ⚠ **Never served over HTTP.** ⚠ It is a fact about this host, not about a room. */
  counts(): RejectionCounts;
};

export const createRejectionCounter = (): RejectionCounter => {
  // ⚠ Every reason starts at zero, not absent. ⚠ A missing key reads as "never happened", and
  //   ⚠ "not observed ≠ did not happen" cuts the other way too: zero is a measurement, absent is not.
  const counts: Record<JoinRejection, number> = {
    "malformed-room-id": 0,
    "unknown-room": 0,
    "wrong-passphrase": 0,
    "rate-limited-source": 0,
    "rate-limited-room": 0,
    "at-capacity": 0,
  };
  return {
    record(why) {
      counts[why] += 1;
    },
    counts() {
      return { ...counts };
    },
  };
};
