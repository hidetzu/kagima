// ⚠ **What is under test is what `docs/adr/0004` promises**, clause by clause.
//
// ⚠ **The clause that matters most is the one that is easiest to break without noticing:**
//   ⚠ **a wrong passphrase and a room that does not exist must be indistinguishable.**
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createRoom } from "../src/room/create-room.ts";
import {
  type JoinRejection,
  attemptJoin,
  createRejectionCounter,
  defaultCompare,
} from "../src/room/join.ts";
import { ID_LENGTH } from "../src/room/room-id.ts";
import { createRoomStore } from "../src/room/store.ts";
import {
  TOKEN_TTL_MS,
  constantTimeEqual,
  issueJoinToken,
  verifyJoinToken,
} from "../src/token/join-token.ts";

const BASE = "https://kagima.example";
const SECRET = "a-secret-that-only-this-test-knows";
const NOW = 1_700_000_000_000;

const deps = (over: Partial<Parameters<typeof attemptJoin>[3]> = {}) => ({
  now: () => NOW,
  secret: SECRET,
  compare: defaultCompare,
  ...over,
});

// ── the token ───────────────────────────────────────────────────────────────

test("a fresh token verifies for its own room", async () => {
  const token = await issueJoinToken("room-a", SECRET, NOW);
  const checked = await verifyJoinToken(token, "room-a", SECRET, NOW);
  assert.equal(checked.ok, true);
  // ⚠ The session id comes back only after the signature has been checked.
  if (checked.ok) assert.ok(checked.sessionId.length > 0);
});

test("⚠ a token is refused by a room it was not issued for", async () => {
  // ⚠ Without this, one leaked link becomes all of them (`.claude/rules/security.md` § 4).
  const token = await issueJoinToken("room-a", SECRET, NOW);
  assert.deepEqual(await verifyJoinToken(token, "room-b", SECRET, NOW), {
    ok: false,
    why: "wrong-room",
  });
});

test("a token expires, and is good right up to the boundary", async () => {
  const token = await issueJoinToken("room-a", SECRET, NOW);
  assert.equal((await verifyJoinToken(token, "room-a", SECRET, NOW + TOKEN_TTL_MS - 1)).ok, true);
  assert.deepEqual(await verifyJoinToken(token, "room-a", SECRET, NOW + TOKEN_TTL_MS), {
    ok: false,
    why: "expired",
  });
});

test("⚠ a token signed with another secret is refused", async () => {
  const token = await issueJoinToken("room-a", "some-other-secret", NOW);
  assert.deepEqual(await verifyJoinToken(token, "room-a", SECRET, NOW), {
    ok: false,
    why: "bad-signature",
  });
});

test("⚠ an unsigned payload is refused as bad-signature, whatever it claims", async () => {
  // ⚠ This is an ordering test, and getting it wrong is easy.
  //   ⚠ The first version of it forged `room-b` and checked against `room-b`, so the room
  //   ⚠ matched and the answer was bad-signature either way — ⚠ it passed with the signature
  //   ⚠ check moved AFTER the room check, and asserted nothing about order.
  //
  // ⚠ What distinguishes the orders is a payload that would produce a DIFFERENT reason if it
  //   ⚠ were read first. ⚠ So: a garbage signature over a payload that is both expired and for
  //   ⚠ another room. ⚠ Signature first -> bad-signature. ⚠ Payload first -> expired or wrong-room.
  const garbage = "not-a-real-signature";

  const expired = Buffer.from(`room-a:${NOW - 1}:x`, "utf8").toString("base64url");
  assert.deepEqual(
    await verifyJoinToken(`${expired}.${garbage}`, "room-a", SECRET, NOW),
    { ok: false, why: "bad-signature" },
    "an expired claim was read before the signature was checked",
  );

  const otherRoom = Buffer.from(`room-b:${NOW + TOKEN_TTL_MS}:x`, "utf8").toString("base64url");
  assert.deepEqual(
    await verifyJoinToken(`${otherRoom}.${garbage}`, "room-a", SECRET, NOW),
    { ok: false, why: "bad-signature" },
    "a room claim was read before the signature was checked",
  );
});

test("a token with no signature, or no payload, is malformed", async () => {
  for (const bad of ["", ".", "abc", ".sig", "payload."]) {
    assert.equal((await verifyJoinToken(bad, "room-a", SECRET, NOW)).ok, false, bad);
  }
});

test("⚠ two tokens for one room in one millisecond differ", async () => {
  // ⚠ Without a nonce they would be identical, and one capture would be reusable for the whole TTL.
  assert.notEqual(
    await issueJoinToken("room-a", SECRET, NOW),
    await issueJoinToken("room-a", SECRET, NOW),
  );
});

