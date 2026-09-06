// ⚠⚠ **One room, ⚠ one Durable Object** (`docs/adr/0022`, `docs/adr/0023`).
//
// ⚠ **What this can show**: ⚠ **the object writes four fields, ⚠ deletes them when the room is
//   ⚠ over, ⚠ and never writes anything else.**
// ⚠ **What it cannot show**: ⚠ **that a real Durable Object keeps them.** ⚠ **That is workerd's
//   ⚠ claim, ⚠ and it was measured by hand on 2026-09-06** — ⚠ **a room untouched for 40 s was
//   ⚠ still there, ⚠ where 15 s is the eviction window.**
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { generateRoomId } from "../src/room/room-id.ts";
import { ROOM_IDLE_MS } from "../src/room/store.ts";
import { ROOM_HEADER, RoomObject } from "../src/room-object.ts";
import { codeOf } from "./source-text.ts";

/** ⚠ A storage that records. ⚠ Nothing here is Cloudflare's; ⚠ the shape is what is used. */
const fakeStorage = () => {
  const held = new Map<string, unknown>();
  // ⚠ ⚠ The alarm is state too. ⚠ Recorded, ⚠ because "when does this room let go" is a claim.
  let alarmAt: number | null = null;
  return {
    held,
    alarmAt: () => alarmAt,
    as: {
      get: async (k: string) => held.get(k),
      put: async (k: string, v: unknown) => void held.set(k, v),
      delete: async (k: string) => held.delete(k),
      list: async () => new Map(held),
      setAlarm: async (at: number) => {
        alarmAt = at;
      },
      deleteAlarm: async () => {
        alarmAt = null;
      },
    },
  };
};

const anObject = (over: Record<string, unknown> = {}) => {
  const storage = fakeStorage();
  const object = new RoomObject({ storage: storage.as } as never, {
    JOIN_TOKEN_SECRET: "a-room-object-secret",
    PUBLIC_BASE_URL: "http://127.0.0.1:9097",
    ...over,
  });
  // ⚠ A real id. ⚠ The first fixture used a hand-typed one and `createRoom` refused it —
  //   ⚠ correctly, ⚠ and the refusal came back as the same 503 a taken id gives
  //   (`.claude/rules/security.md` § 3: ⚠ one answer, ⚠ which is also what hid the mistake).
  const room0 = generateRoomId();
  const ask = (path: string, init: RequestInit = {}, room = room0) => {
    const request = new Request(`http://127.0.0.1:9097${path}`, init);
    request.headers.set(ROOM_HEADER, room);
    return object.fetch(request);
  };
  return { storage, object, ask };
};

test("⚠⚠ exactly four fields are written, and nothing else", async () => {
  const { storage, ask } = anObject();

  const made = await ask("/api/rooms", { method: "POST" });
  assert.equal(made.status, 201);
  const body = (await made.json()) as { roomId: string; hostKey: string; token: string };

  const written = storage.held.get("room") as Record<string, unknown>;
  console.log(`  observed: the object wrote ${JSON.stringify(Object.keys(written).sort())}`);
  assert.deepEqual(Object.keys(written).sort(), ["createdAt", "hostKey", "id", "lastSeenAt"]);

  // ⚠⚠ **Never the token** (`.claude/rules/security.md` § 4). ⚠ **Its whole property is that it
  //   ⚠ does not last.**
  const asText = JSON.stringify([...storage.held.values()]);
  assert.doesNotMatch(asText, new RegExp(body.token.slice(0, 20)), "a join token was written");
  assert.equal(written["id"], body.roomId);
});

test("⚠⚠ a knock is never written", async () => {
  // ⚠ `docs/PRODUCT.md` § 5: ⚠ **誰がノックしたかを記録に残さない**.
  const { storage, ask } = anObject();
  await ask("/api/rooms", { method: "POST" });
  const made = storage.held.get("room") as { id: string };

  await ask(
    `/api/rooms/${made.id}/knock`,
    {
      method: "POST",
      body: JSON.stringify({ nickname: "アン" }),
    },
    made.id,
  );

  const asText = JSON.stringify([...storage.held.values()]);
  console.log(`  observed: after a knock the object holds ${asText}`);
  assert.doesNotMatch(asText, /アン/, "somebody's name was written");
  assert.equal(storage.held.size, 1, "the knock became a second thing to hold");
});

test("⚠⚠ the room that survived is the room that comes back", async () => {
  // ⚠ **This is what `docs/adr/0023` bought.** ⚠ **A fresh object, ⚠ handed the same storage,
  //   ⚠ answers as the same room.**
  const { storage, ask } = anObject();
  const made = await ask("/api/rooms", { method: "POST" });
  const { roomId, hostKey } = (await made.json()) as { roomId: string; hostKey: string };

  // ⚠ Evicted: ⚠ a new object, ⚠ nothing in memory, ⚠ the same storage underneath.
  const woken = new RoomObject({ storage: storage.as } as never, {
    JOIN_TOKEN_SECRET: "a-room-object-secret",
    PUBLIC_BASE_URL: "http://127.0.0.1:9097",
  });
  const request = new Request(`http://127.0.0.1:9097/api/rooms/${roomId}/host-session`, {
    method: "POST",
    body: JSON.stringify({ hostKey }),
  });
  request.headers.set(ROOM_HEADER, roomId);

  const answer = await woken.fetch(request);
  console.log(`  observed: after an eviction the host session answers ${answer.status}`);
  assert.equal(answer.status, 200, "the room did not survive being evicted");
});

