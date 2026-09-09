// ⚠⚠ **The day's budget, ⚠ as arithmetic** (`docs/adr/0031`).
//
// ⚠ **What a Durable Object buys is that this runs one call at a time.** ⚠ **What it does not buy
//   ⚠ is any of the sums below being right** — ⚠ **so they are checked here, ⚠ with no object.**
import assert from "node:assert/strict";
import test from "node:test";
import { issueSession, readSession } from "../src/auth/session.ts";
import { hostMark } from "../src/quota/host-mark.ts";
import {
  dayOf,
  emptyLedger,
  type Ledger,
  LIMITS,
  mayOpen,
  onDay,
  opened,
  openRooms,
  over,
  refusalFrom,
  reported,
  WORDING,
} from "../src/quota/ledger.ts";

const MINUTE = 60_000;
const day = () => emptyLedger("2026-09-09");

test("⚠ the day is UTC, because the reset is", () => {
  // ⚠ Cloudflare's free limits reset at 00:00 UTC (`docs/adr/0031`, ⚠ 参照日 2026-09-08).
  assert.equal(dayOf(Date.UTC(2026, 8, 9, 23, 59, 59)), "2026-09-09");
  assert.equal(dayOf(Date.UTC(2026, 8, 10, 0, 0, 0)), "2026-09-10");
});

test("⚠⚠ the day turning throws everything away", () => {
  const held = over(reported(opened(day(), "r1", "h1"), "r1", 5 * MINUTE), "r1", 5 * MINUTE);
  assert.equal(held.usedMs, 5 * MINUTE);
  const fresh = onDay(held, "2026-09-10");
  assert.deepEqual(fresh, emptyLedger("2026-09-10"));
  // ⚠ 同じ日なら 触らない ― ⚠ 作り直すと その日の記録が消える。
  assert.equal(onDay(held, "2026-09-09"), held);
});

test("⚠⚠ a room reports its total, so a repeat adds nothing", () => {
  // ⚠ **This is the whole reason a total travels instead of a difference** (`docs/adr/0031`).
  //   ⚠ **A re-send, ⚠ a retry, ⚠ a room that came back after an eviction — ⚠ all the same.**
  let l: Ledger = opened(day(), "r1", "h1");
  l = reported(l, "r1", 10 * MINUTE);
  assert.equal(l.usedMs, 10 * MINUTE);
  l = reported(l, "r1", 10 * MINUTE);
  assert.equal(l.usedMs, 10 * MINUTE, "the same total was counted twice");
  l = reported(l, "r1", 25 * MINUTE);
  assert.equal(l.usedMs, 25 * MINUTE);
  assert.equal(l.perHost["h1"], 25 * MINUTE);
});

test("⚠ a total that went backwards adds nothing, and never subtracts", () => {
  let l: Ledger = reported(opened(day(), "r1", "h1"), "r1", 30 * MINUTE);
  l = reported(l, "r1", 5 * MINUTE);
  assert.equal(l.usedMs, 30 * MINUTE);
  assert.equal(l.perHost["h1"], 30 * MINUTE);
});

test("⚠ a room the ledger never opened is not counted", () => {
  // ⚠⚠ **Otherwise a report would be a way to make a room** — ⚠ **and the cap on how many are
  //   ⚠ open is the thing that bounds the overshoot.**
  const l = reported(day(), "never-opened", 10 * MINUTE);
  assert.equal(l.usedMs, 0);
  assert.equal(openRooms(l), 0);
});

test("⚠ opening the same room twice is still one room", () => {
  const l = opened(opened(day(), "r1", "h1"), "r1", "h1");
  assert.equal(openRooms(l), 1);
});

test("⚠ how many are open is read off the rooms, and is not a second number", () => {
  let l: Ledger = opened(opened(day(), "r1", "h1"), "r2", "h2");
  assert.equal(openRooms(l), 2);
  l = over(l, "r1", MINUTE);
  assert.equal(openRooms(l), 1);
  assert.equal(l.usedMs, MINUTE, "the last total was dropped with the room");
  // ⚠ 終わった部屋の行は 残らない ― ⚠ 残ると 同時数が いつまでも減らない。
  assert.equal(l.perRoom["r1"], undefined);
});

test("⚠ a room that is over twice is counted once", () => {
  let l: Ledger = opened(day(), "r1", "h1");
  l = over(l, "r1", 3 * MINUTE);
  l = over(l, "r1", 3 * MINUTE);
  assert.equal(l.usedMs, 3 * MINUTE);
});

test("⚠⚠ their own budget is answered before the service's", () => {
  // ⚠ **"You have used yours up" said to somebody who has not is untrue, ⚠ and their next move
  //   ⚠ is different** (`CLAUDE.md` § 4-1).
  const spent = { ...day(), perHost: { h1: LIMITS.hostMs } };
  assert.equal(mayOpen(spent, "h1"), "spent");
  assert.equal(mayOpen(spent, "h2"), null, "one person's budget stopped somebody else");
});

