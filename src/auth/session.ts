// ⚠⚠ **Who is allowed to make a room** (`docs/adr/0030`).
//
// ⚠ **Until 2026-09-08 the answer was "whoever was handed the Basic auth secret"**
//   (`docs/adr/0024`). ⚠ **One secret, ⚠ passed around, ⚠ saying nothing about who used it and
//   ⚠ revocable only for everybody at once.**
//
// ## ⚠ What this file does NOT do
//
// ⚠⚠ **It says nothing about the Guest.** ⚠ **Nobody who knocks, waits, or joins a call ever
//   ⚠ reaches this** (`src/worker.ts`, `src/gate.ts`) — ⚠ **and `docs/PRODUCT.md` § 5 still
//   ⚠ promises they are never identified.** ⚠ **The line is one: ⚠ the person who makes a room
//   ⚠ says who they are; ⚠ the person who comes in does not.**
//
// ## ⚠ What is kept
//
// ⚠⚠ **Nothing, ⚠ on our side** (stage 1 of `docs/adr/0030`). ⚠ **The allow-list is a secret and
//   ⚠ the session is a signed cookie on the person's own device.** ⚠ **No database, ⚠ so
//   ⚠ `docs/adr/0005` and `docs/adr/0023` do not move.**
//
// ⚠ **Nothing here reaches for a platform.** ⚠ **It is handed strings and answers.**
import { constantTimeEqual, signPayload } from "../token/join-token.ts";
import { base64url, base64urlDecode, randomBytes } from "../random.ts";

/**
 * ⚠⚠ **Purposes, ⚠ and they are what keeps a cookie from being a join token.**
 *
 * ⚠ **Everything here is signed with the same secret as `src/token/join-token.ts`.**
 * ⚠ **`docs/adr/0029` paid for this once: ⚠ two payloads were separated by how many fields they
 * had, ⚠ and taking the purpose check out changed nothing.** ⚠ **So the purpose is checked, ⚠ in
 * both directions, ⚠ and `test/auth-session.test.ts` proves each way.**
 */
const SESSION = "session";
const OAUTH = "oauth";

/** ⚠ **How long a sign-in lasts.** ⚠ **Chosen, not measured** (`.claude/rules/evidence.md`). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ⚠ **How long the round trip to Google may take.**
 *
 * ⚠ **It covers one redirect out and one back** — ⚠ **including a person reading a consent
 * screen.** ⚠ **Chosen, not measured.**
 */
export const OAUTH_TTL_MS = 10 * 60 * 1000;

export const SESSION_COOKIE = "kagima.session";
export const OAUTH_COOKIE = "kagima.oauth";

/** ⚠ **A value nobody can guess.** ⚠ From the same CSPRNG seam as everything else. */
export const newOpaque = (): string => base64url(randomBytes(16));

/**
 * ⚠ **One cookie out of a `Cookie:` header.**
 *
 * ⚠ **Never built from anything the caller sent** — ⚠ **the name is ours and the value is
 * returned untouched, ⚠ to be checked by a signature and nothing else.**
 */
export const cookieFrom = (header: string | null, name: string): string | null => {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    if (part.slice(0, at).trim() !== name) continue;
    return part.slice(at + 1).trim();
  }
  return null;
};

/**
 * ⚠ **The attributes, ⚠ and why each one is there.**
 *
 * ⚠ **`HttpOnly`: ⚠ no script of ours reads it, ⚠ so no script of anybody else's should.**
 * ⚠ **`SameSite=Lax`: ⚠ the sign-in comes back as a top-level redirect, ⚠ which Lax allows.**
 * ⚠ **`Secure`: ⚠ off only where there is no TLS to be had** — ⚠ **`http://127.0.0.1` in checks.**
 * ⚠ **`Max-Age`: ⚠ the browser drops it when we say it is over, ⚠ and the signature says so too.**
 */
export const setCookie = (name: string, value: string, maxAgeMs: number, secure: boolean): string =>
  `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${
    secure ? "; Secure" : ""
  }`;

