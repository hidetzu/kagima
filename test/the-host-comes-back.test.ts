// ⚠⚠ **The Host being away, and coming back** (kagima#70).
//
// ⚠ **Observed on 2026-09-06, before this existed:**
//
// ```text
// ⚠ Host の socket を閉じた。⚠ 部屋の人数: 0
// ⚠ 部屋はまだ在るか: true
// ⚠ ノックの答え: 200 { knockId: … }
// ⚠⚠ Host が受け取った行: 0 本
// ⚠⚠ ノックした人が見るもの: waiting
// ```
//
// ⚠ **The knock was never lost — ⚠ only its announcement was.** ⚠ **`knocks` still held it, ⚠ and
//   ⚠ the person was still standing there.**
import assert from "node:assert/strict";
import { test } from "node:test";
import { createKnockRejectionCounter, createKnocks } from "../src/knock/knocks.ts";
import { randomToken } from "../src/random.ts";
import { createRoom } from "../src/room/create-room.ts";
import { createRoomStore } from "../src/room/store.ts";
import { type Context, handle } from "../src/server.ts";
import { createHub } from "../src/signaling/hub.ts";
import { createSessions } from "../src/signaling/session.ts";
import type { SignalingSocket, SocketHandlers } from "../src/signaling/socket.ts";

const SECRET = "a-coming-back-secret";
const BASE = "http://127.0.0.1:9098";

const fakeSocket = () => {
  let handlers: SocketHandlers | undefined;
  const sent: string[] = [];
  const socket: SignalingSocket = {
    send: (line) => void sent.push(line),
    close: () => {},
    on: (h) => {
      handlers = h;
    },
  };
  return { socket, sent, end: () => handlers?.onClose() };
};

const aRoom = () => {
  const store = createRoomStore();
  const hub = createHub();
  const knocks = createKnocks({
    newId: () => randomToken(16),
    roomExists: (id) => store.get(id) !== undefined,
  });
  const { room } = createRoom(store, BASE);
  const ctx = {
    store,
    hub,
    knocks,
    baseUrl: BASE,
    secret: SECRET,
    knockRejections: createKnockRejectionCounter(),
    // ⚠ These cases route; ⚠ they never ask for a page. ⚠ Saying so is better than
    //   ⚠ handing over a reader that would quietly work.
    asset: async () => null,
    // ⚠ Nothing in front of these cases, ⚠ so the caller's address comes from the socket.
    trustedSourceHeader: "",
  } as Context;
  const sessions = createSessions({ hub, secret: SECRET, knocks });
  const knock = (nickname: string) =>
    handle(
      ctx,
      new Request(`${BASE}/api/rooms/${room.id}/knock`, {
        method: "POST",
        body: JSON.stringify({ nickname }),
      }),
    );
  return { room, ctx, hub, knocks, sessions, knock };
};

test("⚠⚠ a Host that comes back is told who is still at the door", async () => {
  const { room, sessions, knock } = aRoom();

  const away = fakeSocket();
  sessions.open(away.socket, room.id, "s-host", "host");
  away.end();

  // ⚠ Nobody is listening. ⚠ The announcement reaches no one — ⚠ that is the bug's own shape.
  await knock("ひとり目");
  await knock("ふたり目");
  assert.deepEqual(away.sent, [], "a closed socket was written to");

  const back = fakeSocket();
  sessions.open(back.socket, room.id, "s-host", "host");

  const names = back.sent.map((l) => (JSON.parse(l) as { nickname?: string }).nickname);
  console.log(`  observed: the returning Host was told about ${names.length}: ${names.join(", ")}`);
  assert.deepEqual(names, ["ひとり目", "ふたり目"], "the door's queue did not survive");
});

test("⚠ a Host arriving at a quiet room is told nothing", () => {
  // ⚠ One code path, ⚠ no "is this a reconnect?" — ⚠ we cannot tell and do not need to.
  const { room, sessions } = aRoom();
  const host = fakeSocket();
  sessions.open(host.socket, room.id, "s-host", "host");
  assert.deepEqual(host.sent, [], "a Host was told about a door nobody is at");
});

test("⚠⚠ the door's queue is never given to a Guest", async () => {
  // ⚠ `docs/adr/0018`. ⚠ The same rule as the announcement — ⚠ and a queue is worse than one
  //   ⚠ knock, ⚠ because it is every name at once.
  const { room, sessions, knock } = aRoom();
  const host = fakeSocket();
  sessions.open(host.socket, room.id, "s-host", "host");
  await knock("ひとり目");

  const guest = fakeSocket();
  sessions.open(guest.socket, room.id, "s-guest", "guest");

  assert.deepEqual(guest.sent, [], "a Guest was handed the door's queue");
});

test("⚠⚠ the queue carries the name and the id, and never the token", async () => {
  // ⚠ `.claude/rules/security.md` § 4. ⚠ The token is the Guest's way in; ⚠ the Host has no use
  //   ⚠ for it, ⚠ and a line the Host holds is a line that can be read over their shoulder.
  const { room, sessions, knocks, knock } = aRoom();
  const host = fakeSocket();
  sessions.open(host.socket, room.id, "s-host", "host");
  await knock("ひとり目");
  const knockId = JSON.parse(host.sent[0] as string).knockId as string;

  // ⚠ Admit them, so a token exists at all — ⚠ otherwise this passes for the wrong reason.
  knocks.decide(room.id, knockId, true, "a-real-looking-token");

  await knock("ふたり目");
  const back = fakeSocket();
  sessions.open(back.socket, room.id, "s-host", "host");

  for (const line of back.sent) {
    assert.doesNotMatch(line, /token/, `a token reached the Host's queue: ${line}`);
    assert.doesNotMatch(line, /a-real-looking-token/, `a token reached the Host's queue: ${line}`);
  }
  // ⚠ And the admitted one is no longer at the door.
  const names = back.sent.map((l) => (JSON.parse(l) as { nickname?: string }).nickname);
  assert.deepEqual(names, ["ふたり目"], "an admitted knock is still shown as waiting");
});
