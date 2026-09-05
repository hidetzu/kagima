// ⚠ **What is under test is who may connect, what may cross, and what must not overwrite what.**
//
// ⚠ **The last one is the case that cannot be found by reading**
//   (`.claude/skills/change-review/SKILL.md` § 4 — ⚠ **delay it, invert the order, and see**).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import {
  CLOSE_ROOM_FULL,
  TOKEN_PROTOCOL_PREFIX,
  attachSignaling,
} from "../src/signaling/attach.ts";
import { CLOSE_REPLACED, ROOM_CAPACITY, createHub, type Peer } from "../src/signaling/hub.ts";
import {
  MAX_CANDIDATE_BYTES,
  MAX_NICKNAME_CHARS,
  MAX_SDP_BYTES,
  isNickname,
  parseClientMessage,
} from "../src/signaling/messages.ts";
import { issueJoinToken } from "../src/token/join-token.ts";

// ── what may cross ──────────────────────────────────────────────────────────

test("an offer, an answer, a candidate and a bye are understood", () => {
  assert.equal(parseClientMessage(JSON.stringify({ type: "offer", sdp: "v=0" })).ok, true);
  assert.equal(parseClientMessage(JSON.stringify({ type: "answer", sdp: "v=0" })).ok, true);
  assert.equal(
    parseClientMessage(JSON.stringify({ type: "candidate", candidate: "candidate:1", sdpMid: "0" }))
      .ok,
    true,
  );
  assert.equal(parseClientMessage(JSON.stringify({ type: "bye" })).ok, true);
});

test("⚠ malformed and unsupported are different answers", () => {
  // ⚠ Malformed means the sender got the format wrong. ⚠ Unsupported means we understood and
  //   ⚠ declined. ⚠ Collapsing them tells the sender to fix the wrong thing.
  assert.deepEqual(parseClientMessage("not json"), { ok: false, why: "not-json" });
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "offer" })), {
    ok: false,
    why: "malformed",
  });
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "whatever" })), {
    ok: false,
    why: "unsupported-type",
  });
  assert.deepEqual(parseClientMessage(JSON.stringify([1, 2])), { ok: false, why: "malformed" });
});

test("⚠ an oversized payload is refused by size, before it is parsed", () => {
  // ⚠ Parsing first means having already held it. ⚠ An unbounded SDP is a way to make this
  //   ⚠ process hold memory for somebody else.
  const huge = JSON.stringify({ type: "offer", sdp: "x".repeat(MAX_SDP_BYTES + 2048) });
  assert.deepEqual(parseClientMessage(huge), { ok: false, why: "too-large" });
});

test("⚠ an sdp or candidate just over its own ceiling is refused", () => {
  const sdp = JSON.stringify({ type: "offer", sdp: "x".repeat(MAX_SDP_BYTES + 1) });
  assert.equal(parseClientMessage(sdp).ok, false);
  const cand = JSON.stringify({
    type: "candidate",
    candidate: "x".repeat(MAX_CANDIDATE_BYTES + 1),
  });
  assert.equal(parseClientMessage(cand).ok, false);
});

test("⚠ a candidate's optional fields are checked, not trusted", () => {
  for (const bad of [
    { type: "candidate", candidate: "c", sdpMLineIndex: -1 },
    { type: "candidate", candidate: "c", sdpMLineIndex: 1.5 },
    { type: "candidate", candidate: "c", sdpMid: 123 },
  ]) {
    assert.equal(parseClientMessage(JSON.stringify(bad)).ok, false, JSON.stringify(bad));
  }
});

// ── the hub ─────────────────────────────────────────────────────────────────

const fakePeer = (id: number, sessionId: string) => {
  const sent: string[] = [];
  const closed: Array<[number, string]> = [];
  const peer: Peer = {
    id,
    sessionId,
    send: (line) => sent.push(line),
    close: (code, reason) => closed.push([code, reason]),
  };
  return { peer, sent, closed };
};