/** ⚠ **Gone, ⚠ and gone now.** ⚠ Same attributes, ⚠ or a browser keeps the old one beside it. */
export const clearCookie = (name: string, secure: boolean): string =>
  `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;

const encode = (parts: readonly string[]): string =>
  base64url(new TextEncoder().encode(parts.join(":")));

const decode = (payload: string): string[] =>
  new TextDecoder().decode(base64urlDecode(payload)).split(":");

const sealed = async (parts: readonly string[], secret: string): Promise<string> => {
  const payload = encode(parts);
  return `${payload}.${await signPayload(payload, secret)}`;
};

/**
 * ⚠ **Signature first, ⚠ and before a single field is trusted.**
 *
 * ⚠ **Reading an expiry out of an unverified payload and acting on it is trusting the caller's
 * own arithmetic** (`src/token/join-token.ts` says the same, ⚠ for the same reason).
 */
const opened = async (
  value: string,
  purpose: string,
  fields: number,
  secret: string,
  now: number,
): Promise<string[] | null> => {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const payload = value.slice(0, dot);
  if (!(await constantTimeEqual(value.slice(dot + 1), await signPayload(payload, secret)))) {
    return null;
  }
  let parts: string[];
  try {
    parts = decode(payload);
  } catch {
    return null;
  }
  // ⚠⚠ **The purpose, ⚠ and the shape.** ⚠ **A join token must never open here, ⚠ and this must
  //   ⚠ never open there** (`docs/adr/0029`, `docs/adr/0030`).
  if (parts.length !== fields || parts[0] !== purpose) return null;
  const exp = Number(parts[fields - 1]);
  if (!Number.isSafeInteger(exp) || now >= exp) return null;
  return parts;
};

/**
 * ⚠⚠ **The sign-in, ⚠ as it sits on somebody's device.**
 *
 * ⚠ **It holds an email address and an expiry.** ⚠ **Nothing else** — ⚠ **no name, ⚠ no picture,
 * ⚠ no Google token.** ⚠ **The address is what the allow-list is written in terms of, ⚠ and it is
 * the least we can carry and still know who may make a room.**
 */
export const issueSession = (email: string, secret: string, now: number): Promise<string> =>
  sealed([SESSION, email, String(now + SESSION_TTL_MS)], secret);

export const readSession = async (
  value: string | null,
  secret: string,
  now: number,
): Promise<{ email: string } | null> => {
  if (value === null) return null;
  const parts = await opened(value, SESSION, 3, secret, now);
  return parts === null ? null : { email: parts[1] as string };
};

/**
 * ⚠⚠ **What has to survive the trip to Google and back** (`docs/adr/0030`).
 *
 * ⚠ **`state` is the anti-forgery value; ⚠ `nonce` is what the ID token must echo.**
 * ⚠ **They live in a signed cookie rather than on a server** — ⚠ **stage 1 keeps nothing.**
 */
export const issueOAuth = (
  state: string,
  nonce: string,
  secret: string,
  now: number,
): Promise<string> => sealed([OAUTH, state, nonce, String(now + OAUTH_TTL_MS)], secret);

export const readOAuth = async (
  value: string | null,
  secret: string,
  now: number,
): Promise<{ state: string; nonce: string } | null> => {
  if (value === null) return null;
  const parts = await opened(value, OAUTH, 4, secret, now);
  return parts === null ? null : { state: parts[1] as string, nonce: parts[2] as string };
};

/**
 * ⚠⚠ **Who may make a room** (stage 1 of `docs/adr/0030`).
 *
 * ⚠ **A list of addresses in a secret.** ⚠ **No database** — ⚠ **so nothing about who signed in
 * survives this process** (`docs/adr/0005`).
 *
 * ⚠ **An empty list allows nobody.** ⚠ **Fail closed** — ⚠ **a missing secret must not read as
 * "everyone", ⚠ which is exactly how a gate becomes no gate** (`src/gate.ts` says the same about
 * its own absence, ⚠ out loud, ⚠ at startup).
 * ⚠ **Compared in constant time** (`.claude/rules/security.md` § 1).
 */
export const isAllowed = async (email: string, allowList: string | undefined): Promise<boolean> => {
  const allowed = (allowList ?? "")
    .split(",")
    .map((one) => one.trim().toLowerCase())
    .filter((one) => one !== "");
  const looking = email.trim().toLowerCase();
  let found = false;
  // ⚠ Every entry, every time. ⚠ Stopping early would say where in the list the answer was.
  for (const one of allowed) if (await constantTimeEqual(one, looking)) found = true;
  return found;
};