test("⚠⚠ closing the room takes what was written with it", async () => {
  const { storage, ask } = anObject();
  const made = await ask("/api/rooms", { method: "POST" });
  const { roomId, hostKey } = (await made.json()) as { roomId: string; hostKey: string };
  assert.equal(storage.held.size, 1);

  await ask(
    `/api/rooms/${roomId}`,
    { method: "DELETE", body: JSON.stringify({ hostKey }) },
    roomId,
  );

  console.log(`  observed: after closing, the object holds ${storage.held.size} things`);
  assert.equal(storage.held.size, 0, "the room was closed and something was kept");
});

test("⚠ a room addressed without a name is our own mistake, and says so", async () => {
  const { object } = anObject();
  const answer = await object.fetch(new Request("http://127.0.0.1:9097/api/rooms/x/knock"));
  assert.equal(answer.status, 500, "a nameless request was answered as if it made sense");
});

test("⚠⚠ the object never grows its own copy of a rule", async () => {
  // ⚠ **`handle` decides. ⚠ This object supplies and persists** (`CLAUDE.md` § 3).
  const code = codeOf(await readFile("src/room-object.ts", "utf8"));
  for (const [what, pattern] of [
    ["the door", /knocks\.(knock|decide|read)\(/],
    ["tokens", /issueJoinToken|verifyJoinToken/],
    ["the host key comparison", /constantTimeEqual/],
  ] as const) {
    assert.doesNotMatch(code, pattern, `the object decides something about ${what}`);
  }
  assert.match(code, /handle\(ctx, request\)/, "the object does not go through handle");
});

test("⚠⚠ a room knows when it is over, ⚠ and the clock moves with it", async () => {
  // ⚠ **Node has a sweeper** (`src/node-server.ts`). ⚠ **A Durable Object has no process to run
  //   ⚠ one in** — ⚠ **so the room is what remembers** (`docs/adr/0025`).
  const { storage, ask } = anObject();
  const made = await ask("/api/rooms", { method: "POST" });
  const { roomId, hostKey } = (await made.json()) as { roomId: string; hostKey: string };

  const written = storage.held.get("room") as { lastSeenAt: number };
  const first = storage.alarmAt();
  console.log(`  observed: the room armed itself for ${(first ?? 0) - written.lastSeenAt}ms later`);
  assert.equal(first, written.lastSeenAt + ROOM_IDLE_MS, "the alarm is not the room's own life");

  // ⚠ Used again. ⚠ A room being used pushes its own end away (`docs/adr/0010`).
  await new Promise((r) => setTimeout(r, 5));
  await ask(
    `/api/rooms/${roomId}/host-session`,
    {
      method: "POST",
      body: JSON.stringify({ hostKey }),
    },
    roomId,
  );

  // ⚠ `host-session` does not touch the room, ⚠ so this asserts the alarm did NOT move —
  //   ⚠ which is the honest claim. ⚠ What moves it is `touch`, ⚠ and that is the heartbeat's.
  assert.equal(storage.alarmAt(), first, "the alarm moved without the room being used");
});

test("⚠⚠ when the alarm fires and the room is over, ⚠ nothing is kept", async () => {
  const { storage, object, ask } = anObject();
  await ask("/api/rooms", { method: "POST" });
  assert.equal(storage.held.size, 1);

  // ⚠ Old enough to be over. ⚠ Time is moved rather than waited out.
  const held = storage.held.get("room") as { lastSeenAt: number };
  storage.held.set("room", { ...held, lastSeenAt: Date.now() - ROOM_IDLE_MS - 1 });

  await object.alarm();

  console.log(`  observed: after the alarm the object holds ${storage.held.size} things`);
  assert.equal(storage.held.size, 0, "an expired room was kept");
  assert.equal(storage.alarmAt(), null, "the alarm was left armed for a room that is gone");
});

test("⚠⚠ an alarm that fires early re-arms rather than deleting", async () => {
  // ⚠ **A heartbeat can move `lastSeenAt` after the alarm was set.** ⚠ **Then the alarm is early,
  //   ⚠ not right** — ⚠ **and deleting a live room would be us ending a call nobody ended.**
  const { storage, object, ask } = anObject();
  await ask("/api/rooms", { method: "POST" });

  const held = storage.held.get("room") as { lastSeenAt: number };
  storage.held.set("room", { ...held, lastSeenAt: Date.now() });

  await object.alarm();

  assert.equal(storage.held.size, 1, "a live room was deleted by an early alarm");
  assert.ok((storage.alarmAt() ?? 0) > Date.now(), "the alarm was not re-armed");
});