test("a message reaches the other peer in the room, and nobody else", () => {
  const hub = createHub();
  const a = fakePeer(1, "sa");
  const b = fakePeer(2, "sb");
  const elsewhere = fakePeer(3, "sc");
  hub.join("room-a", a.peer);
  hub.join("room-a", b.peer);
  hub.join("room-b", elsewhere.peer);

  assert.equal(hub.relay("room-a", 1, "hello"), "relayed");
  assert.deepEqual(b.sent, ["hello"]);
  assert.deepEqual(a.sent, [], "it was echoed back to the sender");
  assert.deepEqual(elsewhere.sent, [], "⚠ it reached another room");
});

test("a message with nobody else there is not an error", () => {
  const hub = createHub();
  hub.join("room-a", fakePeer(1, "sa").peer);
  assert.equal(hub.relay("room-a", 1, "hello"), "no-peer");
});

test(`⚠ a ${ROOM_CAPACITY + 1}th connection is refused, not queued`, () => {
  const hub = createHub();
  hub.join("room-a", fakePeer(1, "sa").peer);
  hub.join("room-a", fakePeer(2, "sb").peer);
  assert.equal(hub.join("room-a", fakePeer(3, "sc").peer), "room-full");
});

test("⚠ a reconnect replaces its own socket rather than taking a second slot", () => {
  // ⚠ Through a tunnel the old socket dies quietly. ⚠ Without this the reconnect is refused
  //   ⚠ as room-full, by a peer that is already gone.
  const hub = createHub();
  const host = fakePeer(1, "host");
  const guestOld = fakePeer(2, "guest");
  hub.join("room-a", host.peer);
  hub.join("room-a", guestOld.peer);

  const guestNew = fakePeer(3, "guest");
  assert.equal(hub.join("room-a", guestNew.peer), "joined");
  assert.deepEqual(guestOld.closed, [[CLOSE_REPLACED, "replaced by a newer connection"]]);
  assert.equal(hub.peerCount("room-a"), 2);
});

test("⚠⚠ a message from a replaced connection is dropped, not relayed", () => {
  // ⚠ This is the reordering case, and reading the code will not find it.
  //   ⚠ The old socket had a message in flight. ⚠ It arrives after the new one has joined.
  //   ⚠ Relaying it would apply an old peer's answer to a negotiation that has moved on.
  const hub = createHub();
  const host = fakePeer(1, "host");
  const guestOld = fakePeer(2, "guest");
  hub.join("room-a", host.peer);
  hub.join("room-a", guestOld.peer);

  hub.join("room-a", fakePeer(3, "guest").peer); // ⚠ the reconnect

  // ⚠ Now deliver from the OLD peer. ⚠ Order inverted on purpose.
  assert.equal(hub.relay("room-a", guestOld.peer.id, "late answer"), "stale");
  assert.deepEqual(host.sent, [], "⚠ a stale message reached the host");
});

test("leaving removes only that peer, and the room survives", () => {
  const hub = createHub();
  hub.join("room-a", fakePeer(1, "sa").peer);
  hub.join("room-a", fakePeer(2, "sb").peer);
  hub.leave("room-a", 1);
  assert.equal(hub.peerCount("room-a"), 1);
});

// ── the handshake, over a real socket ───────────────────────────────────────

const SECRET = "a-secret-for-this-test";
const closers: Array<() => void> = [];
after(() => {
  for (const c of closers) c();
});

// ⚠ **A test that fails before it closes its sockets leaves them open, and `server.close()`
//   ⚠ then never completes** — ⚠ **the whole run hangs instead of reporting the failure.**
// ⚠ **Found by a mutation: the mutation was correct, the harness was not, and a hang is worse
//   ⚠ than a red test because nobody can tell what broke** (`.claude/rules/verification.md`).
// ⚠ **So every server is torn down whatever happened.**

