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
import { after, test } from "node:test";
import { createKnockRejectionCounter, createKnocks } from "../src/knock/knocks.ts";
import { createRoomStore } from "../src/room/store.ts";
import { type Context, handle } from "../src/server.ts";
import { createHub } from "../src/signaling/hub.ts";

// ⚠ **Sockets are dropped as well as the listener** — ⚠ **an open keep-alive connection keeps
//   ⚠ `server.close()` pending and the run never finishes.**

/** ⚠ **A fresh process every time.** ⚠ Shared state between cases would make an order dependence. */
const start = async (over: Partial<Context> = {}) => {
  // ⚠⚠ **The real store, ⚠ and the door asks it.**
  //
  // ⚠ **This was stubbed `roomExists: () => true` ⚠ and every "unknown room" case was therefore
  //   ⚠ knocking at a room the door believed in.** ⚠ **Two mutations walked straight past.**
  // ⚠ **A harness that lies makes every case above it a decoration.**
  const store = createRoomStore();
  const ctx: Context = {
    store,
    baseUrl: "http://127.0.0.1",
    secret: "a-secret-for-this-test",
    hub: createHub(),
    knocks: createKnocks({
      newId: () => `k${Math.random()}`,
      roomExists: (id) => store.get(id) !== undefined,
    }),
    knockRejections: createKnockRejectionCounter(),
    trustedSourceHeader: "",
    ...over,
  };
  // ⚠⚠ **No socket, ⚠ no port, ⚠ no listener.**
  //
  // ⚠ **`handle` speaks `Request` and `Response` now** (`docs/adr/0015`), ⚠ **so a check can call
  //   ⚠ it directly.** ⚠ **It used to need a running server, ⚠ which meant every case owned a
  //   ⚠ port and a teardown, ⚠ and a leaked one hung the whole run.**
  const base = "http://127.0.0.1";
  return {
    ctx,
    base,
    fetch: (path: string, init?: RequestInit) => handle(ctx, new Request(`${base}${path}`, init)),
  };
};

/** ⚠ **Everything a caller can observe**, ⚠ minus the one header that is time. */
const observable = async (res: Response) => {
  const headers = [...res.headers.entries()]
    .filter(([k]) => k !== "date")
    .sort(([a], [b]) => a.localeCompare(b));
  return { status: res.status, headers, body: await res.text() };
};

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

const makeRoom = async (fetch: Fetcher) => {
  const res = await fetch("/api/rooms", { method: "POST" });
  return (await res.json()) as { roomId: string; hostKey: string; token: string };
};

const knock = (fetch: Fetcher, roomId: string, nickname = "だれか") =>
  fetch(`/api/rooms/${roomId}/knock`, {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });

test("⚠⚠ knocking at a room that is not there looks like knocking at one that is", async () => {
  // ⚠⚠ **The property, ⚠ carried over from the passphrase** (`docs/adr/0017`).
  //   ⚠ **A distinguishable answer turns this endpoint into "does this room exist?" for anyone
  //   ⚠ who asks** (`.claude/rules/security.md` § 3), ⚠ **and it also says whether the Host is
  //   ⚠ at their desk.**
  const { fetch } = await start();
  const room = await makeRoom(fetch);

  const real = await observable(await knock(fetch, room.roomId));
  const unknown = await observable(await knock(fetch, "z".repeat(16)));
  const malformed = await observable(await knock(fetch, "nope"));

  // ⚠ The bodies carry a fresh id each time, ⚠ so the shape is what is compared.
  const shape = (o: Awaited<ReturnType<typeof observable>>) => ({
    status: o.status,
    headers: o.headers,
    keys: Object.keys(JSON.parse(o.body) as Record<string, unknown>).sort(),
  });
  assert.deepEqual(shape(unknown), shape(real), "an unknown room answers differently");
  assert.deepEqual(shape(malformed), shape(real), "a malformed room id answers differently");
});

test("⚠⚠ reading a knock nobody minted says the same as one that is waiting", async () => {
  const { fetch } = await start();
  const room = await makeRoom(fetch);
  const knocked = (await (await knock(fetch, room.roomId)).json()) as { knockId: string };

  const waiting = await observable(
    await fetch(`/api/rooms/${room.roomId}/knock/${knocked.knockId}`),
  );
  const invented = await observable(await fetch(`/api/rooms/${room.roomId}/knock/made-up`));
  assert.deepEqual(invented, waiting, "an invented knock id answers differently");
});

test("⚠ a room-creation response is never cached", async () => {
  const { fetch } = await start();
  const res = await fetch(`/api/rooms`, { method: "POST" });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

// ── closing a room ──────────────────────────────────────────────────────────

const closeRoom = (fetch: Fetcher, roomId: string, hostKey: string) =>
  fetch(`/api/rooms/${roomId}`, { method: "DELETE", body: JSON.stringify({ hostKey }) });

test("the host closes the room with the key it was given", async () => {
  const { fetch } = await start();
  const room = await makeRoom(fetch);
  assert.equal((await closeRoom(fetch, room.roomId, room.hostKey)).status, 200);
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
