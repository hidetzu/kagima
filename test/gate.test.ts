// ⚠⚠ **A door before the door** (`docs/adr/0024`).
//
// ⚠ **Measured 2026-09-06: ⚠ 20 requests to `POST /api/rooms` made 20 rooms, ⚠ with no
//   ⚠ credential at all.** ⚠ **On Cloudflare each is an object and a written row, ⚠ nothing
//   ⚠ collects them, ⚠ and past the Free boundary operations FAIL** (`docs/adr/0022`).
//
// ## ⚠⚠ The claim that matters most
//
// ⚠ **A Guest never meets this.** ⚠ **`docs/adr/0017` took the passphrase off the door on
//   ⚠ purpose; ⚠ a gate that a Guest had to pass would put it back through the side.**
import assert from "node:assert/strict";
import { test } from "node:test";
import { isGated, isSignIn, mayPass } from "../src/gate.ts";
import { issueSession, SESSION_COOKIE, SESSION_TTL_MS } from "../src/auth/session.ts";
import { issueJoinToken } from "../src/token/join-token.ts";

// ⚠⚠ **2026-09-08: ⚠ the gate stopped being a shared secret** (`docs/adr/0030`).
//   ⚠ **The person who makes a room signs in; ⚠ the Guest still never meets any of this.**

const SECRET = "a-signing-secret-for-this-test";
const ask = (path: string, method = "GET", cookie?: string) =>
  new Request(`http://127.0.0.1:9095${path}`, {
    method,
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });

test("⚠⚠ everything a Guest touches is outside the gate", () => {
  // ⚠⚠ **This is the whole reason the gate is two paths and not "the site"**
  //   (`docs/adr/0024`, `docs/adr/0017`).
  const GUEST = [
    ["GET", "/r/abcdefghij123456"],
    ["POST", "/api/rooms/abcdefghij123456/knock"],
    // ⚠ The waiting socket, ⚠ which replaced a `GET` that carried the knock id in its path
    //   (`docs/adr/0028`, kagima#99). ⚠ A Guest waits on this, ⚠ so it is outside the gate.
    ["GET", "/api/rooms/abcdefghij123456/wait"],
    ["GET", "/api/rooms/abcdefghij123456/signal"],
    // ⚠ Coming back to a room already joined (`docs/adr/0029`). ⚠ A Guest does this, ⚠ so it is
    //   ⚠ outside the gate — ⚠ behind it, ⚠ a thrown-away page could never come back.
    ["POST", "/api/rooms/abcdefghij123456/guest-session"],
    ["GET", "/client/guest.js"],
    ["GET", "/status/status.js"],
    ["GET", "/signaling/protocol.js"],
  ] as const;
  for (const [method, path] of GUEST) {
    assert.equal(isGated(method, path), false, `${method} ${path} is behind the gate`);
  }

  // ⚠ And the two that are. ⚠ Never assert only the negative: ⚠ a gate in front of nothing
  //   ⚠ would pass the half above.
  for (const [method, path] of [
    ["GET", "/"],
    ["GET", "/index.html"],
    ["POST", "/api/rooms"],
  ] as const) {
    assert.equal(isGated(method, path), true, `${method} ${path} is not behind the gate`);
  }
});

test("⚠⚠ signing in is outside the gate", () => {
  // ⚠⚠ **A gate in front of its own door lets nobody through, ⚠ ever.**
  for (const path of ["/auth/google", "/auth/google/callback"]) {
    assert.equal(isSignIn(path), true, `${path} is behind the gate`);
  }
  // ⚠ And it is not a prefix that swallows the site.
  assert.equal(isSignIn("/"), false);
  assert.equal(isSignIn("/r/abcdefghij123456"), false);
});

test("⚠ a signed-in person passes", async () => {
  const cookie = `${SESSION_COOKIE}=${await issueSession("somebody@example.test", SECRET, Date.now())}`;
  assert.equal(await mayPass(ask("/", "GET", cookie), SECRET), null);
});

test("⚠ a sign-in that has run out does not", async () => {
  const then = Date.now() - SESSION_TTL_MS - 1;
  const cookie = `${SESSION_COOKIE}=${await issueSession("somebody@example.test", SECRET, then)}`;
  assert.notEqual(await mayPass(ask("/", "GET", cookie), SECRET), null);
});

