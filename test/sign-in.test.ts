// ⚠⚠ **Signing in** (`docs/adr/0030`).
//
// ⚠ **Google's own document says an ID token received directly over HTTPS can be trusted without
//   ⚠ checking its signature** (⚠ 参照日 2026-09-08), ⚠ **and kagima passes it to nothing.**
// ⚠⚠ **So every remaining check IS the wall.** ⚠ **`iss`, ⚠ `aud`, ⚠ `exp`, ⚠ `nonce`,
//   ⚠ `email_verified`, ⚠ the allow-list, ⚠ and `state`.**
//
// ⚠ **Nothing here touches a network** — ⚠ **the exchange is injected**
//   (`.claude/rules/verification.md`: ⚠ **a check that depends on somebody else being up cannot
//   ⚠ assert our correctness**).
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkIdToken, type GoogleConfig } from "../src/auth/google.ts";
import { handleSignIn } from "../src/auth/routes.ts";
import {
  cookieFrom,
  isAllowed,
  OAUTH_COOKIE,
  readSession,
  SESSION_COOKIE,
} from "../src/auth/session.ts";
import { issueJoinToken } from "../src/token/join-token.ts";

const SECRET = "a-signing-secret-for-this-test";
const GOOGLE: GoogleConfig = {
  clientId: "a-client-id.apps.googleusercontent.com",
  clientSecret: "a-client-secret",
  redirectUri: "https://kagima.test/auth/google/callback",
};

const idToken = (claims: Record<string, unknown>): string => {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  // ⚠ The signature is not read (see the head of this file). ⚠ A shape, not a secret.
  return `header.${payload}.signature`;
};

const good = (over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: GOOGLE.clientId,
  exp: Math.floor(Date.now() / 1000) + 600,
  nonce: "a-nonce",
  email: "somebody@example.test",
  email_verified: true,
  ...over,
});

// ── ⚠⚠ the claims, ⚠ one at a time ──────────────────────────────────────────

test("⚠ a token with every claim right is accepted", () => {
  const checked = checkIdToken(idToken(good()), GOOGLE, "a-nonce", Date.now());
  assert.equal(checked.ok && checked.email, "somebody@example.test");
});

test("⚠⚠ every claim that binds the token to this request is checked", () => {
  // ⚠⚠ **This is the whole wall.** ⚠ **Nothing else stands between a forged token and a session.**
  const cases = [
    { over: { iss: "https://evil.test" }, why: "wrong-issuer" },
    { over: { aud: "somebody-elses-client-id" }, why: "wrong-audience" },
    { over: { exp: Math.floor(Date.now() / 1000) - 1 }, why: "expired" },
    { over: { nonce: "a-different-nonce" }, why: "wrong-nonce" },
    { over: { email_verified: false }, why: "unverified-email" },
    { over: { email: 42 }, why: "unverified-email" },
  ] as const;
  for (const { over, why } of cases) {
    const checked = checkIdToken(idToken(good(over)), GOOGLE, "a-nonce", Date.now());
    assert.equal(checked.ok, false, `${why} was accepted`);
    assert.equal(checked.ok === false && checked.why, why);
  }
  console.log(`  observed: ${cases.length} claims, each refused on its own`);
});

test("⚠ the other issuer Google publishes is accepted too", () => {
  // ⚠ **Google names two.** ⚠ **Accepting only one would refuse real tokens** — ⚠ **and the
  //   ⚠ person would have no idea why.**
  const checked = checkIdToken(
    idToken(good({ iss: "accounts.google.com" })),
    GOOGLE,
    "a-nonce",
    Date.now(),
  );
  assert.equal(checked.ok, true);
});

test("⚠ anything that is not three parts is malformed", () => {
  for (const bad of ["", "one.two", "one.two.three.four", "not-base64!.x.y"]) {
    assert.equal(checkIdToken(bad, GOOGLE, "a-nonce", Date.now()).ok, false, `${bad} was read`);
  }
});

