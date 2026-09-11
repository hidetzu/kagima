// ⚠⚠ **What one connected participant does, ⚠ with no socket library underneath.**
//
// ⚠ **`test/signaling.test.ts` opens real sockets against a real listener, ⚠ and that is the
//   ⚠ tier that shows the wiring works.** ⚠ **This is the other claim: ⚠ the rules, ⚠ which are
//   ⚠ the same on Node and in a Worker** (`docs/adr/0015`).
// ⚠ **A fake socket can be asked things a real one cannot** — ⚠ **"what was sent", ⚠ "what code
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

  const socket: SignalingSocket = {
    send: (line) => void sent.push(line),
    close: (code, reason) => void closes.push({ code, reason }),
    on: (h) => {
      handlers = h;
    },
  };
  return {
    socket,
    sent,
    closes,
    text: (data: string) => handlers?.onText(data),
    binary: () => handlers?.onBinary(),
    /** ⚠ **Answers the ping that was sent** (`docs/adr/0020`). ⚠ An older echo is not an answer. */
    pong: (line: string) =>
      handlers?.onText(JSON.stringify({ type: "pong", n: (JSON.parse(line) as { n: number }).n })),
    end: () => handlers?.onClose(),
  };
};

/**
 * ⚠⚠ **「相手が来た」は 数に入れない** (⚠ Owner 決定 2026-09-12)。
 *
 * ⚠ **`peer-here` は サーバが 部屋に居る人へ出す合図であり、⚠ 誰が何を言ったかとは別の話である。**
 * ⚠ **so 中身についての主張は これを外して数える** — ⚠ **外すのは この 1 種類だけであり、
 * ⚠ 「何も漏れていない」という主張は 弱まっていない。**
 */
const words = (sent: readonly string[]): string[] =>
  sent.filter((line) => !line.includes('"type":"peer-here"'));

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
  assert.deepEqual(words(a.sent), [], "something was said back about a binary frame");
});

test("⚠ a message that does not parse is refused to its sender and to nobody else", () => {
  const hub = createHub();
  const sessions = createSessions({ hub, secret: "s" });
  const a = fakeSocket();
  const b = fakeSocket();
  sessions.open(a.socket, ROOM, "sa");
  sessions.open(b.socket, ROOM, "sb");

  a.text("{not json");

  assert.equal(words(a.sent).length, 1);
  assert.match(words(a.sent)[0] ?? "", /"type":"refused"/);
  assert.deepEqual(words(b.sent), [], "the other participant was told about a malformed message");
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
      a.pong(a.sent[words(a.sent).length - 1] as string);
    }
    assert.deepEqual(a.closes, [], "a socket that answered was hung up on");
    assert.ok(words(a.sent).length > MISSED_PONGS_ALLOWED, "no pings were sent");
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

  assert.deepEqual(words(b.sent), [JSON.stringify({ type: "peer-left" })]);
  assert.deepEqual(b.closes, [], "the remaining participant was hung up on");
  assert.equal(hub.peerCount(ROOM), 1);
});