test("⚠ the service being full and too many at once are one answer", () => {
  const full = { ...day(), usedMs: LIMITS.serviceMs };
  assert.equal(mayOpen(full, "h1"), "busy");

  const rooms: Record<string, { host: string; ms: number }> = {};
  for (let i = 0; i < LIMITS.openRooms; i++) rooms[`r${i}`] = { host: `h${i}`, ms: 0 };
  assert.equal(mayOpen({ ...day(), perRoom: rooms }, "hx"), "busy");
  // ⚠ 上限に達していなければ 通る ― ⚠ 「いつも busy」でないことを見る。
  const { r0: dropped, ...fewer } = rooms;
  assert.ok(dropped !== undefined);
  assert.equal(mayOpen({ ...day(), perRoom: fewer }, "hx"), null);
});

test("⚠ the two sentences say what to do next, and neither says the other's thing", () => {
  assert.match(WORDING.spent, /明日/);
  assert.match(WORDING.busy, /しばらく/);
  assert.doesNotMatch(WORDING.busy, /使い切/);
});

test("⚠ 20 + 8 ≦ 28.21 — the numbers the limits were derived from", () => {
  // ⚠⚠ **The cap is soft: ⚠ rooms already open are never cut.** ⚠ **So the overshoot is
  //   ⚠ `open rooms × each one's remaining personal budget`, ⚠ and it has to fit under the tier.**
  // ⚠ **1 room-hour = 3600s × 0.128GB = 460.8 GB-s; ⚠ 13,000 / 460.8 = 28.21 room-hours.**
  const CEILING_HOURS = 13_000 / (3600 * 0.128);
  const service = LIMITS.serviceMs / (60 * 60 * 1000);
  const overshoot = (LIMITS.openRooms * LIMITS.hostMs) / (60 * 60 * 1000);
  assert.ok(
    service + overshoot <= CEILING_HOURS,
    `20 + 8 ≦ 28.21 no longer holds: ${service} + ${overshoot} > ${CEILING_HOURS}`,
  );
});

test("⚠⚠ the ledger's mark for a person is not the person", async () => {
  const secret = "a-signing-secret";
  const mark = await hostMark("someone@example.test", secret);
  // ⚠ **The address is not in it, ⚠ in any casing or encoding it was given in.**
  assert.doesNotMatch(mark, /someone|example/i);
  assert.equal(mark.includes("@"), false);
  // ⚠ The same person is the same mark, ⚠ or a budget cannot be theirs.
  assert.equal(mark, await hostMark("someone@example.test", secret));
  // ⚠ A different person is a different mark, ⚠ or two people share one budget.
  assert.notEqual(mark, await hostMark("other@example.test", secret));
  // ⚠⚠ **A different deployment is a different mark.** ⚠ **So the mark says nothing anywhere else.**
  assert.notEqual(mark, await hostMark("someone@example.test", "another-signing-secret"));
});

test("⚠ a mark is not a session, and a session is not a mark", async () => {
  // ⚠⚠ **One key signs all of them** (`docs/adr/0029`, `docs/adr/0030`).
  //   ⚠ **The purpose inside the payload is what keeps them apart.**
  const secret = "a-signing-secret";
  const email = "someone@example.test";
  const mark = await hostMark(email, secret);
  const session = await issueSession(email, secret, Date.now());
  assert.notEqual(mark, session);
  // ⚠ ⚠ A mark handed to the session reader opens nothing.
  assert.equal(await readSession(mark, secret, Date.now()), null);
});

test("⚠⚠ a ledger that did not answer is a refusal, and so is one we did not understand", () => {
  // ⚠⚠ **Owner 決定 2026-09-08: ⚠ fail closed** (`docs/adr/0031`).
  //   ⚠ **A window where the cap does not apply is a window in which the whole day is spent.**
  assert.equal(refusalFrom(null), "busy", "an unreachable ledger let a room through");
  assert.equal(refusalFrom({ ok: false, said: { refused: null } }), "busy");
  assert.equal(refusalFrom({ ok: true, said: null }), "busy");
  assert.equal(refusalFrom({ ok: true, said: "yes" }), "busy");
  assert.equal(refusalFrom({ ok: true, said: {} }), "busy", "a missing answer read as a yes");
  assert.equal(refusalFrom({ ok: true, said: { refused: "something-new" } }), "busy");
  // ⚠ And a yes is a yes ― ⚠ 「いつも断る」では 上限ではなく 閉店である。
  assert.equal(refusalFrom({ ok: true, said: { refused: null } }), null);
  assert.equal(refusalFrom({ ok: true, said: { refused: "spent" } }), "spent");
  assert.equal(refusalFrom({ ok: true, said: { refused: "busy" } }), "busy");
});
