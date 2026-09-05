// ⚠⚠ **The door.**
//
// ⚠ **kagima's entry is "did the Host invite you"** (`docs/PRODUCT.md` § 1, `docs/adr/0017`).
// ⚠ **So the thing to hold shut is not a secret — ⚠ it is what a caller can learn by knocking.**
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createKnocks, type Knocks, MAX_WAITING } from "../src/knock/knocks.ts";

let n = 0;
const make = (exists: (id: string) => boolean = () => true, maxWaiting?: number): Knocks =>
  createKnocks({
    newId: () => `k${n++}`,
    roomExists: exists,
    ...(maxWaiting === undefined ? {} : { maxWaiting }),
  });

// ── ⚠⚠ what a caller must not be able to learn ──────────────────────────────

test("⚠⚠ an unknown room, an unanswered room and a full room are the same from outside", () => {
  // ⚠⚠ **The clause.** ⚠ **Any difference here answers "does this room exist?" for free**
  //   (`.claude/rules/security.md` § 3), ⚠ **and the second one also says whether the Host is
  //   ⚠ at their desk** — ⚠ **which the passphrase version never revealed either.**
  const real = make();
  const ghost = make(() => false);
  const full = make(undefined, 1);
  full.knock("room-a", "先客", 0);

  const answers = [
    real.knock("room-a", "あん", 1),
    ghost.knock("room-a", "あん", 1),
    full.knock("room-a", "あん", 1),
  ];
  // ⚠ Same shape: ⚠ an id, every time.
  for (const a of answers) assert.match(a.id, /^k\d+$/, JSON.stringify(a));

  // ⚠ And reading them back says the same word.
  assert.equal(real.read("room-a", answers[0]?.id ?? "").state, "waiting");
  assert.equal(ghost.read("room-a", answers[1]?.id ?? "").state, "waiting");
  assert.equal(full.read("room-a", answers[2]?.id ?? "").state, "waiting");

  // ⚠ Internally they are three different things, ⚠ and they are counted apart
  //   (`.claude/rules/evidence.md`).
  assert.equal(answers[0]?.refused, null);
  assert.equal(answers[1]?.refused, "no-such-room");
  assert.equal(answers[2]?.refused, "too-many-waiting");
});

test("⚠⚠ an id nobody ever minted also reads as waiting", () => {
  // ⚠ Otherwise "is this knock real?" becomes a question a stranger can ask.
  const k = make();
  assert.equal(k.read("room-a", "never-existed").state, "waiting");
  assert.equal(k.read("no-such-room", "never-existed").state, "waiting");
});

test("⚠⚠ refused, closed and ended-while-waiting are one word to the Guest", () => {
  // ⚠ **`docs/adr/0017`**: ⚠ **"Host に拒否されました" would say the Host was there and decided.**
  // ⚠ **The Guest's next move is the same for all three** — ⚠ ask the person who invited them —
  //   ⚠ **so `CLAUDE.md` § 4-1 does not require telling them apart, ⚠ and telling them apart
  //   ⚠ would leak.**
  const refused = make();
  const r = refused.knock("room-a", "あん", 0);
  refused.decide("room-a", r.id, false, null);

  const ended = make();
  const e = ended.knock("room-a", "あん", 0);
  ended.endRoom("room-a");

  assert.equal(refused.read("room-a", r.id).state, "over");
  assert.equal(ended.read("room-a", e.id).state, "over");
});

// ── the Host's decision ─────────────────────────────────────────────────────

test("⚠ a token is handed over only when the Host admits", () => {
  const k = make();
  const a = k.knock("room-a", "あん", 0);
  assert.equal(k.read("room-a", a.id).token, undefined);
  k.decide("room-a", a.id, true, "a-token");
  assert.deepEqual(k.read("room-a", a.id), { state: "admitted", token: "a-token" });
});

test("⚠⚠ a decision is made once, and a second one changes nothing", () => {
  // ⚠ Otherwise a Host clicking twice mints two tokens, ⚠ or a refusal is undone by a stray
  //   ⚠ message arriving late (⚠ arrival order is not send order).
  const k = make();
  const a = k.knock("room-a", "あん", 0);
  k.decide("room-a", a.id, true, "first");
  k.decide("room-a", a.id, true, "second");
  assert.equal(k.read("room-a", a.id).token, "first");

  const b = k.knock("room-a", "いん", 0);
  k.decide("room-a", b.id, false, null);
  k.decide("room-a", b.id, true, "too-late");
  assert.deepEqual(k.read("room-a", b.id), { state: "over" });
});