test("⚠⚠ a join token is not a way through the gate", async () => {
  // ⚠⚠ **Both are signed with the same secret** (`docs/adr/0030`). ⚠ **Only the purpose inside
  //   ⚠ the payload keeps one from being the other** — ⚠ **and `docs/adr/0029` paid to learn that
  //   ⚠ a separation which holds by accident is not a separation.**
  const token = await issueJoinToken("abcdefghij123456", SECRET, Date.now());
  const refused = await mayPass(ask("/", "GET", `${SESSION_COOKIE}=${token}`), SECRET);
  assert.notEqual(refused, null, "a join token opened the gate");
});

test("⚠⚠ every refusal is the same refusal", async () => {
  // ⚠ `.claude/rules/security.md` § 3. ⚠ Absent, ⚠ forged, ⚠ expired and for another purpose are
  //   ⚠ one answer. ⚠ Nothing says which it was.
  const stale = await issueSession(
    "somebody@example.test",
    SECRET,
    Date.now() - SESSION_TTL_MS - 1,
  );
  const elsewhere = await issueSession("somebody@example.test", "another-secret", Date.now());
  const refusals = await Promise.all(
    [
      undefined,
      `${SESSION_COOKIE}=not-a-cookie`,
      `${SESSION_COOKIE}=${stale}`,
      `${SESSION_COOKIE}=${elsewhere}`,
      "something.else=whatever",
    ].map((cookie) => mayPass(ask("/", "GET", cookie), SECRET)),
  );

  console.log(`  observed: ${refusals.length} ways to be refused`);
  const shapes = new Set<string>();
  for (const answer of refusals) {
    assert.ok(answer !== null, "something was let through");
    shapes.add(`${answer.status} ${answer.headers.get("location")}`);
    assert.equal(await answer.text(), "", "the refusal carried a body");
  }
  assert.equal(shapes.size, 1, "the refusals differ from each other");
  // ⚠⚠ **A browser is sent to sign in** — ⚠ **which is what the Basic auth box did: ⚠ arrive
  //   ⚠ without a credential and you are asked for one, immediately.** ⚠ **No new sentence.**
  assert.equal([...shapes][0], "302 /auth/google");
});

test("⚠⚠ something that is not a browser is refused rather than redirected", async () => {
  // ⚠ **`POST /api/rooms` is not followed by a consent screen.** ⚠ **Redirecting it would hang a
  //   ⚠ caller that cannot sign in** (`CLAUDE.md` § 4-1: ⚠ **the reader's next move**).
  const refused = await mayPass(ask("/api/rooms", "POST"), SECRET);
  assert.equal(refused?.status, 401);
});

test("⚠⚠ no sign-in configured means no gate, ⚠ and that is not a default", async () => {
  // ⚠ `.claude/rules/security.md` § 6: ⚠ never a default value. ⚠ The absence is a state, ⚠ and
  //   ⚠ the callers say it out loud rather than passing silently.
  assert.equal(await mayPass(ask("/"), undefined), null);
  assert.equal(await mayPass(ask("/"), ""), null);
});

test("⚠⚠ the session is compared in constant time, ⚠ and is never logged", async () => {
  // ⚠ `.claude/rules/security.md` § 1 and § 2. ⚠ Read as source, ⚠ because neither is visible
  //   ⚠ from the outside of a passing call.
  //
  // ⚠⚠ **The comparison moved with the code** (`docs/adr/0030`): ⚠ **it used to be in `gate.ts`
  //   ⚠ and is now in `src/auth/session.ts`, ⚠ where the cookie is opened.**
  // ⚠ **A wall about what a file does must follow what it loads** (`CLAUDE.md` § 9, 2026-09-06).
  const { readFile } = await import("node:fs/promises");
  const { codeOf } = await import("./source-text.ts");
  const gate = codeOf(await readFile("src/gate.ts", "utf8"));
  const session = codeOf(await readFile("src/auth/session.ts", "utf8"));

  assert.match(session, /constantTimeEqual/, "the cookie is compared some other way");
  assert.doesNotMatch(session, /logger|console/, "the sign-in reaches for a log");
  assert.doesNotMatch(gate, /logger|console/, "the gate reaches for a log");
  // ⚠⚠ **The address is what a log would leak** (`.claude/rules/security.md` § 2), ⚠ **and the
  //   ⚠ allow-list is compared, ⚠ never printed.**
  assert.doesNotMatch(session, /===\s*looking|looking\s*===/, "an address is compared with ===");
});
