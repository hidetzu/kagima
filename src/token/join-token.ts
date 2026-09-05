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
import { base64url, base64urlDecode, randomBytes } from "../random.ts";

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

const utf8 = new TextEncoder();

/**
 * ⚠ **HMAC-SHA256, ⚠ through Web Crypto.**
 *
 * ⚠ **`node:crypto` does not exist in Workers** (`docs/adr/0015`), ⚠ **and `crypto.subtle` is
 * asynchronous.** ⚠ **That is why everything below returns a promise** — ⚠ **it is not a style
 * choice, ⚠ and it must not be "simplified" back by caching a digest somewhere.**
 */
const hmac = async (key: string, message: string): Promise<Uint8Array> => {
  const imported = await crypto.subtle.importKey(
    "raw",
    utf8.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, utf8.encode(message)));
};

/**
 * ⚠ **Why a comparison needs a key at all.**
 *
 * ⚠ **`timingSafeEqual` throws when the two buffers differ in length**, ⚠ **and catching that
 * would itself be a length oracle.** ⚠ **HMACing both sides first makes them the same length
 * whatever went in**, ⚠ **so the comparison neither throws nor reveals how long the secret was.**
 *
 * ⚠ **The key is per process and random.** ⚠ **It never leaves memory and is never persisted;
 * it exists only so the two digests cannot be precomputed by anyone watching.**
 *
 * ⚠⚠ **Drawn on first use, ⚠ not at module load.**
 * ⚠ **A Worker refuses to generate random values in global scope** — ⚠ **`Disallowed operation
 * called within global scope`, ⚠ measured in `wrangler dev --local` on 2026-09-06.**
 * ⚠ **Loading this module was enough to kill the isolate**, ⚠ **so nothing kagima has would have
 * started there.**
 * ⚠ **The property is unchanged: ⚠ once per process, ⚠ random, ⚠ never written down.**
 */
let compareKey: string | undefined;
const compareKeyOf = (): string => {
  compareKey ??= base64url(randomBytes(32));
  return compareKey;
};

/**
 * ⚠⚠ **Two digests compared without the time taken saying anything about where they differ.**
 *
 * ⚠ **Node has `timingSafeEqual`; ⚠ Workers has `crypto.subtle.timingSafeEqual`.** ⚠ **They are
 * different names on different objects, ⚠ and using both would be two implementations of one
 * question** (`CLAUDE.md` § 3). ⚠ **So there is one, written here, ⚠ five lines long.**
 *
 * ⚠ **This is not hand-rolling a protocol** ([`docs/adr/0009`](../../docs/adr/0009-use-ws-for-the-websocket-server-rather-than-writing-rfc6455.md)
 * ⚠ is about RFC 6455, ⚠ which has edge cases this does not). ⚠ **It is one invariant: ⚠ look at
 * every byte, ⚠ every time.**
 *
 * ⚠ **Both arguments are SHA-256 digests, ⚠ so both are always 32 bytes** — ⚠ **the length is a
 * constant and can leak nothing.** ⚠ **The length is folded in anyway, ⚠ so a future caller
 * passing something else cannot make it return true early.**
 */
const equalDigests = (a: Uint8Array, b: Uint8Array): boolean => {
  let differing = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) differing |= (a[i] as number) ^ (b[i] ?? 0);
  return differing === 0;
};

/** ⚠ **The only string comparison a secret may go through.** ⚠ Never `===` (`.claude/rules/security.md` § 1). */
export const constantTimeEqual = async (a: string, b: string): Promise<boolean> =>
  equalDigests(await hmac(compareKeyOf(), a), await hmac(compareKeyOf(), b));

const sign = async (payload: string, secret: string): Promise<string> =>
  base64url(await hmac(secret, payload));

/**
 * Mint a token for one room.
 *
 * ⚠ **The payload is readable by anyone holding the token** — ⚠ **it is signed, not encrypted.**
 * ⚠ **So it holds only the room id, an expiry, and a nonce.** ⚠ **Nothing about the passphrase,
 * nothing about who is joining.**
 */
export const issueJoinToken = async (
  roomId: string,
  secret: string,
  now: number,
  nonce: string = base64url(randomBytes(NONCE_BYTES)),
): Promise<string> => {
  const payload = base64url(utf8.encode(`${roomId}:${now + TOKEN_TTL_MS}:${nonce}`));
  return `${payload}.${await sign(payload, secret)}`;
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
export const verifyJoinToken = async (
  token: string,
  expectedRoomId: string,
  secret: string,
  now: number,
): Promise<TokenCheck> => {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, why: "malformed" };

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  // ⚠ Constant time, so a signature cannot be guessed byte by byte from how long the check took.
  if (!(await constantTimeEqual(signature, await sign(payload, secret))))
    return { ok: false, why: "bad-signature" };

  // ⚠ Only now is the payload ours to read.
  const parts = new TextDecoder().decode(base64urlDecode(payload)).split(":");
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