const startSignaling = async () => {
  const hub = createHub();
  const server = createServer();
  // ⚠ Kept, because an upgraded socket is no longer one of the HTTP server's connections —
  //   ⚠ `handleUpgrade` detaches it, so `closeAllConnections()` does not reach it.
  //   ⚠ That is why the first attempt at this still hung.
  const wss = attachSignaling(server, { hub, secret: SECRET, heartbeatMs: 50 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  closers.push(() => {
    for (const client of wss.clients) client.terminate();
    server.closeAllConnections();
    server.close();
  });
  return { hub, base: `ws://127.0.0.1:${port}` };
};

const connect = (base: string, roomId: string, token: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/api/rooms/${roomId}/signal`, [
      `${TOKEN_PROTOCOL_PREFIX}${token}`,
    ]);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("refused")), { once: true });
  });

test("a valid token for the room connects", async () => {
  const { base } = await startSignaling();
  const ws = await connect(base, "room-a", issueJoinToken("room-a", SECRET, Date.now()));
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
});

test("⚠ no token does not connect", async () => {
  const { base } = await startSignaling();
  await assert.rejects(
    () =>
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${base}/api/rooms/room-a/signal`);
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", () => reject(new Error("refused")), { once: true });
      }),
  );
});

test("⚠ a token for another room does not connect", async () => {
  // ⚠ Without this, one leaked token is every room (`.claude/rules/security.md` § 4).
  const { base } = await startSignaling();
  const token = issueJoinToken("room-b", SECRET, Date.now());
  await assert.rejects(() => connect(base, "room-a", token));
});

test("⚠ a token signed with another secret does not connect", async () => {
  const { base } = await startSignaling();
  const token = issueJoinToken("room-a", "some-other-secret", Date.now());
  await assert.rejects(() => connect(base, "room-a", token));
});

test("an offer crosses from one peer to the other, with `from` set by the server", async () => {
  const { base } = await startSignaling();
  const a = await connect(base, "room-a", issueJoinToken("room-a", SECRET, Date.now()));
  const b = await connect(base, "room-a", issueJoinToken("room-a", SECRET, Date.now()));

  const heard = new Promise<string>((resolve) => {
    b.addEventListener("message", (e) => resolve(String(e.data)), { once: true });
  });
  // ⚠ `from` is sent by the client too, and must be overwritten rather than trusted.
  a.send(JSON.stringify({ type: "offer", sdp: "v=0", from: 9999 }));
  const line = JSON.parse(await heard) as { type: string; sdp: string; from: number };
  assert.equal(line.type, "offer");
  assert.equal(line.sdp, "v=0");
  assert.notEqual(line.from, 9999, "⚠ the client chose its own id");
  a.close();
  b.close();
});

test("⚠ a third connection is closed with a reason that says what happened", async () => {
  const { base } = await startSignaling();
  const a = await connect(base, "room-a", issueJoinToken("room-a", SECRET, Date.now()));
  const b = await connect(base, "room-a", issueJoinToken("room-a", SECRET, Date.now()));
  const c = await connect(base, "room-a", issueJoinToken("room-a", SECRET, Date.now()));

  const closed = await new Promise<CloseEvent>((resolve) => {
    c.addEventListener("close", (e) => resolve(e as CloseEvent), { once: true });
  });
  assert.equal(closed.code, CLOSE_ROOM_FULL);
  a.close();
  b.close();
});

test("⚠ a malformed message is answered, not silently dropped", async () => {
  // ⚠ Something discarded with nothing said is indistinguishable from something that never
  //   ⚠ arrived (`.claude/rules/evidence.md`).
  const { base } = await startSignaling();
  const a = await connect(base, "room-a", issueJoinToken("room-a", SECRET, Date.now()));
  const heard = new Promise<string>((resolve) => {
    a.addEventListener("message", (e) => resolve(String(e.data)), { once: true });
  });
  a.send("not json");
  assert.deepEqual(JSON.parse(await heard), { type: "refused", why: "not-json" });
  a.close();
});