// ── ⚠ who may make a room ───────────────────────────────────────────────────

test("⚠⚠ an empty allow-list allows nobody", async () => {
  // ⚠ **Fail closed.** ⚠ **A missing secret must not read as "everyone"** — ⚠ **that is how a
  //   ⚠ gate becomes no gate** (`.claude/rules/security.md` § 6).
  assert.equal(await isAllowed("somebody@example.test", undefined), false);
  assert.equal(await isAllowed("somebody@example.test", ""), false);
  assert.equal(await isAllowed("somebody@example.test", "  ,  , "), false);
});

test("⚠ the allow-list is read as a list, ⚠ and case does not decide it", async () => {
  const list = " First@Example.test , second@example.test ";
  assert.equal(await isAllowed("first@example.test", list), true);
  assert.equal(await isAllowed("SECOND@EXAMPLE.TEST", list), true);
  assert.equal(await isAllowed("third@example.test", list), false);
});

// ── ⚠⚠ the round trip ───────────────────────────────────────────────────────

const options = (over: Record<string, unknown> = {}) => ({
  google: GOOGLE,
  secret: SECRET,
  allowList: "somebody@example.test",
  secure: true,
  ...over,
});

const ask = (path: string, cookie?: string) =>
  new Request(`https://kagima.test${path}`, {
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });

const startSignIn = async () => {
  const url = new URL("https://kagima.test/auth/google");
  const answer = await handleSignIn(options(), ask("/auth/google"), url);
  assert.ok(answer !== null);
  const to = new URL(answer.headers.get("location") as string);
  const cookie = (answer.headers.get("set-cookie") as string).split(";")[0] as string;
  return { to, cookie, state: to.searchParams.get("state") as string };
};

test("⚠⚠ the trip out carries state and nonce, ⚠ and asks for the least it can", async () => {
  const { to, cookie } = await startSignIn();
  assert.equal(to.origin + to.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(to.searchParams.get("response_type"), "code");
  // ⚠⚠ **`openid email` and nothing else.** ⚠ **A name and a picture would be things kagima then
  //   ⚠ held about a person, ⚠ and it has no use for either** (`docs/PRODUCT.md` § 5).
  assert.equal(to.searchParams.get("scope"), "openid email");
  assert.ok((to.searchParams.get("state") ?? "").length >= 16, "the state is guessable");
  assert.ok((to.searchParams.get("nonce") ?? "").length >= 16, "the nonce is guessable");
  // ⚠ The round trip's own state rides in a signed cookie. ⚠ Stage 1 keeps nothing on a server.
  assert.match(cookie, new RegExp(`^${OAUTH_COOKIE}=`));
});

test("⚠⚠ the cookies are HttpOnly, SameSite=Lax and Secure", async () => {
  const url = new URL("https://kagima.test/auth/google");
  const answer = await handleSignIn(options(), ask("/auth/google"), url);
  const set = answer?.headers.get("set-cookie") as string;
  assert.match(set, /HttpOnly/, "a script can read the round trip");
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Secure/);
  // ⚠ And off where there is no TLS to be had — ⚠ checks and `wrangler dev --local`.
  const plain = await handleSignIn(options({ secure: false }), ask("/auth/google"), url);
  assert.doesNotMatch(plain?.headers.get("set-cookie") as string, /Secure/);
});

/** ⚠ **The whole trip, ⚠ with Google's half handed in.** */
const comeBack = async (
  over: {
    readonly claims?: Record<string, unknown>;
    readonly state?: string;
    readonly cookie?: string | null;
    readonly allowList?: string;
  } = {},
) => {
  const started = await startSignIn();
  const nonce = started.to.searchParams.get("nonce") as string;
  const state = over.state ?? started.state;
  const url = new URL(`https://kagima.test/auth/google/callback?code=a-code&state=${state}`);
  const cookie = over.cookie === undefined ? started.cookie : over.cookie;
  return handleSignIn(
    options({
      ...(over.allowList === undefined ? {} : { allowList: over.allowList }),
      exchangeCode: async () => idToken(good({ nonce, ...over.claims })),
    }),
    new Request(url, { ...(cookie === null ? {} : { headers: { cookie } }) }),
    url,
  );
};

