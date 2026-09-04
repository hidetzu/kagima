// The short-lived token a guest gets in exchange for the passphrase.
//
// ⚠ **`docs/adr/0004`**: ⚠ **the passphrase is verified once and never read again.**
//   ⚠ **Carrying it for the length of a call would make every place it passes through a leak.**
//
// ⚠ **The token is bound to one room.** ⚠ **A token that worked on another room would turn one
//   ⚠ leaked link into all of them** (`.claude/rules/security.md` § 4).
//
// ⚠ **Nothing derived from the passphrase goes inside it** (same file).
//   ⚠ **If it did, a leaked token would leak the passphrase, and short-lived would buy nothing.**
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ⚠ **How long a token is good for.**
 *
 * ⚠ **This is not the length of a call.** ⚠ **The token carries the guest from "passphrase
 * accepted" to "socket open", and kagima#6 consumes it there.**
 * ⚠ **So it is short on purpose, and expiring mid-call is not a state it can reach** — ⚠ **by the
 * time a call exists, the token has already been spent.**
 *
 * ⚠ **If it expires before the socket opens, the guest enters the passphrase again.**
 * ⚠ **That is the whole of the answer to "what happens when it expires", and it is deliberate
 * that the answer is small.**
 */
export const TOKEN_TTL_MS = 2 * 60 * 1000;

/** ⚠ **Bytes of randomness per token.** ⚠ Makes two tokens for one room in one millisecond differ. */
const NONCE_BYTES = 16;

const b64url = (b: Buffer): string => b.toString("base64url");

/**
 * ⚠ **Why a comparison needs a key at all.**
 *
 * ⚠ **`timingSafeEqual` throws when the two buffers differ in length**, ⚠ **and catching that
 * would itself be a length oracle.** ⚠ **HMACing both sides first makes them the same length
 * whatever went in**, ⚠ **so the comparison neither throws nor reveals how long the secret was.**
 *
 * ⚠ **The key is per process and random.** ⚠ **It never leaves memory and is never persisted;
 * it exists only so the two digests cannot be precomputed by anyone watching.**
 */
const COMPARE_KEY = randomBytes(32);

/** ⚠ **The only string comparison a secret may go through.** ⚠ Never `===` (`.claude/rules/security.md` § 1). */
export const constantTimeEqual = (a: string, b: string): boolean => {
  const ha = createHmac("sha256", COMPARE_KEY).update(a, "utf8").digest();
  const hb = createHmac("sha256", COMPARE_KEY).update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
};

const sign = (payload: string, secret: string): string =>
  b64url(createHmac("sha256", secret).update(payload, "utf8").digest());

/**
 * Mint a token for one room.
 *
 * ⚠ **The payload is readable by anyone holding the token** — ⚠ **it is signed, not encrypted.**
 * ⚠ **So it holds only the room id, an expiry, and a nonce.** ⚠ **Nothing about the passphrase,
 * nothing about who is joining.**
 */
export const issueJoinToken = (
  roomId: string,
  secret: string,
  now: number,
  nonce: string = b64url(randomBytes(NONCE_BYTES)),
): string => {
  const payload = b64url(Buffer.from(`${roomId}:${now + TOKEN_TTL_MS}:${nonce}`, "utf8"));
  return `${payload}.${sign(payload, secret)}`;
};

/**
 * ⚠ **Why a token can be refused.**
 *
 * ⚠ **These are for counting, and they never reach a client** — ⚠ **telling a caller which one
 * it was would answer questions it did not ask** (`.claude/rules/security.md` § 3).
 */
export type TokenRejection = "malformed" | "bad-signature" | "expired" | "wrong-room";

export type TokenCheck =
  /**
   * ⚠ **`sessionId` is the token's nonce**, ⚠ returned only after the signature has been checked.
   *
   * ⚠ **It exists so a reconnect can be recognised as the same participant** (`src/signaling/hub.ts`).
   * ⚠ **It is not a secret and it is not derived from the passphrase** — ⚠ **it is random per token.**
   * ⚠ **Returned from here rather than decoded again elsewhere: ⚠ decoding it twice would be two
   * implementations of one question, and the second one would not check the signature**
   * (`CLAUDE.md` § 3).
   */
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly why: TokenRejection };

/**
 * ⚠ **Check the signature before anything else, and before trusting a single field.**
 * ⚠ **Reading the expiry out of an unverified payload and acting on it is trusting the attacker's
 * own arithmetic.**
 */
export const verifyJoinToken = (
  token: string,
  expectedRoomId: string,
  secret: string,
  now: number,
): TokenCheck => {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, why: "malformed" };

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  // ⚠ Constant time, so a signature cannot be guessed byte by byte from how long the check took.
  if (!constantTimeEqual(signature, sign(payload, secret)))
    return { ok: false, why: "bad-signature" };

  // ⚠ Only now is the payload ours to read.
  const parts = Buffer.from(payload, "base64url").toString("utf8").split(":");
  if (parts.length !== 3) return { ok: false, why: "malformed" };

  const [roomId, expText, nonce] = parts as [string, string, string];
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp)) return { ok: false, why: "malformed" };

  // ⚠ Room before expiry: a token for another room is wrong whether or not it has expired,
  //   ⚠ and reporting the more specific fact keeps the counters meaningful.
  if (roomId !== expectedRoomId) return { ok: false, why: "wrong-room" };
  if (now >= exp) return { ok: false, why: "expired" };
  return { ok: true, sessionId: nonce };
};
