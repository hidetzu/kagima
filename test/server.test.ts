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
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createKnockRejectionCounter, createKnocks } from "../src/knock/knocks.ts";
import { createRoomStore } from "../src/room/store.ts";
import { type Context, handle } from "../src/server.ts";
import { createHub } from "../src/signaling/hub.ts";

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
    hub: createHub(),
    knocks: createKnocks({ newId: () => `k${Math.random()}`, roomExists: () => true }),
    knockRejections: createKnockRejectionCounter(),
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
  return (await res.json()) as {
    roomId: string;
    passphrase: string;
    shareUrl: string;
    hostKey: string;
  };
};

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

test("⚠ a room-creation response is never cached", async () => {
  const { base } = await start();
  const res = await fetch(`${base}/api/rooms`, { method: "POST" });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

// ── closing a room ──────────────────────────────────────────────────────────

const closeRoom = (base: string, roomId: string, hostKey: string) =>
  fetch(`${base}/api/rooms/${roomId}`, { method: "DELETE", body: JSON.stringify({ hostKey }) });

test("the host closes the room with the key it was given", async () => {
  const { base } = await start();
  const room = await makeRoom(base);
  assert.equal((await closeRoom(base, room.roomId, room.hostKey)).status, 200);
});

test("⚠⚠ nothing exists on the server only so that a check can call it", async () => {
  // ⚠⚠ **`stopAnswering()` was here for exactly one caller: ⚠ the browser check for
  //   ⚠ "signalling can go away and the call carries on"** (`docs/adr/0010`).
  // ⚠ **It reached inside the running server from the same process, ⚠ which the port to
  //   ⚠ Worker + Durable Objects makes impossible** (`docs/adr/0015`, kagima#49).
  // ⚠ **The check now takes the network away in front of the server instead** — ⚠ **closer to
  //   ⚠ what actually happens, ⚠ and it reaches into nothing.**
  //
  // ⚠⚠ **So the product lost a method it only had for a test.** ⚠ **That direction is the point:**
  //   ⚠ **this project has already paid for a mode added to make testing easier**
  //   (`docs/adr/0011` and `docs/adr/0014`).
  const source = await readFile("src/server.ts", "utf8");
  assert.doesNotMatch(
    source.replace(/^\s*\/\/.*$/gm, ""),
    /stopAnswering/,
    "the server carries a method that exists only for a check",
  );
});