test("⚠⚠ coming back with everything right leaves a session and nothing else", async () => {
  const answer = await comeBack();
  assert.equal(answer?.status, 302);
  assert.equal(answer?.headers.get("location"), "/");

  const set = answer?.headers.get("set-cookie") as string;
  const session = cookieFrom(set.split(";")[0] as string, SESSION_COOKIE);
  const read = await readSession(session, SECRET, Date.now());
  assert.equal(read?.email, "somebody@example.test");
});

test("⚠⚠ the session cookie is not a join token, ⚠ and a join token is not a session", async () => {
  // ⚠ **Both are signed with the same secret** (`docs/adr/0030`). ⚠ **Only the purpose separates
  //   ⚠ them, ⚠ and `docs/adr/0029` paid to learn that a separation by shape is an accident.**
  const answer = await comeBack();
  assert.ok(answer !== null);
  const set = (answer.headers.get("set-cookie") as string).split(";")[0] as string;
  const session = cookieFrom(set, SESSION_COOKIE) as string;

  const { verifyJoinToken } = await import("../src/token/join-token.ts");
  assert.equal(
    (await verifyJoinToken(session, "abcdefghij123456", SECRET, Date.now())).ok,
    false,
    "a sign-in cookie opened a room's socket",
  );
  const token = await issueJoinToken("abcdefghij123456", SECRET, Date.now());
  assert.equal(
    await readSession(token, SECRET, Date.now()),
    null,
    "a join token read as a session",
  );
});

test("⚠⚠ every way the trip back can fail is one answer, ⚠ except not being on the list", async () => {
  // ⚠ **`.claude/rules/security.md` § 3 for the failures that are about the trip.**
  // ⚠⚠ **Not being on the list is deliberately its OWN sentence**: ⚠ **"try again" is wrong
  //   ⚠ advice for somebody who signed in perfectly well** (`CLAUDE.md` § 4-1).
  const sameShape = await Promise.all([
    comeBack({ state: "a-state-nobody-issued" }),
    comeBack({ cookie: null }),
    comeBack({ claims: { iss: "https://evil.test" } }),
    comeBack({ claims: { aud: "somebody-elses-client-id" } }),
    comeBack({ claims: { nonce: "a-different-nonce" } }),
    comeBack({ claims: { email_verified: false } }),
  ]);
  const said = new Set<string>();
  for (const answer of sameShape) {
    assert.equal(answer?.status, 401);
    said.add(await (answer as Response).text());
    // ⚠ The half-finished trip is thrown away, ⚠ or the next attempt starts holding this one.
    assert.match(answer?.headers.get("set-cookie") as string, /Max-Age=0/);
  }
  assert.equal(said.size, 1, "the refusals differ from each other");
  console.log(`  observed: ${sameShape.length} ways to fail the trip, ⚠ one sentence`);

  const notOnTheList = await comeBack({ allowList: "somebody-else@example.test" });
  assert.equal(notOnTheList?.status, 401);
  assert.notEqual(await (notOnTheList as Response).text(), [...said][0], "one sentence for both");
});

test("⚠ with nothing configured there is no sign-in, ⚠ and it reads like any unknown path", async () => {
  const url = new URL("https://kagima.test/auth/google");
  const answer = await handleSignIn(options({ google: null }), ask("/auth/google"), url);
  assert.equal(answer?.status, 404);
  assert.equal(JSON.parse(await (answer as Response).text()).error, "no such endpoint");
});

test("⚠ a path that is not ours is left alone", async () => {
  const url = new URL("https://kagima.test/r/abcdefghij123456");
  assert.equal(await handleSignIn(options(), ask("/r/abcdefghij123456"), url), null);
});
