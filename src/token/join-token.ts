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

/**
 * ⚠⚠ **How long a rejoin mark is good for** (`docs/adr/0029`, kagima#90).
 *
 * ⚠⚠ **A chosen value, ⚠ not a measured one** (`.claude/rules/evidence.md`).
 * ⚠ **"How long is a Guest away" has not been measured.** ⚠ **kagima#90 has how long the media
 * was down (⚠ longest 512.5 s) — ⚠ that is not the same question.**
 *
 * ⚠ **`ROOM_IDLE_MS` (20 minutes) was rejected: ⚠ a Host who stays keeps the room alive, ⚠ so a
 * Guest away for 25 minutes would find only their own mark expired** — ⚠ **the feature would
 * stop working in a case that actually happens.**
 *
 * ⚠ **What happens when it expires: ⚠ the Guest knocks again, ⚠ exactly as before this existed.**
 * ⚠ **Nothing is said to them about the mark** — ⚠ **there is nothing there to explain.**
 */
export const REJOIN_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * ⚠⚠ **What a signature is for** (`docs/adr/0029`).
 *
 * ⚠ **A mark and a join token are signed with the same secret, ⚠ so nothing but this keeps one
 * from verifying as the other.** ⚠ **It is inside the payload, ⚠ so it is inside the signature.**
 *
 * ⚠⚠ **The two payloads have the SAME shape on purpose** — ⚠ **same field count, ⚠ same order.**
 * ⚠ **The first version gave the mark one field fewer, ⚠ and a mutation proved what that meant:
 * ⚠ taking the purpose check out of `verifyJoinToken` changed nothing, ⚠ because the field count
 * was quietly doing the work.** ⚠ **A separation that holds by accident is not a separation** —
 * ⚠ **it holds until somebody adds a field** (`.claude/rules/security.md` § 4).
 */
const JOIN = "join";
const REJOIN = "rejoin";

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

/**
 * ⚠⚠ **The one signer** (`CLAUDE.md` § 3: ⚠ **never two implementations of one question**).
 *
 * ⚠ **Exported because the sign-in cookie is signed the same way** (`src/auth/session.ts`,
 * `docs/adr/0030`) — ⚠ **and a second HMAC written next to this one would be a second thing to
 * keep right.**
 * ⚠ **What keeps the two apart is the purpose at the head of the payload, ⚠ not the fact that
 * they live in different files** (`docs/adr/0029` paid for that lesson).
 */
export const signPayload = async (payload: string, secret: string): Promise<string> =>
  base64url(await hmac(secret, payload));

const sign = signPayload;

/**
 * ⚠⚠ **What this connection may do inside one room** ([`docs/adr/0018`](../../docs/adr/0018-give-the-host-a-short-lived-role-inside-one-room.md)).
 *
 * ⚠ **It is a role in a room, ⚠ for as long as the token lives.**
 * ⚠ **It is NOT an identity, ⚠ not an account, ⚠ and not a fact about a person or a device.**
 * ⚠ **Two connections holding host tokens for two rooms have nothing in common.**
 */
export type Role = "host" | "guest";

const ROLES: readonly string[] = ["host", "guest"];

/**
 * Mint a token for one room.
 *
 * ⚠ **The payload is readable by anyone holding the token** — ⚠ **it is signed, not encrypted.**
 * ⚠ **So it holds only the room id, an expiry, a nonce, and the role.** ⚠ **Nothing about who is
 * joining.** ⚠ **`role=host` says "this token opens that room's door", ⚠ and nothing else.**
 *
 * ⚠ **The role is inside the signature.** ⚠ **Editing it invalidates the token** — ⚠ **which is
 * the whole reason it lives here rather than in a field beside it.**
 */
export const issueJoinToken = async (
  roomId: string,
  secret: string,
  now: number,
  nonce: string = base64url(randomBytes(NONCE_BYTES)),
  role: Role = "guest",
): Promise<string> => {
  const payload = base64url(
    utf8.encode(`${JOIN}:${roomId}:${now + TOKEN_TTL_MS}:${nonce}:${role}`),
  );
  return `${payload}.${await sign(payload, secret)}`;
};

