// ⚠⚠ **The claim: ⚠ a failed media path is re-negotiated, ⚠ a bounded number of times, ⚠ and
//   ⚠ never into a socket that cannot carry the offer** (`src/call/restart.ts`, kagima#89).
//
// ⚠ **What this tier can hold, ⚠ and what it cannot.**
// ⚠ **There is no ICE agent in a unit test**, ⚠ **so nothing here says a real connection comes
//   ⚠ back.** ⚠ **What it says is that the policy asks for the right thing at the right moment.**
// ⚠ **The wiring in `src/client/call.ts` — ⚠ `failed` only, ⚠ offerer only, ⚠ one sequence at a
//   ⚠ time — ⚠ is not reachable from here** (`.claude/rules/evidence.md`: ⚠ **say which**).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANSWERER_RESTART_DELAYS_MS,
  driveRestart,
  onIncomingOffer,
  RESTART_DELAYS_MS,
  restartDelaysFor,
} from "../src/call/restart.ts";

/** ⚠ A world whose every answer is scripted, ⚠ so nothing is inferred from a real clock. */
const world = (script: { states: string[]; canSignal?: boolean[]; throwOnOffer?: boolean }) => {
  const waited: number[] = [];
  let offers = 0;
  let turn = 0;
  return {
    waited,
    offers: () => offers,
    world: {
      connectionState: () => script.states[turn] ?? script.states.at(-1) ?? "failed",
      canSignal: () => script.canSignal?.[turn] ?? true,
      offerAgain: async () => {
        if (script.throwOnOffer === true) throw new Error("⚠ could not build an offer");
        offers += 1;
      },
      wait: async (ms: number) => {
        waited.push(ms);
        // ⚠ The wait comes first in the loop, ⚠ so the turn just started is the one before it.
        turn = waited.length - 1;
      },
    },
  };
};

test("⚠ it re-offers while the connection is failed, and stops when it comes back", async () => {
  const w = world({ states: ["failed", "connected"] });
  assert.equal(await driveRestart(w.world, [10, 20, 30]), "recovered");
  assert.equal(w.offers(), 1, "one restart offer, then it was back");
});

test("⚠ a closed connection is `gone`, not a failure to recover", async () => {
  const w = world({ states: ["closed"] });
  assert.equal(await driveRestart(w.world, [10, 20, 30]), "gone");
  assert.equal(w.offers(), 0, "nothing is offered at a connection somebody hung up");
});

test("⚠⚠ the number of attempts is bounded by the delay list, and it stops", async () => {
  const w = world({ states: ["failed"] });
  assert.equal(await driveRestart(w.world, [10, 20, 30]), "exhausted");
  assert.equal(w.offers(), 3, "one per delay, and not one more");
  assert.deepEqual(w.waited, [10, 20, 30], "it waits before each attempt, in order");
});

test("⚠⚠ no attempt is spent while the offer could not leave the page", async () => {
  const w = world({ states: ["failed"], canSignal: [false, false, true] });
  assert.equal(await driveRestart(w.world, [10, 20, 30]), "exhausted");
  assert.equal(w.offers(), 1, "only the turn on which the socket could carry it");
});

test("⚠ a socket that never comes back produces no offers at all", async () => {
  const w = world({ states: ["failed"], canSignal: [false, false, false] });
  assert.equal(await driveRestart(w.world, [10, 20, 30]), "exhausted");
  assert.equal(w.offers(), 0);
});

test("⚠ an offer that cannot be built does not end the sequence", async () => {
  const w = world({ states: ["failed"], throwOnOffer: true });
  // ⚠ It must not reject: ⚠ the caller starts this without awaiting it.
  assert.equal(await driveRestart(w.world, [10, 20, 30]), "exhausted");
  assert.deepEqual(w.waited, [10, 20, 30], "every turn was still taken");
});

test("⚠ the shipped delays are bounded and start short", () => {
  // ⚠ Chromium spent 10.0s between `disconnected` and `failed` on 2026-09-06, ⚠ so the wait
  //   ⚠ before the first attempt is already paid for.
  assert.ok(RESTART_DELAYS_MS.length > 0 && RESTART_DELAYS_MS.length <= 8);
  assert.ok((RESTART_DELAYS_MS[0] ?? 0) <= 1_000, "the first wait is short");
});

// ⚠⚠ **The side that did not offer first also restarts** (`docs/adr/0027`, kagima#93).
//
// ⚠ **Measured on 2026-09-06: ⚠ the offerer was a phone in the background, ⚠ and the call sat in
//   ⚠ `failed` for 82.7 seconds while the other page was awake and answering every heartbeat.**

test("⚠⚠ the answerer waits out the offerer's first two attempts before it tries at all", () => {
  // ⚠⚠ **This is the whole of how glare is avoided.** ⚠ **Not a comment — ⚠ the wall.**
  const offererGetsTwoGoes = (RESTART_DELAYS_MS[0] ?? 0) + (RESTART_DELAYS_MS[1] ?? 0);
  assert.ok(
    (ANSWERER_RESTART_DELAYS_MS[0] ?? 0) > offererGetsTwoGoes,
    `the answerer would step on the offerer: ${ANSWERER_RESTART_DELAYS_MS[0]} vs ${offererGetsTwoGoes}`,
  );
});

test("⚠ each side is given its own list, from one place", () => {
  assert.deepEqual(restartDelaysFor(true), RESTART_DELAYS_MS);
  assert.deepEqual(restartDelaysFor(false), ANSWERER_RESTART_DELAYS_MS);
});

test("⚠ the answerer does nothing at all when the offerer got it back first", async () => {
  // ⚠ It is `connected` by the time the answerer's first wait is over.
  const w = world({ states: ["connected"] });
  assert.equal(await driveRestart(w.world, ANSWERER_RESTART_DELAYS_MS), "recovered");
  assert.equal(w.offers(), 0, "the answerer offered over a call that was already back");
});

test("⚠ an offer arriving with nothing of ours in flight is simply taken", () => {
  assert.equal(onIncomingOffer(true, "stable"), "take-it");
  assert.equal(onIncomingOffer(false, "stable"), "take-it");
  assert.equal(onIncomingOffer(false, "have-remote-offer"), "take-it");
});

test("⚠⚠ when both offered at once, the side that offered first wins and the other yields", () => {
  assert.equal(onIncomingOffer(true, "have-local-offer"), "ignore-it");
  assert.equal(onIncomingOffer(false, "have-local-offer"), "roll-back-first");
});
