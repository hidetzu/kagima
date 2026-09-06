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
import { isGated, mayPass } from "../src/gate.ts";

const SECRET = "kagima:a-temporary-gate";
const basic = (value: string) => `Basic ${Buffer.from(value, "utf8").toString("base64")}`;
const ask = (path: string, method = "GET", auth?: string) =>
  new Request(`http://127.0.0.1:9095${path}`, {
    method,
    ...(auth === undefined ? {} : { headers: { authorization: auth } }),
  });

test("⚠⚠ everything a Guest touches is outside the gate", () => {
  // ⚠⚠ **This is the whole reason the gate is two paths and not "the site"**
  //   (`docs/adr/0024`, `docs/adr/0017`).
  const GUEST = [
    ["GET", "/r/abcdefghij123456"],
    ["POST", "/api/rooms/abcdefghij123456/knock"],
    ["GET", "/api/rooms/abcdefghij123456/knock/xyz"],
    ["GET", "/api/rooms/abcdefghij123456/signal"],
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

test("⚠ the right secret passes", async () => {
  assert.equal(await mayPass(ask("/", "GET", basic(SECRET)), SECRET), null);
});

test("⚠⚠ every refusal is the same refusal", async () => {
  // ⚠ `.claude/rules/security.md` § 3. ⚠ A wrong name, ⚠ a wrong secret, ⚠ a broken header and
  //   ⚠ none at all are one answer.
  const refusals = [
    await mayPass(ask("/"), SECRET),
    await mayPass(ask("/", "GET", "Basic not-base64!!"), SECRET),
    await mayPass(ask("/", "GET", "Bearer something"), SECRET),
    await mayPass(ask("/", "GET", basic("kagima:wrong")), SECRET),
    await mayPass(ask("/", "GET", basic("wrong:a-temporary-gate")), SECRET),
    await mayPass(ask("/", "GET", basic("")), SECRET),
  ];

  console.log(`  observed: ${refusals.length} ways to be refused`);
  const shapes = new Set<string>();
  for (const answer of refusals) {
    assert.ok(answer !== null, "something was let through");
    shapes.add(`${answer.status} ${answer.headers.get("www-authenticate")}`);
    // ⚠ Nothing about what was wrong. ⚠ A body would be somewhere to put it.
    assert.equal(await answer.text(), "", "the refusal carried a body");
  }
  assert.equal(shapes.size, 1, "the refusals differ from each other");
  assert.match([...shapes][0] as string, /^401 Basic/, "a browser will not be asked");
});

test("⚠⚠ no gate configured means no gate, ⚠ and that is not a default", async () => {
  // ⚠ `.claude/rules/security.md` § 6: ⚠ never a default value. ⚠ The absence is a state, ⚠ and
  //   ⚠ the callers say it out loud rather than passing silently.
  assert.equal(await mayPass(ask("/"), undefined), null);
  assert.equal(await mayPass(ask("/"), ""), null);
});

test("⚠⚠ the two halves are not compared separately", async () => {
  // ⚠ **Comparing the name and the secret apart would say which half was right** — ⚠ **and a
  //   ⚠ wrong name with the right secret would answer differently from the other way round.**
  const wrongName = await mayPass(ask("/", "GET", basic("nobody:a-temporary-gate")), SECRET);
  const wrongSecret = await mayPass(ask("/", "GET", basic("kagima:nothing")), SECRET);
  assert.ok(wrongName !== null && wrongSecret !== null);
  assert.equal(wrongName.status, wrongSecret.status);
  assert.equal(
    wrongName.headers.get("www-authenticate"),
    wrongSecret.headers.get("www-authenticate"),
  );
});

test("⚠⚠ the gate is compared in constant time, ⚠ and is never logged", async () => {
  // ⚠ `.claude/rules/security.md` § 1 and § 2. ⚠ Read as source, ⚠ because neither is visible
  //   ⚠ from the outside of a passing call.
  const { readFile } = await import("node:fs/promises");
  const { codeOf } = await import("./source-text.ts");
  const code = codeOf(await readFile("src/gate.ts", "utf8"));

  assert.match(code, /constantTimeEqual/, "the gate is compared some other way");
  // ⚠ **The comparison, ⚠ not every `===` in the file.** ⚠ **`expected === undefined` is asking
  //   ⚠ whether a gate exists, ⚠ which is not a secret and has no timing to leak.**
  // ⚠ **The first version banned both and failed on the wrong one** — ⚠ **a wall that names
  //   ⚠ something innocent is one that gets turned off** (`CLAUDE.md` § 9, 2026-09-06).
  assert.doesNotMatch(code, /===\s*decoded|decoded\s*===/, "what was offered is compared with ===");
  assert.doesNotMatch(code, /logger|console/, "the gate reaches for a log");

  // ⚠ And the whole `user:secret` is what goes into the comparison, ⚠ not a half of it.
  assert.match(code, /constantTimeEqual\(decoded, expected\)/, "the halves are compared apart");
});