test("⚠ one peer leaving does not close the room for the other", async () => {
  // ⚠ A signalling socket dropping is not a room ending. ⚠ An established call carries on
  //   ⚠ without us (`docs/adr/0003`).
  const { base, hub } = await startSignaling();
  const a = await connect(base, "room-a", issueJoinToken("room-a", SECRET, Date.now()));
  const b = await connect(base, "room-a", issueJoinToken("room-a", SECRET, Date.now()));
  assert.equal(hub.peerCount("room-a"), 2);

  await new Promise<void>((resolve) => {
    a.addEventListener("close", () => resolve(), { once: true });
    a.close();
  });
  // ⚠ Give the server's close handler a turn.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(hub.peerCount("room-a"), 1, "the room was emptied by one peer leaving");
  b.close();
});

// ── the nickname ────────────────────────────────────────────────────────────
// ⚠ **It arrives from outside and is put in front of the other participant.**
// ⚠ **Two walls, and this is the first: ⚠ what may be a nickname at all.**
// ⚠ **The second is that the page shows it as text and never as markup** — ⚠ **either one alone
//   ⚠ is one mistake away from the other side of the screen.**

test("an ordinary nickname is accepted", () => {
  for (const ok of ["ふつうの名前", "a", "Ann", "x".repeat(MAX_NICKNAME_CHARS)]) {
    assert.equal(isNickname(ok), true, ok);
  }
});

test("⚠ an empty or over-long nickname is refused", () => {
  // ⚠ Long is not a style question: it is a way to push text at somebody who cannot refuse it.
  for (const bad of ["", "   ", "x".repeat(MAX_NICKNAME_CHARS + 1)]) {
    assert.equal(isNickname(bad), false, JSON.stringify(bad));
  }
});

test("⚠⚠ control and format characters are refused, not stripped", () => {
  // ⚠ Stripping changes what somebody typed and then shows it to a third party as though they
  //   ⚠ had typed that. ⚠ Refusing says no to the sender instead of lying to the receiver.
  const bad = [
    `tab${String.fromCharCode(0x09)}here`,
    `nul${String.fromCharCode(0x00)}here`,
    `c1${String.fromCharCode(0x9b)}here`,
    // ⚠ The direction-overriding marks. ⚠ These can make a name read as something else
    //   ⚠ entirely, which is a way to lie about who is in the room.
    `rtl${String.fromCharCode(0x202e)}here`,
    `iso${String.fromCharCode(0x2066)}here`,
  ];
  for (const b of bad) assert.equal(isNickname(b), false, JSON.stringify(b));
});

test("⚠ a nickname that is not a string is refused", () => {
  for (const bad of [123, null, undefined, {}, ["a"]]) assert.equal(isNickname(bad), false);
});

test("⚠ hello carries a validated nickname, trimmed once", () => {
  // ⚠ Trimmed here so both sides see the same string, and a later comparison is not against
  //   ⚠ something that only looks the same.
  const parsed = parseClientMessage(JSON.stringify({ type: "hello", nickname: "  Ann  " }));
  assert.deepEqual(parsed, { ok: true, message: { type: "hello", nickname: "Ann" } });
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "hello", nickname: "" })), {
    ok: false,
    why: "malformed",
  });
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "hello" })), {
    ok: false,
    why: "malformed",
  });
});

// ── ⚠ how long a socket kept the room awake ─────────────────────────────────
//
// ⚠ **kagima is moving to Durable Objects** (`docs/adr/0015`). ⚠ **There, an accepted WebSocket
//   ⚠ keeps the object active for the whole time it is connected**
//   (⚠ Cloudflare の公開文書、⚠ 参照日 2026-09-05)。
// ⚠ **So the quantity to watch is not "how long people talked" — ⚠ it is "how long a room had a
//   ⚠ socket open".** ⚠ **Measuring it now, ⚠ on the version that exists, ⚠ means the port starts
//   ⚠ with a real number instead of an estimate.**
//
// ⚠⚠ **It is not the bill.** ⚠ **Requests, event handlers and non-hibernatable idle time add
//   ⚠ duration too.** ⚠ **This is the part the design controls, ⚠ and it is expected to be the
//   ⚠ main part** — ⚠ **"expected" is doing real work in that sentence.**

