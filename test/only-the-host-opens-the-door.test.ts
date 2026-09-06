// ⚠⚠ **The wall `docs/adr/0018` exists for** (kagima#64).
//
// ⚠ **`docs/adr/0017` made the Host's decision the door itself.** ⚠ **Until 2026-09-06 a Guest
//   ⚠ already in the room could make that decision instead:**
//
// ```text
// ⚠ guest が受け取った knockId: ijDMWT0o7RpeYAI4R18WCA
// ⚠⚠ 3 人目の状態: admitted / token: ⚠ 発行された
// ⚠⚠ その token でハンドシェイクは通るか: true
// ⚠⚠ 2 人目が抜けたあと 3 人目は: 接続した / 部屋の人数: 2
// ```
//
// ## ⚠ Two defects, ⚠ and neither alone was the wall
//
// ⚠ **The announcement handed a Guest the `knockId`.** ⚠ **`admit` accepted it from anyone.**
// ⚠ **One was the key, ⚠ the other the keyhole.** ⚠ **Both are checked here.**
import assert from "node:assert/strict";
import { test } from "node:test";
import { createKnockRejectionCounter, createKnocks } from "../src/knock/knocks.ts";
import { randomToken } from "../src/random.ts";
import { createRoom } from "../src/room/create-room.ts";
import { createRoomStore } from "../src/room/store.ts";
import { type Context, handle } from "../src/server.ts";
import { authorizeUpgrade } from "../src/signaling/authorize.ts";
import { createHub } from "../src/signaling/hub.ts";
import { createSessions } from "../src/signaling/session.ts";
import type { SignalingSocket, SocketHandlers } from "../src/signaling/socket.ts";
import { issueJoinToken, type Role } from "../src/token/join-token.ts";

const SECRET = "a-door-secret";
const BASE = "http://127.0.0.1:9099";

/** ⚠ A socket that records rather than transmits, ⚠ and can be spoken through. */
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
  return { socket, sent, say: (line: string) => handlers?.onText(line) };
};

const aRoom = (who: "host+guest" | "guest" | "empty" = "host+guest") => {
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

  const host = fakeSocket();
  const guest = fakeSocket();
  if (who === "host+guest") sessions.open(host.socket, room.id, "s-host", "host");
  if (who !== "empty") sessions.open(guest.socket, room.id, "s-guest", "guest");

  const knock = (nickname: string) =>
    handle(
      ctx,
      new Request(`${BASE}/api/rooms/${room.id}/knock`, {
        method: "POST",
        body: JSON.stringify({ nickname }),
      }),
    );

  return { room, ctx, hub, knocks, host, guest, knock, sessions };
};

test("⚠⚠ a knock is told to the Host and to nobody else", async () => {
  const { host, guest, knock } = aRoom();

  await knock("さんにんめ");

  assert.equal(host.sent.length, 1, "the Host was not told somebody is at the door");
  assert.match(host.sent[0] ?? "", /"type":"knock"/);
  // ⚠⚠ The claim. ⚠ Not "the Guest's page ignores it" — ⚠ that is a different, weaker claim.
  assert.deepEqual(guest.sent, [], "the knock reached a Guest's socket");
});

test("⚠⚠ a Guest cannot open the door, and is not told that it tried", async () => {
  const { guest, host, knock, knocks, room } = aRoom();

  await knock("さんにんめ");
  const knockId = JSON.parse(host.sent[0] as string).knockId as string;

  // ⚠ The Guest is handed the id here, ⚠ which is more than it can get on its own now.
  //   ⚠ The wall must hold even then — ⚠ "it does not know the id" is not a wall.
  guest.say(JSON.stringify({ type: "admit", knockId, allow: true }));
  await new Promise((r) => setTimeout(r, 20));

  const read = knocks.read(room.id, knockId);
  assert.equal(read.state, "waiting", "a Guest admitted somebody");
  assert.equal(read.token, undefined, "a token was minted for a Guest's decision");

  // ⚠⚠ Silence, ⚠ not a refusal. ⚠ Answering would say that this knockId is a real one
  //   (`.claude/rules/security.md` § 3).
  assert.deepEqual(guest.sent, [], "the Guest was told something about its admit");
});