test("⚠ admitting without a token does not admit", () => {
  // ⚠ A missing token would otherwise produce an "admitted" state nobody can use.
  const k = make();
  const a = k.knock("room-a", "あん", 0);
  k.decide("room-a", a.id, true, null);
  assert.equal(k.read("room-a", a.id).state, "over");
});

// ── ⚠ the cap ───────────────────────────────────────────────────────────────

test("⚠ the cap counts only those still waiting", () => {
  // ⚠ A decided knock must not hold a slot. ⚠ Otherwise one refusal fills the door for ever.
  const k = make(undefined, 2);
  const a = k.knock("room-a", "1", 0);
  k.knock("room-a", "2", 0);
  const third = k.knock("room-a", "3", 0);
  assert.equal(third.refused, "too-many-waiting");

  k.decide("room-a", a.id, false, null);
  assert.equal(k.knock("room-a", "4", 0).refused, null);
});

test("⚠ one room's door does not fill another's", () => {
  const k = make(undefined, 1);
  k.knock("room-a", "1", 0);
  assert.equal(k.knock("room-b", "2", 0).refused, null);
});

test("⚠ the Host sees who is waiting, oldest first", () => {
  const k = make();
  k.knock("room-a", "おそい", 20);
  k.knock("room-a", "はやい", 10);
  assert.deepEqual(
    k.waiting("room-a").map((w) => w.nickname),
    ["はやい", "おそい"],
  );
});

test("⚠ a decided knock leaves the Host's list", () => {
  const k = make();
  const a = k.knock("room-a", "あん", 0);
  k.decide("room-a", a.id, true, "t");
  assert.deepEqual(k.waiting("room-a"), []);
});

// ── ⚠ what the source is not allowed to do ──────────────────────────────────

test("⚠⚠ the cap is never named to a caller", async () => {
  // ⚠ **`docs/adr/0017`**: ⚠ **the cap is abuse protection, ⚠ not a product value.**
  // ⚠ **"最大 5 人待てます" must never be shown, ⚠ and neither must "満員".**
  const code = (await readFile("src/knock/knocks.ts", "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // ⚠ The refusal reason exists for counting; ⚠ it must never be part of what `read` returns.
  const read = /read\(roomId, id\)[\s\S]*?\n {4}},/.exec(code)?.[0];
  assert.ok(read !== undefined, "read is not where this check looks for it");
  assert.doesNotMatch(read, /too-many|full|refused/, `read leaks why: ${read}`);
  assert.ok(MAX_WAITING > 1, "one waiting slot lets an attacker hold the door");
});

test("⚠⚠ probing a URL nobody minted never becomes anything but waiting", () => {
  // ⚠⚠ **This is the property that actually matters.**
  //
  // ⚠ **`over` can only reach a knock that was registered — ⚠ so it tells a caller who already
  //   ⚠ had a real URL that the URL was real.** ⚠ **That is a real weakening against the
  //   ⚠ passphrase version, ⚠ and `src/knock/knocks.ts` says so in its own text.**
  //
  // ⚠ **What must NOT be possible is discovering rooms by probing.** ⚠ **A knock at a URL nobody
  //   ⚠ minted has no Host to refuse it and no room to end** — ⚠ **so it stays `waiting`, ⚠ for ever.**
  const k = make(() => false);
  const a = k.knock("guessed-room", "prober", 0);
  assert.equal(k.read("guessed-room", a.id).state, "waiting");
  // ⚠ Nothing the prober can do moves it.
  k.decide("guessed-room", a.id, false, null);
  k.endRoom("guessed-room");
  assert.equal(k.read("guessed-room", a.id).state, "waiting");
});

test("⚠⚠ a room ending does not send the people at its door back to waiting", () => {
  // ⚠ **Found by this check.** ⚠ **`endRoom` deleted the room's map, ⚠ so everyone waiting read
  //   ⚠ as `waiting` again** — ⚠ **and would have waited for a room that was gone.**
  const k = make();
  const a = k.knock("room-a", "あん", 0);
  k.endRoom("room-a");
  assert.equal(k.read("room-a", a.id).state, "over");
  // ⚠ And it stays that way. ⚠ A later read must not drift back.
  assert.equal(k.read("room-a", a.id).state, "over");
});
