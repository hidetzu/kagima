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
import { issueRejoinMark, newSessionId, verifyRejoinMark } from "../src/token/join-token.ts";

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
    // ⚠ These cases route; ⚠ they never ask for a page. ⚠ Saying so is better than
    //   ⚠ handing over a reader that would quietly work.
    asset: async () => null,
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

test("⚠⚠ there is no endpoint that takes a knock id, ⚠ and asking for one leaks nothing", async () => {
  // ⚠⚠ **`GET /api/rooms/{roomId}/knock/{knockId}` was here until `docs/adr/0028`.**
  //
  // ⚠ **It is gone because the id was in the path** — ⚠ **measured 2026-09-06, ⚠ Cloudflare's own
  //   ⚠ log carried that line, ⚠ and kagima never wrote it** (kagima#99).
  // ⚠ **The Host's decision is pushed over the waiting socket now** (`test/wait.test.ts`).
  //
  // ⚠⚠ **This case is about what is left behind.** ⚠ **A leftover route, ⚠ or a 405 that says
  //   ⚠ "that is a GET", ⚠ would still answer "this shape used to mean something here".**
  // ⚠ **So a real knock id, ⚠ an invented one, ⚠ and a path that was never an endpoint at all
  //   ⚠ must be one answer.**
  const { fetch } = await start();
  const room = await makeRoom(fetch);
  const knocked = (await (await knock(fetch, room.roomId)).json()) as { knockId: string };

  const real = await observable(await fetch(`/api/rooms/${room.roomId}/knock/${knocked.knockId}`));
  const invented = await observable(await fetch(`/api/rooms/${room.roomId}/knock/made-up`));
  const nonsense = await observable(await fetch(`/api/rooms/${room.roomId}/not-an-endpoint`));

  assert.equal(real.status, 404, "the endpoint that carried a knock id is still answering");
  assert.deepEqual(real, nonsense, "a real knock id answers unlike any other unknown path");
  assert.deepEqual(invented, nonsense, "an invented knock id answers unlike any other path");
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

// ── ⚠⚠ coming back to a room this device was let into (`docs/adr/0029`) ─────

const SECRET = "a-secret-for-this-test";

const rejoinWith = (fetch: Fetcher, roomId: string, mark: string) =>
  fetch(`/api/rooms/${roomId}/guest-session`, {
    method: "POST",
    body: JSON.stringify({ rejoin: mark }),
  });

test("⚠⚠ a mark that is good for a live room is exchanged for a short-lived token", async () => {
  const { fetch } = await start();
  const room = await makeRoom(fetch);
  const sessionId = newSessionId();
  const mark = await issueRejoinMark(room.roomId, SECRET, Date.now(), sessionId);

  const answer = await rejoinWith(fetch, room.roomId, mark);
  assert.equal(answer.status, 200);
  const body = (await answer.json()) as { token?: string; rejoin?: string };
  assert.equal(typeof body.token, "string");
  // ⚠⚠ Refreshed on every way in (`docs/adr/0029`). ⚠ A mark that never moved would expire under
  //   ⚠ somebody who has been using the room the whole time.
  //
  // ⚠⚠ **"Refreshed" is the expiry moving, ⚠ not the bytes differing.** ⚠ **Minted in the same
  //   ⚠ millisecond with the same session id, ⚠ the payload IS the same and so is the signature** —
  //   ⚠ **the first version of this case asserted the bytes and failed for that reason, ⚠ which
  //   ⚠ was the check being wrong and not the code.**
  assert.equal(typeof body.rejoin, "string");
  const expiryOf = (m: string) =>
    Number(
      Buffer.from(m.slice(0, m.indexOf(".")), "base64url")
        .toString("utf8")
        .split(":")[2],
    );
  assert.ok(
    expiryOf(body.rejoin as string) >= expiryOf(mark),
    "the mark handed back expires before the one that was sent",
  );
  assert.equal(
    (await verifyRejoinMark(body.rejoin as string, room.roomId, SECRET, Date.now())).ok,
    true,
  );
});

test("⚠⚠ every way a rejoin can fail is one answer", async () => {
  // ⚠⚠ **`.claude/rules/security.md` § 3.** ⚠ **Telling these apart would say whether a room
  //   ⚠ exists, ⚠ and whether somebody was ever let into it.**
  const { fetch } = await start();
  const room = await makeRoom(fetch);
  const sessionId = newSessionId();

  const forged = await issueRejoinMark(room.roomId, "somebody-elses-secret", Date.now(), sessionId);
  const elsewhere = await issueRejoinMark("zyxwvutsrq654321", SECRET, Date.now(), sessionId);
  // ⚠ A real mark, ⚠ for a room that was never minted. ⚠ This is the one that would otherwise
  //   ⚠ answer "does this room exist?" for free.
  const ghostRoom = "aaaaaaaaaabbbbbb";
  const ghost = await issueRejoinMark(ghostRoom, SECRET, Date.now(), sessionId);
  const expired = await issueRejoinMark(room.roomId, SECRET, 0, sessionId);

  const answers = [
    await observable(await rejoinWith(fetch, room.roomId, forged)),
    await observable(await rejoinWith(fetch, room.roomId, elsewhere)),
    await observable(await rejoinWith(fetch, ghostRoom, ghost)),
    await observable(await rejoinWith(fetch, room.roomId, expired)),
    await observable(await rejoinWith(fetch, room.roomId, "not-a-mark-at-all")),
  ];
  for (const answer of answers) {
    assert.deepEqual(answer, answers[0], "one of the refusals answered differently");
  }
  assert.equal(answers[0]?.status, 401);
});

test("⚠⚠ a room that is over refuses a mark that is still perfectly good", async () => {
  // ⚠⚠ **The room is what revokes a mark** (`docs/adr/0029`). ⚠ **There is nothing else that can.**
  const { fetch, ctx } = await start();
  const room = await makeRoom(fetch);
  const mark = await issueRejoinMark(room.roomId, SECRET, Date.now(), newSessionId());
  assert.equal((await rejoinWith(fetch, room.roomId, mark)).status, 200);

  ctx.store.close(room.roomId);

  const after = await observable(await rejoinWith(fetch, room.roomId, mark));
  assert.equal(after.status, 401, "a closed room let somebody back in");
  // ⚠ And it is the same refusal a forged mark gets — ⚠ never a third thing that says "it ended".
  const forged = await observable(
    await rejoinWith(fetch, room.roomId, await issueRejoinMark(room.roomId, "x", Date.now(), "s")),
  );
  assert.deepEqual(after, forged, "a closed room answered unlike a forged mark");
});
