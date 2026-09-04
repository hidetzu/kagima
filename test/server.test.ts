// ⚠ **What is under test is what a caller can actually see.**
//
// ⚠ **The unit tests assert that `attemptJoin` returns the same `ok` for every refusal, and that
//   ⚠ the limiter denies.** ⚠ **Neither of them can show that the bytes on the wire match** —
//   ⚠ **a status code, a header, or a stray field would give the answer away and every unit test
//   ⚠ would still pass.**
//
// ⚠ **So this drives the real handler over a real socket and compares the whole response.**
// ⚠ **It is at the edge of the fast tier**: ⚠ **it builds no environment and depends on nothing
//   ⚠ outside this process, but it does open a port.** ⚠ **It is not the final gate, and it does
//   ⚠ not pretend to be** (`.claude/skills/verify/SKILL.md` § 3 — ⚠ **that tier needs a browser**).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { type Context, handle } from "../src/server.ts";
import { createRejectionCounter } from "../src/room/join.ts";
import { createRateLimiter } from "../src/room/rate-limit.ts";
import { createRoomStore } from "../src/room/store.ts";

const started: Array<() => void> = [];
after(() => {
  for (const stop of started) stop();
});

// ⚠ **Sockets are dropped as well as the listener** — ⚠ **an open keep-alive connection keeps
//   ⚠ `server.close()` pending and the run never finishes.**

