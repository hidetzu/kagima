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

test("a fresh token verifies for its own room", () => {
  const token = issueJoinToken("room-a", SECRET, NOW);
  assert.deepEqual(verifyJoinToken(token, "room-a", SECRET, NOW), { ok: true });
});

test("⚠ a token is refused by a room it was not issued for", () => {
  // ⚠ Without this, one leaked link becomes all of them (`.claude/rules/security.md` § 4).
  const token = issueJoinToken("room-a", SECRET, NOW);
  assert.deepEqual(verifyJoinToken(token, "room-b", SECRET, NOW), { ok: false, why: "wrong-room" });
});

test("a token expires, and is good right up to the boundary", () => {
  const token = issueJoinToken("room-a", SECRET, NOW);
  assert.equal(verifyJoinToken(token, "room-a", SECRET, NOW + TOKEN_TTL_MS - 1).ok, true);
  assert.deepEqual(verifyJoinToken(token, "room-a", SECRET, NOW + TOKEN_TTL_MS), {
    ok: false,
    why: "expired",
  });
});

test("⚠ a token signed with another secret is refused", () => {
  const token = issueJoinToken("room-a", "some-other-secret", NOW);
  assert.deepEqual(verifyJoinToken(token, "room-a", SECRET, NOW), {
    ok: false,
    why: "bad-signature",
  });
});

test("⚠ an unsigned payload is refused as bad-signature, whatever it claims", () => {
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
    verifyJoinToken(`${expired}.${garbage}`, "room-a", SECRET, NOW),
    { ok: false, why: "bad-signature" },
    "an expired claim was read before the signature was checked",
  );

  const otherRoom = Buffer.from(`room-b:${NOW + TOKEN_TTL_MS}:x`, "utf8").toString("base64url");
  assert.deepEqual(
    verifyJoinToken(`${otherRoom}.${garbage}`, "room-a", SECRET, NOW),
    { ok: false, why: "bad-signature" },
    "a room claim was read before the signature was checked",
  );
});

test("a token with no signature, or no payload, is malformed", () => {
  for (const bad of ["", ".", "abc", ".sig", "payload."]) {
    assert.equal(verifyJoinToken(bad, "room-a", SECRET, NOW).ok, false, bad);
  }
});

test("⚠ two tokens for one room in one millisecond differ", () => {
  // ⚠ Without a nonce they would be identical, and one capture would be reusable for the whole TTL.
  assert.notEqual(issueJoinToken("room-a", SECRET, NOW), issueJoinToken("room-a", SECRET, NOW));
});

test("⚠ nothing of the passphrase is inside the token", () => {
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  const token = issueJoinToken(room.id, SECRET, NOW);
  const decoded = Buffer.from(token.slice(0, token.indexOf(".")), "base64url").toString("utf8");
  for (const word of room.passphrase.split("-")) {
    assert.ok(!decoded.includes(word), `a passphrase word (${word}) is in the token payload`);
    assert.ok(!token.includes(word), `a passphrase word (${word}) is in the token`);
  }
});

test("constantTimeEqual agrees with equality, including across lengths", () => {
  // ⚠ Different lengths must not throw. ⚠ Catching a throw would itself be a length oracle.
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "much longer than abc"), false);
  assert.equal(constantTimeEqual("", ""), true);
});

// ── joining ─────────────────────────────────────────────────────────────────

test("the right passphrase is exchanged for a token that verifies", () => {
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  const outcome = attemptJoin(store, room.id, room.passphrase, deps());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(verifyJoinToken(outcome.token, room.id, SECRET, NOW), { ok: true });
});

test("the passphrase is normalised before comparing", () => {
  // ⚠ The guest types what they heard. ⚠ docs/adr/0007 owns which forms fold together.
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  for (const typed of [
    room.passphrase.toUpperCase(),
    room.passphrase.replace(/-/g, " "),
    `  ${room.passphrase}  `,
  ]) {
    assert.equal(attemptJoin(store, room.id, typed, deps()).ok, true, typed);
  }
});

test("⚠ a wrong passphrase and an unknown room give the same answer", () => {
  // ⚠ This is the clause. ⚠ Anything the caller can see must be identical.
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);

  const wrong = attemptJoin(store, room.id, "not-the-right-passphrase", deps());
  const missing = attemptJoin(store, "z".repeat(ID_LENGTH), "not-the-right-passphrase", deps());

  assert.equal(wrong.ok, false);
  assert.equal(missing.ok, false);
  // ⚠ `why` is deliberately different — it is counted here and never sent.
  //   ⚠ What the caller sees is `ok`, and `ok` is the same.
  assert.equal(wrong.ok, missing.ok);
});

test("⚠ every path performs exactly one comparison", () => {
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
    attemptJoin(
      store,
      id,
      submitted,
      deps({
        compare: (a, b) => {
          calls++;
          return defaultCompare(a, b);
        },
      }),
    );
    assert.equal(calls, 1, `${name} did ${calls} comparisons`);
  }
});

test("⚠ the three refusals are counted apart", () => {
  // ⚠ An uncounted rejection is indistinguishable from a request that never arrived
  //   (`.claude/rules/evidence.md`).
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  const counter = createRejectionCounter();

  const record = (id: string, submitted: string) => {
    const outcome = attemptJoin(store, id, submitted, deps());
    if (!outcome.ok) counter.record(outcome.why);
  };
  record(room.id, "not-the-right-passphrase");
  record("z".repeat(ID_LENGTH), "whatever");
  record("nope", "whatever");
  record("nope", "whatever");

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

test("⚠ a counter starts at zero for every reason, not absent", () => {
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

test("closing a room makes it answer like a room that never existed", () => {
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  store.close(room.id);
  const outcome = attemptJoin(store, room.id, room.passphrase, deps());
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

test("⚠ the token is signed with node:crypto, not with something hand-rolled", async () => {
  const code = await readFile("src/token/join-token.ts", "utf8");
  assert.match(code, /import\s*\{[^}]*\bcreateHmac\b[^}]*\}\s*from\s*"node:crypto"/);
  assert.match(code, /timingSafeEqual/);
});
