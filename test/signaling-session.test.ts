// ⚠⚠ **What one connected participant does, ⚠ with no socket library underneath.**
//
// ⚠ **`test/signaling.test.ts` opens real sockets against a real listener, ⚠ and that is the
//   ⚠ tier that shows the wiring works.** ⚠ **This is the other claim: ⚠ the rules, ⚠ which are
//   ⚠ the same on Node and in a Worker** (`docs/adr/0015`).
// ⚠ **A fake socket can be asked things a real one cannot** — ⚠ **"was a ping sent", ⚠ "what code
//   ⚠ did it close with", ⚠ "was the binary frame's content ever looked at".**
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHub } from "../src/signaling/hub.ts";
import { CLOSE_BAD_MESSAGE, CLOSE_ROOM_FULL, CLOSE_SILENT } from "../src/signaling/protocol.ts";
import { createSessions, MISSED_PONGS_ALLOWED } from "../src/signaling/session.ts";
import type { SignalingSocket, SocketHandlers } from "../src/signaling/socket.ts";

const ROOM = "abcdefghij123456";

/** ⚠ **A socket that records rather than transmits.** ⚠ Nothing here is a WebSocket. */
const fakeSocket = () => {
  let handlers: SocketHandlers | undefined;
  const sent: string[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  let pings = 0;

  const socket: SignalingSocket = {
    send: (line) => void sent.push(line),
    close: (code, reason) => void closes.push({ code, reason }),
    ping: () => {
      pings += 1;
    },
    on: (h) => {
      handlers = h;
    },
  };
  return {
    socket,
    sent,
    closes,
    pings: () => pings,
    text: (data: string) => handlers?.onText(data),
    binary: () => handlers?.onBinary(),
    pong: () => handlers?.onPong(),
    end: () => handlers?.onClose(),
  };
};

test("⚠ a third connection is hung up on, ⚠ and the room keeps the two it has", () => {
  const hub = createHub();
  const sessions = createSessions({ hub, secret: "s" });

  const a = fakeSocket();
  const b = fakeSocket();
  const c = fakeSocket();
  sessions.open(a.socket, ROOM, "sa");
  sessions.open(b.socket, ROOM, "sb");
  sessions.open(c.socket, ROOM, "sc");

  assert.deepEqual(c.closes, [
    { code: CLOSE_ROOM_FULL, reason: "the room already has two people in it" },
  ]);
  assert.equal(hub.peerCount(ROOM), 2);
});

test("⚠⚠ a binary frame is hung up on without its content being read", () => {
  // ⚠ **The fake cannot hand over bytes even if the session asked** — ⚠ `onBinary` takes nothing.
  //   ⚠ **That is the claim: ⚠ nothing a stranger sent as bytes is ever decoded.**
  const sessions = createSessions({ hub: createHub(), secret: "s" });
  const a = fakeSocket();
  sessions.open(a.socket, ROOM, "sa");

  a.binary();

  assert.deepEqual(a.closes, [{ code: CLOSE_BAD_MESSAGE, reason: "signalling is text" }]);
  assert.deepEqual(a.sent, [], "something was said back about a binary frame");
});

test("⚠ a message that does not parse is refused to its sender and to nobody else", () => {
  const hub = createHub();
  const sessions = createSessions({ hub, secret: "s" });
  const a = fakeSocket();
  const b = fakeSocket();
  sessions.open(a.socket, ROOM, "sa");
  sessions.open(b.socket, ROOM, "sb");

  a.text("{not json");

  assert.equal(a.sent.length, 1);
  assert.match(a.sent[0] ?? "", /"type":"refused"/);
  assert.deepEqual(b.sent, [], "the other participant was told about a malformed message");
});

test("⚠⚠ the heartbeat gives up on a silent socket, and says silent rather than left", () => {
  // ⚠ **A timer expiring is not an answer; ⚠ it is the absence of one**
  //   (`.claude/rules/evidence.md`).
  const beats: Array<() => void> = [];
  const realSetInterval = globalThis.setInterval;
  // ⚠ Time is injected rather than waited out. ⚠ A check that sleeps is a check nobody runs.
  globalThis.setInterval = ((fn: () => void) => {
    beats.push(fn);
    return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;

  try {
    const touched: string[] = [];
    const sessions = createSessions({
      hub: createHub(),
      secret: "s",
      touch: (id) => void touched.push(id),
    });
    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");

    const beat = beats[0];
    assert.ok(beat !== undefined, "no heartbeat was started");

    // ⚠ Answered every time: ⚠ it stays open however many beats pass.
    for (let i = 0; i < MISSED_PONGS_ALLOWED + 3; i++) {
      beat();
      a.pong();
    }
    assert.deepEqual(a.closes, [], "a socket that answered was hung up on");
    assert.ok(a.pings() > MISSED_PONGS_ALLOWED, "no pings were sent");
    assert.ok(touched.length > 0, "the room's idle clock was never pushed back");

    // ⚠ Then stops answering.
    for (let i = 0; i <= MISSED_PONGS_ALLOWED; i++) beat();
    assert.deepEqual(a.closes, [{ code: CLOSE_SILENT, reason: "no response to the heartbeat" }]);
  } finally {
    globalThis.setInterval = realSetInterval;
  }
});

test("⚠ a participant leaving tells whoever is still there, and does not end the room", () => {
  // ⚠ `docs/adr/0010`: ⚠ "the other side left" is recoverable and is NOT "the room ended".
  const hub = createHub();
  const sessions = createSessions({ hub, secret: "s" });
  const a = fakeSocket();
  const b = fakeSocket();
  sessions.open(a.socket, ROOM, "sa");
  sessions.open(b.socket, ROOM, "sb");

  a.end();

  assert.deepEqual(b.sent, [JSON.stringify({ type: "peer-left" })]);
  assert.deepEqual(b.closes, [], "the remaining participant was hung up on");
  assert.equal(hub.peerCount(ROOM), 1);
});

test("⚠⚠ the platform-free half is platform-free", async () => {
  // ⚠⚠ **This is the claim the whole split rests on** (`docs/adr/0015`).
  // ⚠ **`src/signaling/attach.ts` is the Node adapter and may reach for Node.**
  // ⚠ **These three may not** — ⚠ **a Worker replaces the adapter and no other file, ⚠ and an
  //   ⚠ import that only exists on Node would only be found there.**
  const { readFile } = await import("node:fs/promises");
  const { codeOf } = await import("./source-text.ts");

  const PLATFORM_FREE = [
    "src/signaling/authorize.ts",
    "src/signaling/session.ts",
    "src/signaling/socket.ts",
    "src/signaling/protocol.ts",
  ];

  const offenders: string[] = [];
  for (const file of PLATFORM_FREE) {
    const code = codeOf(await readFile(file, "utf8"));
    for (const [what, pattern] of [
      ["a node: module", /from\s+"node:/],
      ["the ws library", /from\s+"ws"/],
      ["Buffer", /\bBuffer\b/],
    ] as const) {
      if (pattern.test(code)) offenders.push(`${file}: ${what}`);
    }
  }
  assert.deepEqual(offenders, [], `the platform reached into: ${offenders.join(", ")}`);

  // ⚠ And the adapter is still the file that carries it — ⚠ otherwise this check is describing
  //   ⚠ a split that no longer exists.
  const adapter = codeOf(await readFile("src/signaling/attach.ts", "utf8"));
  assert.match(
    adapter,
    /from\s+"ws"/,
    "the adapter no longer wraps ws — this check has gone stale",
  );
});
