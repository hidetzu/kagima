// ⚠ **What is under test is that a brute force stops, and that a real guest does not.**
//
// ⚠ **The second half is the one that is easy to lose.** ⚠ **A limit that also locks out the
//   ⚠ person the room was made for is a denial of service we built ourselves**
//   (`.claude/rules/security.md` § 3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ROOM_LIMIT, SOURCE_LIMIT, WINDOW_MS, createRateLimiter } from "../src/room/rate-limit.ts";

// ⚠ Time is injected. ⚠ A test that waits for a window to roll over is slow and flaky, and it
//   ⚠ still could not show what happens exactly on the boundary.
const at = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

const fail = (
  limiter: ReturnType<typeof createRateLimiter>,
  room: string,
  src: string,
  times: number,
) => {
  for (let i = 0; i < times; i++) limiter.recordFailure(room, src);
};

test("an attempt is allowed when nothing has happened", () => {
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now });
  assert.equal(limiter.check("room-a", "1.2.3.4"), "allow");
});

// ── per source ──────────────────────────────────────────────────────────────

test("⚠ one source is stopped after SOURCE_LIMIT failures", () => {
  // ⚠ Actually driven past the threshold, not asserted against a constant.
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now });
  for (let i = 0; i < SOURCE_LIMIT; i++) {
    assert.equal(limiter.check("room-a", "1.2.3.4"), "allow", `attempt ${i + 1} should be allowed`);
    limiter.recordFailure("room-a", "1.2.3.4");
  }
  assert.equal(limiter.check("room-a", "1.2.3.4"), "source-limit");
});

test("⚠ the source limit follows the source across rooms", () => {
  // ⚠ Otherwise an attacker spreads over rooms and never meets it.
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now });
  for (let i = 0; i < SOURCE_LIMIT; i++) limiter.recordFailure(`room-${i}`, "1.2.3.4");
  assert.equal(limiter.check("room-somewhere-else", "1.2.3.4"), "source-limit");
});

test("another source is unaffected by the first one's failures", () => {
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now });
  fail(limiter, "room-a", "1.2.3.4", SOURCE_LIMIT);
  assert.equal(limiter.check("room-a", "5.6.7.8"), "allow");
});

test("the window rolls over, and not a moment early", () => {
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now });
  fail(limiter, "room-a", "1.2.3.4", SOURCE_LIMIT);
  clock.advance(WINDOW_MS - 1);
  assert.equal(limiter.check("room-a", "1.2.3.4"), "source-limit");
  clock.advance(1);
  assert.equal(limiter.check("room-a", "1.2.3.4"), "allow");
});

// ── per room ────────────────────────────────────────────────────────────────

test("⚠ a room is stopped after ROOM_LIMIT failures from sources that have failed there", () => {
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now });
  // ⚠ Spread across sources so the source limit is not what fires.
  for (let i = 0; i < ROOM_LIMIT; i++) limiter.recordFailure("room-a", `attacker-${i}`);
  // ⚠ A source that has already failed here is now inside the room's budget.
  assert.equal(limiter.check("room-a", "attacker-0"), "room-limit");
});

test("⚠⚠ a guest who has not failed in this room is never blocked by the room limit", () => {
  // ⚠ This is the clause the whole design is shaped by.
  //   ⚠ However much of the room's budget an attacker has burned, the real guest still gets a try.
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now });
  for (let i = 0; i < ROOM_LIMIT * 3; i++) limiter.recordFailure("room-a", `attacker-${i}`);

  assert.equal(limiter.check("room-a", "the-real-guest"), "allow");
});

test("⚠ but the guest is inside the budget from their second attempt", () => {
  // ⚠ Otherwise the rule would be "one free attempt per source", which is what a botnet wants.
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now });
  for (let i = 0; i < ROOM_LIMIT; i++) limiter.recordFailure("room-a", `attacker-${i}`);

  assert.equal(limiter.check("room-a", "the-real-guest"), "allow");
  limiter.recordFailure("room-a", "the-real-guest");
  assert.equal(limiter.check("room-a", "the-real-guest"), "room-limit");
});

test("a busy room does not spill into another room", () => {
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now });
  for (let i = 0; i < ROOM_LIMIT; i++) limiter.recordFailure("room-a", `attacker-${i}`);
  assert.equal(limiter.check("room-b", "attacker-0"), "allow");
});

// ── what a success costs ────────────────────────────────────────────────────

test("⚠ only failures consume budget", () => {
  // ⚠ A guest who gets it right first time must cost nobody anything.
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now });
  for (let i = 0; i < SOURCE_LIMIT * 4; i++) {
    assert.equal(limiter.check("room-a", "1.2.3.4"), "allow", `attempt ${i + 1}`);
    // ⚠ nothing recorded — this is what a success looks like to the limiter
  }
});

// ── capacity ────────────────────────────────────────────────────────────────

test("⚠ tracking is bounded, and reaching the ceiling is a decision rather than a crash", () => {
  // ⚠ Unbounded tracking is itself the attack: one packet per fake source until the process dies,
  //   ⚠ taking every live room with it (`docs/adr/0005`).
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now, maxBuckets: 30 });
  for (let i = 0; i < 100; i++) limiter.recordFailure("room-a", `flood-${i}`);
  assert.ok(limiter.size() <= 30, `tracking grew to ${limiter.size()}`);
  assert.equal(limiter.check("room-b", "someone-new"), "capacity");
});

test("⚠ capacity is released once the window has passed", () => {
  // ⚠ Otherwise a single flood would refuse joins forever.
  const clock = at();
  const limiter = createRateLimiter({ now: clock.now, maxBuckets: 30 });
  for (let i = 0; i < 100; i++) limiter.recordFailure("room-a", `flood-${i}`);
  assert.equal(limiter.check("room-b", "someone-new"), "capacity");
  clock.advance(WINDOW_MS);
  assert.equal(limiter.check("room-b", "someone-new"), "allow");
});

// ── the thresholds themselves ───────────────────────────────────────────────

test("⚠ the room limit is above the source limit", () => {
  // ⚠ The room limit is a backstop for many sources at once. ⚠ If it were the tighter of the two,
  //   ⚠ it would be the one a real guest meets, which is the failure this design is avoiding.
  assert.ok(ROOM_LIMIT > SOURCE_LIMIT, `room ${ROOM_LIMIT} is not above source ${SOURCE_LIMIT}`);
});