/**
 * ⚠⚠ **A new session id** (`src/signaling/hub.ts`).
 *
 * ⚠ **Exposed because a mark and the token it is exchanged for must carry the same one.**
 * ⚠ **The hub uses it to tell "the same participant reconnecting" from "a third person", ⚠ and a
 * returning Guest with a new one can be refused as `room-full` by their own half-open socket.**
 * ⚠ **It is not a secret** — ⚠ **it is random per session and means nothing outside one room.**
 */
export const newSessionId = (): string => base64url(randomBytes(NONCE_BYTES));

/**
 * ⚠⚠ **Mint a mark that lets one Guest come back to one room** (`docs/adr/0029`, kagima#90).
 *
 * ⚠ **It is not a way in.** ⚠ **It is exchanged for a short-lived token, ⚠ and the exchange
 * confirms the room still exists** (`.claude/rules/security.md` § 4).
 * ⚠ **The payload is readable by anyone holding it** — ⚠ **it holds the room, an expiry and the
 * session id, ⚠ and nothing about who is coming back.**
 */
export const issueRejoinMark = async (
  roomId: string,
  secret: string,
  now: number,
  sessionId: string,
  role: Role = "guest",
): Promise<string> => {
  const payload = base64url(
    utf8.encode(`${REJOIN}:${roomId}:${now + REJOIN_TTL_MS}:${sessionId}:${role}`),
  );
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
  | { readonly ok: true; readonly sessionId: string; readonly role: Role }
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
  // ⚠⚠ **The purpose first** (`docs/adr/0029`). ⚠ **A rejoin mark is signed with the same secret,
  //   ⚠ so this is the only thing stopping one from opening a socket by itself.**
  if (parts.length !== 5 || parts[0] !== JOIN) return { ok: false, why: "malformed" };

  const [, roomId, expText, nonce, roleText] = parts as [string, string, string, string, string];
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp)) return { ok: false, why: "malformed" };

  // ⚠⚠ **Fail closed** (`docs/adr/0018`). ⚠ **Anything that is not exactly a known role is
  //   ⚠ malformed, ⚠ never "guest by default"** — ⚠ **a default here is a default everywhere the
  //   ⚠ parser is wrong, ⚠ and one of those places would eventually be "host".**
  if (!ROLES.includes(roleText)) return { ok: false, why: "malformed" };

  // ⚠ Room before expiry: a token for another room is wrong whether or not it has expired,
  //   ⚠ and reporting the more specific fact keeps the counters meaningful.
  if (roomId !== expectedRoomId) return { ok: false, why: "wrong-room" };
  if (now >= exp) return { ok: false, why: "expired" };
  return { ok: true, sessionId: nonce, role: roleText as Role };
};

/**
 * ⚠⚠ **Check a rejoin mark** (`docs/adr/0029`).
 *
 * ⚠ **Signature first, ⚠ exactly as `verifyJoinToken` does, ⚠ and for the same reason: ⚠ reading
 * an expiry out of an unverified payload is trusting the attacker's own arithmetic.**
 *
 * ⚠ **`sessionId` comes back so the token minted next carries the same one** — ⚠ **without it the
 * returning Guest is a third person to `src/signaling/hub.ts`.**
 */
export type RejoinCheck =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly why: TokenRejection };

export const verifyRejoinMark = async (
  mark: string,
  expectedRoomId: string,
  secret: string,
  now: number,
): Promise<RejoinCheck> => {
  const dot = mark.indexOf(".");
  if (dot <= 0 || dot === mark.length - 1) return { ok: false, why: "malformed" };

  const payload = mark.slice(0, dot);
  const signature = mark.slice(dot + 1);
  if (!(await constantTimeEqual(signature, await sign(payload, secret))))
    return { ok: false, why: "bad-signature" };

  const parts = new TextDecoder().decode(base64urlDecode(payload)).split(":");
  // ⚠⚠ **A join token must never pass here either.** ⚠ **The separation runs both ways, ⚠ or it
  //   ⚠ is not a separation.**
  if (parts.length !== 5 || parts[0] !== REJOIN) return { ok: false, why: "malformed" };

  const [, roomId, expText, sessionId, roleText] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  // ⚠ Fail closed, ⚠ exactly as the join token does. ⚠ Never "guest by default".
  if (!ROLES.includes(roleText)) return { ok: false, why: "malformed" };
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp)) return { ok: false, why: "malformed" };
  if (roomId !== expectedRoomId) return { ok: false, why: "wrong-room" };
  if (now >= exp) return { ok: false, why: "expired" };
  return { ok: true, sessionId };
};