test("⚠ two tokens carry different session ids", async () => {
  // ⚠ A shared session id would make two participants replace each other on reconnect
  //   (`src/signaling/hub.ts`).
  const a = await verifyJoinToken(
    await issueJoinToken("room-a", SECRET, NOW),
    "room-a",
    SECRET,
    NOW,
  );
  const b = await verifyJoinToken(
    await issueJoinToken("room-a", SECRET, NOW),
    "room-a",
    SECRET,
    NOW,
  );
  assert.equal(a.ok && b.ok && a.sessionId !== b.sessionId, true);
});

test("⚠ nothing of the passphrase is inside the token", async () => {
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  const token = await issueJoinToken(room.id, SECRET, NOW);
  const decoded = Buffer.from(token.slice(0, token.indexOf(".")), "base64url").toString("utf8");
  for (const word of room.passphrase.split("-")) {
    assert.ok(!decoded.includes(word), `a passphrase word (${word}) is in the token payload`);
    assert.ok(!token.includes(word), `a passphrase word (${word}) is in the token`);
  }
});

test("constantTimeEqual agrees with equality, including across lengths", async () => {
  // ⚠ Different lengths must not throw. ⚠ Catching a throw would itself be a length oracle.
  assert.equal(await constantTimeEqual("abc", "abc"), true);
  assert.equal(await constantTimeEqual("abc", "abd"), false);
  assert.equal(await constantTimeEqual("abc", "much longer than abc"), false);
  assert.equal(await constantTimeEqual("", ""), true);
});

// ── joining ─────────────────────────────────────────────────────────────────

test("the right passphrase is exchanged for a token that verifies", async () => {
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  const outcome = await attemptJoin(store, room.id, room.passphrase, deps());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal((await verifyJoinToken(outcome.token, room.id, SECRET, NOW)).ok, true);
});

test("the passphrase is normalised before comparing", async () => {
  // ⚠ The guest types what they heard. ⚠ docs/adr/0007 owns which forms fold together.
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  for (const typed of [
    room.passphrase.toUpperCase(),
    room.passphrase.replace(/-/g, " "),
    `  ${room.passphrase}  `,
  ]) {
    assert.equal((await attemptJoin(store, room.id, typed, deps())).ok, true, typed);
  }
});

test("⚠ a wrong passphrase and an unknown room give the same answer", async () => {
  // ⚠ This is the clause. ⚠ Anything the caller can see must be identical.
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);

  const wrong = await attemptJoin(store, room.id, "not-the-right-passphrase", deps());
  const missing = await attemptJoin(
    store,
    "z".repeat(ID_LENGTH),
    "not-the-right-passphrase",
    deps(),
  );

  assert.equal(wrong.ok, false);
  assert.equal(missing.ok, false);
  // ⚠ `why` is deliberately different — it is counted here and never sent.
  //   ⚠ What the caller sees is `ok`, and `ok` is the same.
  assert.equal(wrong.ok, missing.ok);
});

test("⚠ every path performs exactly one comparison", async () => {
  // ⚠ This is how the timing class is asserted without timing anything.
  //   ⚠ An early return for an unknown room would skip the comparison, and the time saved
  //   ⚠ is the answer to "does this room exist?".
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);

  const runs: Array<[string, string, string]> = [
    ["right passphrase", room.id, room.passphrase],
    ["wrong passphrase", room.id, "not-the-right-passphrase"],
    ["unknown room", "z".repeat(ID_LENGTH), "not-the-right-passphrase"],
    ["malformed room id", "nope", "not-the-right-passphrase"],
  ];
  for (const [name, id, submitted] of runs) {
    let calls = 0;
    await attemptJoin(
      store,
      id,
      submitted,
      deps({
        compare: async (a, b) => {
          calls++;
          return await defaultCompare(a, b);
        },
      }),
    );
    assert.equal(calls, 1, `${name} did ${calls} comparisons`);
  }
});

test("⚠ the three refusals are counted apart", async () => {
  // ⚠ An uncounted rejection is indistinguishable from a request that never arrived
  //   (`.claude/rules/evidence.md`).
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  const counter = createRejectionCounter();

  const record = async (id: string, submitted: string) => {
    const outcome = await attemptJoin(store, id, submitted, deps());
    if (!outcome.ok) counter.record(outcome.why);
  };
  await record(room.id, "not-the-right-passphrase");
  await record("z".repeat(ID_LENGTH), "whatever");
  await record("nope", "whatever");
  await record("nope", "whatever");

  // ⚠ Every reason, including the ones kagima#5 added and this test never triggers.
  //   ⚠ Asserting only the three would let a new reason appear uncounted, and an uncounted
  //   ⚠ rejection is indistinguishable from a request that never arrived.
  assert.deepEqual(counter.counts(), {
    "wrong-passphrase": 1,
    "unknown-room": 1,
    "malformed-room-id": 2,
    "rate-limited-source": 0,
    "rate-limited-room": 0,
    "at-capacity": 0,
  });
});

test("⚠ a counter starts at zero for every reason, not absent", async () => {
  // ⚠ Zero is a measurement. ⚠ An absent key is not, and it reads as one.
  const counts = createRejectionCounter().counts();
  const reasons: JoinRejection[] = [
    "malformed-room-id",
    "unknown-room",
    "wrong-passphrase",
    "rate-limited-source",
    "rate-limited-room",
    "at-capacity",
  ];
  for (const r of reasons) assert.equal(counts[r], 0, `${r} is not present`);
});