test("⚠ the Host can open the door, and what it mints actually opens it", async () => {
  const { host, knock, knocks, room } = aRoom();

  await knock("さんにんめ");
  const knockId = JSON.parse(host.sent[0] as string).knockId as string;

  host.say(JSON.stringify({ type: "admit", knockId, allow: true }));
  await new Promise((r) => setTimeout(r, 20));

  const read = knocks.read(room.id, knockId);
  assert.equal(read.state, "admitted");
  assert.ok(read.token !== undefined, "the Host admitted somebody and no token was minted");

  // ⚠ And the door really opens — ⚠ otherwise this case would pass on a token that does nothing.
  const verdict = await authorizeUpgrade(
    `/api/rooms/${room.id}/signal`,
    `kagima.token.${read.token}`,
    SECRET,
    Date.now(),
  );
  assert.equal(verdict.ok, true);
  // ⚠⚠ Admitted as a Guest. ⚠ Being let in is not being given the door.
  assert.equal(verdict.ok && verdict.role, "guest");
});

test("⚠⚠ the host key buys a role, and every refusal looks the same", async () => {
  const { ctx, room } = aRoom();

  const ask = (roomId: string, hostKey: unknown) =>
    handle(
      ctx,
      new Request(`${BASE}/api/rooms/${roomId}/host-session`, {
        method: "POST",
        body: JSON.stringify({ hostKey }),
      }),
    );

  const ok = await ask(room.id, room.hostKey);
  assert.equal(ok.status, 200);
  const { token } = (await ok.json()) as { token: string };

  const asHost = await authorizeUpgrade(
    `/api/rooms/${room.id}/signal`,
    `kagima.token.${token}`,
    SECRET,
    Date.now(),
  );
  assert.equal(asHost.ok && asHost.role, "host");

  // ⚠⚠ A wrong key, ⚠ a room that is not there, ⚠ and a room id that is not even a room id.
  //   ⚠ One answer (`.claude/rules/security.md` § 3) — ⚠ otherwise this endpoint says
  //   ⚠ "does this room exist?" for free.
  const refusals = [
    await ask(room.id, "not-the-host-key"),
    await ask("zzzzzzzzzzzzzzzz", room.hostKey),
    await ask("not-a-room-id", room.hostKey),
  ];
  const bodies: unknown[] = [];
  for (const r of refusals) {
    assert.equal(r.status, 401);
    bodies.push(await r.json());
  }
  console.log(`  observed: ${bodies.length} ways to be refused a host session`);
  assert.deepEqual(new Set(bodies.map((b) => JSON.stringify(b))).size, 1, "the refusals differ");
});

/**
 * ⚠⚠ **A correctly signed token in the shape that existed before roles.**
 *
 * ⚠ **The signing is written out again here on purpose** — ⚠ **the point is to forge something
 * `issueJoinToken` will not produce, ⚠ and asking it nicely cannot do that.**
 * ⚠ **If this ever stops matching `src/token/join-token.ts`, ⚠ the forged token stops verifying
 * and the case fails** — ⚠ **which is the safe direction for a divergence to break in.**
 */
const aTokenFromBeforeRoles = async (roomId: string, at: number): Promise<string> => {
  const utf8 = new TextEncoder();
  const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
  const payload = b64url(utf8.encode(`${roomId}:${at + 60_000}:a-nonce-from-before-roles`));
  const key = await crypto.subtle.importKey(
    "raw",
    utf8.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(payload)));
  return `${payload}.${b64url(sig)}`;
};

test("⚠⚠ a correctly signed token with no role opens nothing at all", async () => {
  // ⚠⚠ **Fail closed** (`docs/adr/0018`). ⚠ **A payload without a role is malformed** —
  //   ⚠ **not "guest by default".** ⚠ **A default here is a default everywhere the parser is
  //   ⚠ wrong, ⚠ and one of those places would eventually be "host".**
  const { room } = aRoom();

  const legacy = await aTokenFromBeforeRoles(room.id, Date.now());
  const verdict = await authorizeUpgrade(
    `/api/rooms/${room.id}/signal`,
    `kagima.token.${legacy}`,
    SECRET,
    Date.now(),
  );
  assert.equal(verdict.ok, false, "a token with no role was let in");
});