/** ⚠ **A fresh process every time.** ⚠ Shared state between cases would make an order dependence. */
const start = async (over: Partial<Context> = {}) => {
  const ctx: Context = {
    store: createRoomStore(),
    baseUrl: "http://127.0.0.1",
    secret: "a-secret-for-this-test",
    rejections: createRejectionCounter(),
    limiter: createRateLimiter({ now: Date.now }),
    trustedSourceHeader: "",
    ...over,
  };
  const server = createServer((req, res) => void handle(ctx, req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  started.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return { ctx, base: `http://127.0.0.1:${port}` };
};

/** ⚠ **Everything a caller can observe**, ⚠ minus the one header that is time. */
const observable = async (res: Response) => {
  const headers = [...res.headers.entries()]
    .filter(([k]) => k !== "date")
    .sort(([a], [b]) => a.localeCompare(b));
  return { status: res.status, headers, body: await res.text() };
};

const join = (base: string, roomId: string, passphrase: string) =>
  fetch(`${base}/api/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify({ passphrase }),
  });

const makeRoom = async (base: string) => {
  const res = await fetch(`${base}/api/rooms`, { method: "POST" });
  return (await res.json()) as { roomId: string; passphrase: string; shareUrl: string };
};

test("a room is created, and the passphrase is not in the share URL", async () => {
  const { base } = await start();
  const room = await makeRoom(base);
  assert.ok(!room.shareUrl.includes(room.passphrase));
});

test("the right passphrase opens the room", async () => {
  const { base } = await start();
  const room = await makeRoom(base);
  const res = await join(base, room.roomId, room.passphrase);
  assert.equal(res.status, 200);
});

test("⚠⚠ every refusal is byte for byte the same response", async () => {
  // ⚠ This is the property. ⚠ A distinguishable answer turns this endpoint into
  //   ⚠ "does this room exist?" for anyone who asks (`.claude/rules/security.md` § 3).
  const { base } = await start();
  const room = await makeRoom(base);

  const wrongPassphrase = await observable(
    await join(base, room.roomId, "wrong-wrong-wrong-wrong"),
  );
  const unknownRoom = await observable(await join(base, "z".repeat(16), "wrong-wrong-wrong-wrong"));
  const malformedId = await observable(await join(base, "nope", "wrong-wrong-wrong-wrong"));

  assert.deepEqual(unknownRoom, wrongPassphrase, "an unknown room answers differently");
  assert.deepEqual(malformedId, wrongPassphrase, "a malformed room id answers differently");
});

test("⚠⚠ a rate-limited refusal is the same response as a wrong passphrase", async () => {
  // ⚠ A 429 here would make the limit firing say "this room exists" out loud.
  //   ⚠ The cost is that a real guest gets no "slow down" hint. ⚠ That cost is accepted.
  const { base } = await start({ limiter: createRateLimiter({ now: Date.now, sourceLimit: 2 }) });
  const room = await makeRoom(base);

  const wrongPassphrase = await observable(
    await join(base, room.roomId, "wrong-wrong-wrong-wrong"),
  );
  await join(base, room.roomId, "wrong-wrong-wrong-wrong");
  // ⚠ Past the limit now. ⚠ Ask with the RIGHT passphrase, so the only reason to refuse is the limit.
  const limited = await observable(await join(base, room.roomId, room.passphrase));

  assert.deepEqual(limited, wrongPassphrase, "a rate-limited refusal is distinguishable");
});

test("⚠ a success costs nobody any budget, however many times it happens", async () => {
  // ⚠ This case exists because a weaker one did not catch its own mutation.
  //   ⚠ The version below it asserts a 200 before the limit has fired — ⚠ and a server that
  //   ⚠ recorded a failure on SUCCESS still passed it, because the check runs before the record.
  //   ⚠ What distinguishes the two is repeating the success past the limit.
  const { base } = await start({ limiter: createRateLimiter({ now: Date.now, sourceLimit: 2 }) });
  const room = await makeRoom(base);

  for (let i = 0; i < 5; i++) {
    const res = await join(base, room.roomId, room.passphrase);
    assert.equal(res.status, 200, `success ${i + 1} was refused — a success consumed budget`);
  }
});

test("⚠ the right passphrase is refused once the limit has fired", async () => {
  // ⚠ This is the only thing a caller can observe that shows the limit works at all.
  //   ⚠ Without a limiter this request returns 200.
  const { base } = await start({ limiter: createRateLimiter({ now: Date.now, sourceLimit: 1 }) });
  const room = await makeRoom(base);

  assert.equal(
    (await join(base, room.roomId, room.passphrase)).status,
    200,
    "a success must not cost budget",
  );
  await join(base, room.roomId, "wrong-wrong-wrong-wrong");
  assert.equal(
    (await join(base, room.roomId, room.passphrase)).status,
    401,
    "the limit did not fire",
  );
});

test("⚠ refusals are counted apart even though they are answered alike", async () => {
  // ⚠ An uncounted rejection is indistinguishable from a request that never arrived.
  const { base, ctx } = await start({
    limiter: createRateLimiter({ now: Date.now, sourceLimit: 2 }),
  });
  const room = await makeRoom(base);

  await join(base, room.roomId, "wrong-wrong-wrong-wrong");
  await join(base, "z".repeat(16), "wrong-wrong-wrong-wrong");
  await join(base, room.roomId, room.passphrase); // ⚠ refused by the limit, not by the passphrase

  const counts = ctx.rejections.counts();
  assert.equal(counts["wrong-passphrase"], 1);
  assert.equal(counts["unknown-room"], 1);
  assert.equal(counts["rate-limited-source"], 1);
});

test("a body that is not a join is refused as malformed, and says so", async () => {
  // ⚠ Malformed is not the same as declined (`.claude/rules/evidence.md`). ⚠ The caller is wrong,
  //   ⚠ and telling them so leaks nothing about any room.
  const { base } = await start();
  const room = await makeRoom(base);
  const notJson = await fetch(`${base}/api/rooms/${room.roomId}/join`, {
    method: "POST",
    body: "not json",
  });
  assert.equal(notJson.status, 400);

  const tooBig = await fetch(`${base}/api/rooms/${room.roomId}/join`, {
    method: "POST",
    body: JSON.stringify({ passphrase: "a".repeat(4096) }),
  });
  assert.equal(tooBig.status, 413);
});

test("⚠ a room-creation response is never cached", async () => {
  const { base } = await start();
  const res = await fetch(`${base}/api/rooms`, { method: "POST" });
  assert.equal(res.headers.get("cache-control"), "no-store");
});