test("closing a room makes it answer like a room that never existed", async () => {
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  store.close(room.id);
  const outcome = await attemptJoin(store, room.id, room.passphrase, deps());
  assert.deepEqual(outcome, { ok: false, why: "unknown-room" });
});

// ── ⚠ what the source is not allowed to do ──────────────────────────────────

test("⚠ no secret is compared with ===", async () => {
  // ⚠ Nothing above would fail if constantTimeEqual were replaced by ===. ⚠ Every outcome would
  //   ⚠ be identical and the comparison would leak, byte by byte, how far it got.
  const files = ["src/room/join.ts", "src/token/join-token.ts"];
  const offenders: string[] = [];
  for (const file of files) {
    const code = (await readFile(file, "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // ⚠ Any === or !== whose either side mentions a secret-shaped name.
    if (/(passphrase|secret|signature|token)\w*\s*[!=]==/i.test(code)) offenders.push(file);
    if (/[!=]==\s*\w*(passphrase|secret|signature)/i.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `a secret is compared with === in: ${offenders.join(", ")}`);
});

test("⚠⚠ the signature is a platform HMAC, not something hand-rolled", async () => {
  // ⚠ **It used to name `node:crypto`.** ⚠ **Workers does not have it** (`docs/adr/0015`), ⚠ so
  //   ⚠ the signing moved to Web Crypto — ⚠ **the same primitive under the portable name.**
  // ⚠ **The wall is unchanged: ⚠ the HMAC comes from the platform, ⚠ never from us.**
  const code = (await readFile("src/token/join-token.ts", "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /crypto\.subtle\.sign\(\s*"HMAC"/, "the signature is not a platform HMAC");
  assert.match(code, /hash:\s*"SHA-256"/, "the digest is not named");
  // ⚠⚠ Nothing resembling a hash written by hand. ⚠ That is the thing this check exists to forbid.
  assert.doesNotMatch(
    code,
    /0x[0-9a-f]{8}/i,
    "a magic constant appears — is a hash being written?",
  );
});

test("⚠⚠ the digest comparison looks at every byte, every time", async () => {
  // ⚠ **Node has `timingSafeEqual`; ⚠ Workers has `crypto.subtle.timingSafeEqual`.**
  //   ⚠ **Two names on two objects would be two implementations of one question** (`CLAUDE.md` § 3),
  //   ⚠ **so there is one, written here.**
  // ⚠ **This is not hand-rolling a protocol** — ⚠ **it is one invariant, ⚠ and the invariant is
  //   ⚠ that the loop never stops early.**
  const code = (await readFile("src/token/join-token.ts", "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const compare = /const equalDigests[\s\S]*?\n};/.exec(code)?.[0];
  assert.ok(compare !== undefined, "the comparison is not where this check looks for it");
  // ⚠⚠ **No early exit.** ⚠ A `return` inside the loop, or a `break`, is exactly the leak.
  assert.doesNotMatch(compare, /\bbreak\b/, "the comparison can stop early");
  assert.doesNotMatch(compare, /if\s*\([^)]*\)\s*return/, "the comparison can return early");
  assert.match(compare, /\|=/, "the comparison does not accumulate the difference");

  // ⚠ And it behaves: ⚠ equal is true, ⚠ one different character anywhere is false.
  assert.equal(await constantTimeEqual("same", "same"), true);
  assert.equal(await constantTimeEqual("same", "samf"), false);
  assert.equal(await constantTimeEqual("", ""), true);
  assert.equal(await constantTimeEqual("", "x"), false);
});

test("⚠⚠ constantTimeEqual actually goes through the digests", async () => {
  // ⚠⚠ **Found by mutation, ⚠ and the gap was already in `main`.**
  //
  // ⚠ **The `===` wall above only fires when a secret-shaped NAME sits beside the operator.**
  // ⚠ **`constantTimeEqual`'s parameters are called `a` and `b`** — ⚠ **so replacing its whole
  //   ⚠ body with `a === b` matched nothing, ⚠ every behavioural test still passed, ⚠ and the
  //   ⚠ comparison would have leaked byte by byte.**
  // ⚠ **A wall that looks like it covers something and does not is worse than no wall**, ⚠ because
  //   ⚠ it is counted as covering it.
  const code = (await readFile("src/token/join-token.ts", "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const body = /export const constantTimeEqual[\s\S]*?;\n/.exec(code)?.[0];
  assert.ok(body !== undefined, "constantTimeEqual is not where this check looks for it");
  assert.match(body, /equalDigests\(/, "the comparison does not go through the digests");
  assert.match(body, /hmac\(/, "the two sides are not made the same length first");
  assert.doesNotMatch(body, /[!=]==/, `constantTimeEqual compares directly: ${body}`);
});