/** ⚠ **Reads exactly what would be written.** ⚠ The logger's only exit is `console.log`. */
const whileWatchingTheLog = async (run: () => Promise<void>): Promise<string[]> => {
  const said: string[] = [];
  const real = console.log;
  // biome-ignore lint/suspicious/noConsole: ⚠ the test reads the boundary the logger writes to
  console.log = (line: unknown) => said.push(String(line));
  try {
    await run();
  } finally {
    // biome-ignore lint/suspicious/noConsole: ⚠ put it back whatever happened
    console.log = real;
  }
  return said;
};

const settle = () => new Promise((r) => setTimeout(r, 30));

test("⚠⚠ a room's socket-open time is wall-clock, not the sum of its sockets", async () => {
  // ⚠⚠ **Two people for thirty minutes is thirty minutes of an awake object, ⚠ not sixty.**
  // ⚠ **Summing the sockets would double it, ⚠ and every plan built on that number would be
  //   ⚠ wrong by a factor of two.**
  const { base, hub } = await startSignaling();
  const room = "room-billing";

  const said = await whileWatchingTheLog(async () => {
    // ⚠⚠ **Shaped like a real call**: ⚠ the host opens first and waits, ⚠ the guest arrives
    //   ⚠ later, ⚠ and the host leaves first. ⚠ **The gap matters:** ⚠ with both opening at once,
    //   ⚠ "the room's span" and "the last socket's own life" are the same number, ⚠ and a
    //   ⚠ mutation that returns the wrong one walks straight past (⚠ it did).
    const host = await connect(base, room, issueJoinToken(room, SECRET, Date.now()));
    await new Promise((r) => setTimeout(r, 150));
    const guest = await connect(base, room, issueJoinToken(room, SECRET, Date.now()));
    assert.equal(hub.peerCount(room), 2);
    await new Promise((r) => setTimeout(r, 80));
    host.close();
    await settle();
    guest.close();
    await settle();
  });

  // ⚠ Scoped to this room. ⚠ Another case's socket closing inside the capture window is not
  //   ⚠ this case's measurement.
  const total = said.find((l) => l.includes("a room stopped holding sockets") && l.includes(room));
  assert.ok(total !== undefined, `no room total was announced:\n${said.join("\n")}`);
  const fields = JSON.parse(total.slice(total.indexOf("{"))) as {
    socketOpenMs: number;
    roomId: string;
  };
  assert.equal(fields.roomId, room);

  const perSocket = said
    .filter((l) => l.includes("a peer left") && l.includes(room))
    .map((l) => (JSON.parse(l.slice(l.indexOf("{"))) as { heldMs: number }).heldMs);
  assert.equal(perSocket.length, 2, `two sockets should have left:\n${said.join("\n")}`);

  // ⚠⚠ **The assertion.** ⚠ The room's number is not the sum, ⚠ because the sockets overlapped.
  const summed = perSocket.reduce((x, y) => x + y, 0);
  assert.ok(
    summed > fields.socketOpenMs,
    `the sockets did not overlap, so this case is not testing what it claims: ` +
      `summed=${summed} room=${fields.socketOpenMs}`,
  );
  // ⚠ And the room's number covers the whole span, ⚠ not just the last socket's life.
  assert.ok(
    fields.socketOpenMs >= Math.max(...perSocket),
    `the room's time is shorter than a socket that was in it: ${JSON.stringify({ fields, perSocket })}`,
  );
});

test("⚠ the announced duration never carries anything but the room and the time", async () => {
  // ⚠ A measurement line is still a log line (`.claude/rules/security.md` § 2).
  const { base } = await startSignaling();
  const room = "room-quiet";
  const said = await whileWatchingTheLog(async () => {
    const a = await connect(base, room, issueJoinToken(room, SECRET, Date.now()));
    a.close();
    await settle();
  });
  const total = said.find((l) => l.includes("a room stopped holding sockets") && l.includes(room));
  assert.ok(total !== undefined, said.join("\n"));
  const fields = JSON.parse(total.slice(total.indexOf("{"))) as Record<string, unknown>;
  assert.deepEqual(Object.keys(fields).sort(), ["roomId", "socketOpenMs"]);
});