test("⚠⚠ a role this code does not know opens nothing at all", async () => {
  // ⚠ **The closed set is the wall.** ⚠ **"anything that is not host" would let `role=admin`
  //   ⚠ through as a Guest today ⚠ and as something else the day a third role appears.**
  const { room } = aRoom();
  const odd = await issueJoinToken(room.id, SECRET, Date.now(), undefined, "admin" as Role);
  const verdict = await authorizeUpgrade(
    `/api/rooms/${room.id}/signal`,
    `kagima.token.${odd}`,
    SECRET,
    Date.now(),
  );
  assert.equal(verdict.ok, false, "an unknown role was accepted");
});

test("⚠ the token creation hands back is a Guest's, and cannot open the door", async () => {
  const { ctx, room, sessions, knock, host, knocks } = aRoom();

  const made = await handle(ctx, new Request(`${BASE}/api/rooms`, { method: "POST" }));
  const created = (await made.json()) as { roomId: string; token: string };
  const verdict = await authorizeUpgrade(
    `/api/rooms/${created.roomId}/signal`,
    `kagima.token.${created.token}`,
    SECRET,
    Date.now(),
  );
  assert.equal(verdict.ok && verdict.role, "guest", "creation hands back a host token");

  // ⚠ And it behaves as one where it counts.
  await knock("よにんめ");
  const knockId = JSON.parse(host.sent[0] as string).knockId as string;
  const impostor = fakeSocket();
  sessions.open(impostor.socket, room.id, "s-impostor", verdict.ok ? verdict.role : "guest");
  impostor.say(JSON.stringify({ type: "admit", knockId, allow: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(knocks.read(room.id, knockId).state, "waiting");
});

test("⚠⚠ a host role is for one room, and does not travel", async () => {
  const mine = aRoom();
  const theirs = aRoom();

  const res = await handle(
    mine.ctx,
    new Request(`${BASE}/api/rooms/${mine.room.id}/host-session`, {
      method: "POST",
      body: JSON.stringify({ hostKey: mine.room.hostKey }),
    }),
  );
  const { token } = (await res.json()) as { token: string };

  const elsewhere = await authorizeUpgrade(
    `/api/rooms/${theirs.room.id}/signal`,
    `kagima.token.${token}`,
    SECRET,
    Date.now(),
  );
  assert.equal(elsewhere.ok, false, "a host token opened another room");
});

test("⚠⚠ nothing derived from the host key reaches the token", async () => {
  // ⚠ **`.claude/rules/security.md` § 4.** ⚠ **The payload is signed, ⚠ not encrypted** —
  //   ⚠ **anyone holding the token can read it.**
  const { ctx, room } = aRoom();
  const res = await handle(
    ctx,
    new Request(`${BASE}/api/rooms/${room.id}/host-session`, {
      method: "POST",
      body: JSON.stringify({ hostKey: room.hostKey }),
    }),
  );
  const { token } = (await res.json()) as { token: string };

  const payload = Buffer.from(token.slice(0, token.indexOf(".")), "base64url").toString("utf8");
  console.log(`  observed: the payload reads ${payload.replace(room.id, "{roomId}")}`);
  assert.ok(!payload.includes(room.hostKey), "the host key is inside the token");
  // ⚠ And the whole token, not only the readable half.
  assert.ok(!token.includes(room.hostKey), "the host key is inside the token");
});

test("⚠⚠ a knock with no Host connected answers exactly as one with a Host", async () => {
  // ⚠⚠ **The property this change is most likely to break** (`docs/adr/0017`).
  // ⚠ **Announcing only to the Host means nobody hears it when the Host is away** — ⚠ **and if
  //   ⚠ that were visible, ⚠ knocking would answer "is the Host at their desk?" for free.**
  // ⚠⚠ **The first attempt left a Guest connected in the "no Host" room, ⚠ so the room was not
  //   ⚠ actually empty and a mutation keyed on "nobody is here" sailed through.**
  const withHost = aRoom();
  const withoutHost = aRoom("empty");

  const a = await withHost.knock("だれか");
  const b = await withoutHost.knock("だれか");

  assert.equal(a.status, b.status);
  const [bodyA, bodyB] = [
    (await a.json()) as Record<string, unknown>,
    (await b.json()) as Record<string, unknown>,
  ];
  assert.deepEqual(Object.keys(bodyA).sort(), Object.keys(bodyB).sort());
  assert.equal(typeof bodyA["knockId"], typeof bodyB["knockId"]);
  console.log("  observed: both answers carry the same keys and the same shape");
});