test("⚠⚠ the platform-free half is platform-free, ⚠ and so is everything it loads", async () => {
  // ⚠⚠ **This is the claim the whole split rests on** (`docs/adr/0015`).
  // ⚠ **`src/signaling/attach.ts` is the Node adapter and may reach for Node.**
  // ⚠ **These four may not** — ⚠ **a Worker replaces the adapter and no other file, ⚠ and an
  //   ⚠ import that only exists on Node would only be found there.**
  //
  // ⚠⚠ **Until 2026-09-06 this read the four files' own text and nothing else** (kagima#69).
  // ⚠ **`session.ts` imports `./messages.ts`, ⚠ which used `Buffer`** — ⚠ **one step away was
  //   ⚠ far enough to be invisible, ⚠ and the wall reported green the whole time.**
  // ⚠ **Now it follows what they load.**
  const { readFile } = await import("node:fs/promises");
  const { codeOf } = await import("./source-text.ts");
  const { reachableFrom } = await import("./reachable.ts");

  const ENTRIES = [
    "src/signaling/authorize.ts",
    "src/signaling/session.ts",
    "src/signaling/socket.ts",
    "src/signaling/protocol.ts",
    // ⚠⚠ **The routing itself** (`docs/adr/0015`, 移植 7/n). ⚠ **Node's listener moved out to
    //   ⚠ `src/node-server.ts`, ⚠ so this file stopped reading the environment at all.**
    "src/server.ts",
  ];
  const files = await reachableFrom(ENTRIES);
  // ⚠ The denominator, announced by the thing that measured it (`.claude/rules/evidence.md`).
  console.log(`  observed: ${files.length} files reachable from ${ENTRIES.length} entry points`);
  assert.ok(files.length > ENTRIES.length, "nothing was followed — this check has gone stale");

  const offenders: string[] = [];
  for (const file of files) {
    const code = codeOf(await readFile(file, "utf8"));
    for (const [what, pattern] of [
      ["a node: module", /from\s+"node:/],
      ["the ws library", /from\s+"ws"/],
      ["Buffer", /\bBuffer\b/],
      // ⚠ Node's own globals, ⚠ which a Worker does not have. ⚠ `process.env` is the one that
      //   ⚠ reads as harmless and is not.
      ["process", /\bprocess\s*\./],
    ] as const) {
      if (pattern.test(code)) offenders.push(`${file}: ${what}`);
    }
  }
  assert.deepEqual(offenders, [], `the platform reached into: ${offenders.join(", ")}`);

  // ⚠⚠ **And the dependency runs one way.** ⚠ **The core must never load the adapter** —
  //   ⚠ **if it did, ⚠ every file above would be reachable from Node's side and this whole
  //   ⚠ check would be describing a split that no longer exists.**
  for (const adapter of ["src/signaling/attach.ts", "src/node-server.ts"]) {
    assert.ok(!files.includes(adapter), `the platform-free half loads ${adapter}`);
  }

  // ⚠ And the adapter is still the file that carries it — ⚠ otherwise this describes nothing.
  const adapter = codeOf(await readFile("src/signaling/attach.ts", "utf8"));
  assert.match(
    adapter,
    /from\s+"ws"/,
    "the adapter no longer wraps ws — this check has gone stale",
  );
});

test("⚠⚠ the close of a socket a reconnect replaced is not announced as somebody leaving", () => {
  // ⚠⚠ **Measured 2026-09-07** (kagima#90, `docs/adr/0029`): ⚠ **a Guest whose page was thrown
  //   ⚠ away came back and said who it was, ⚠ and then the OLD socket closed and the Host was
  //   ⚠ told "the other side left"** — ⚠ **clearing the name it had just been given.**
  //
  // ⚠ **The person did not leave.** ⚠ **`src/signaling/hub.ts` already refuses to relay from a
  //   ⚠ replaced socket** (`stale`); ⚠ **its close was the half nobody had asked about.**
  // ⚠ **The way to check it is to reorder** (`.claude/skills/change-review/SKILL.md` § 4):
  //   ⚠ **join, ⚠ replace, ⚠ and only THEN close the one that was replaced.**
  const sessions = createSessions({ hub: createHub(), secret: "s" });
  const host = fakeSocket();
  const guestOld = fakeSocket();
  const guestNew = fakeSocket();

  sessions.open(host.socket, ROOM, "s-host", "host");
  sessions.open(guestOld.socket, ROOM, "s-guest");
  sessions.open(guestNew.socket, ROOM, "s-guest");

  const before = words(host.sent).length;
  guestOld.end();

  const said = host.sent.slice(before);
  assert.deepEqual(
    said.filter((line) => line.includes("peer-left")),
    [],
    `the Host was told somebody left when they had just come back: ${said.join(" ")}`,
  );

  // ⚠ And the real thing still works: ⚠ the connection that is actually there, leaving, is told.
  const nowAt = words(host.sent).length;
  guestNew.end();
  assert.deepEqual(
    host.sent.slice(nowAt).filter((line) => line.includes("peer-left")),
    [JSON.stringify({ type: "peer-left" })],
    "somebody actually leaving was not announced",
  );
});

test("⚠⚠ 後から来た人がいることを、⚠ 先に居た人に言う", () => {
  // ⚠⚠ **`peer-left` の裏返し** (⚠ Owner 決定 2026-09-12)。
  //   ⚠ **これが無いあいだ、⚠ Guest の画面は「相手の接続が切れました」のまま残った** —
  //   ⚠ **Host が戻ったことを Guest に伝える合図が 1 つも無かったからである**(⚠ 実機 2026-09-12)。
  const hub = createHub();
  const sessions = createSessions({ hub, secret: "s" });
  const first = fakeSocket();
  sessions.open(first.socket, ROOM, "s1");

  // ⚠ まだ誰も来ていない。⚠ 自分の到着を 自分に言わない。
  assert.deepEqual(
    first.sent.filter((l) => l.includes("peer-here")),
    [],
    "a peer was told about its own arrival",
  );

  const second = fakeSocket();
  sessions.open(second.socket, ROOM, "s2");

  assert.deepEqual(
    first.sent.filter((l) => l.includes("peer-here")),
    ['{"type":"peer-here"}'],
    "the one who was already there was not told somebody arrived",
  );
  // ⚠ 来た本人には 言わない ― ⚠ 自分が来たことは 自分が知っている。
  assert.deepEqual(
    second.sent.filter((l) => l.includes("peer-here")),
    [],
    "the arrival was echoed to whoever arrived",
  );
  // ⚠⚠ 誰が来たかは 言わない。⚠ 名前は 本人が `hello` で名乗る。
  assert.deepEqual(
    first.sent.filter((l) => l.includes("peer-here") && l.includes("nickname")),
    [],
    "the arrival carried who it was",
  );
});
