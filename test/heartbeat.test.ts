// ⚠⚠ **The heartbeat, ⚠ which is a message now** (`docs/adr/0020`, kagima#62).
//
// ⚠ **A Worker's server-side WebSocket has no `ping`** (⚠ measured 2026-09-06, `docs/adr/0015`).
// ⚠ **So the frame the browser used to answer by itself is gone, ⚠ and what answers now is the
//   ⚠ page** (`src/client/transport.ts`).
//
// ⚠ **That changes what is measured** — ⚠ **from "the socket is alive" to "the page is running"**
//   — ⚠ **and it closes MORE sockets, ⚠ not fewer.**
// ⚠ **So it ran in shadow first.** ⚠ **Measured on 2026-09-06, ⚠ a desktop tab hidden for 453s:**
//
// ```text
// ⚠ pings sent      26
// ⚠ pongs answered  26      ⚠⚠ every one
// ⚠ had it stopped answering while hidden, ⚠ the count would have been about 4
// ```
//
// ⚠ **kagima's pong is not on a timer** — ⚠ **it is sent when a ping arrives.**
// ⚠ **A hidden tab throttles timers; ⚠ delivering a message is a different thing.**
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHub } from "../src/signaling/hub.ts";
import { parseClientMessage } from "../src/signaling/messages.ts";
import { CLOSE_SILENT, pingLine } from "../src/signaling/protocol.ts";
import { createSessions, MISSED_PONGS_ALLOWED } from "../src/signaling/session.ts";
import type { SignalingSocket, SocketHandlers } from "../src/signaling/socket.ts";

const ROOM = "abcdefghij123456";

const fakeSocket = () => {
  let handlers: SocketHandlers | undefined;
  const sent: string[] = [];
  const closes: Array<{ code: number }> = [];
  const socket: SignalingSocket = {
    send: (line) => void sent.push(line),
    close: (code) => void closes.push({ code }),
    on: (h) => {
      handlers = h;
    },
  };
  return {
    socket,
    sent,
    closes,
    say: (line: string) => handlers?.onText(line),
    /** ⚠ **Answers the number that was sent.** ⚠ An older echo is not an answer. */
    pong: (n: number) => handlers?.onText(JSON.stringify({ type: "pong", n })),
    /** ⚠ **The socket went.** ⚠ **Whether it was closed or simply died is not this side's to know.** */
    hangUp: () => handlers?.onClose(),
  };
};

/**
 * ⚠ Time is injected. ⚠ A check that waits out a real heartbeat is a check nobody runs.
 *
 * ⚠⚠ **`clearInterval` is honoured.** ⚠ **The first version ignored it, ⚠ so a socket that the
 * code closes once was closed on every later beat** — ⚠ **and the case read that as "it closed
 * twice", ⚠ which is a fact about the harness and not about kagima.**
 */
const withBeats = <T>(body: (beat: () => void) => T): T => {
  const beats = new Map<number, () => void>();
  let next = 1;
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  globalThis.setInterval = ((fn: () => void) => {
    const id = next++;
    beats.set(id, fn);
    return { unref: () => {}, id } as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle: { id?: number }) => {
    if (handle?.id !== undefined) beats.delete(handle.id);
  }) as typeof clearInterval;
  try {
    return body(() => {
      for (const b of [...beats.values()]) b();
    });
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
};

const numberOf = (line: string): number => (JSON.parse(line) as { n: number }).n;

test("⚠ each beat sends a ping, and every ping has a new number", () => {
  withBeats((beat) => {
    const sessions = createSessions({ hub: createHub(), secret: "s" });
    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");

    beat();
    beat();

    assert.deepEqual(a.sent.map(numberOf), [1, 2], "the pings do not carry rising numbers");
  });
});

test("⚠⚠ a page that answers stays, ⚠ however many beats pass", () => {
  withBeats((beat) => {
    const sessions = createSessions({ hub: createHub(), secret: "s" });
    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");

    for (let i = 0; i < MISSED_PONGS_ALLOWED + 5; i++) {
      beat();
      a.pong(numberOf(a.sent[a.sent.length - 1] as string));
    }

    assert.deepEqual(a.closes, [], "a socket that answered every ping was hung up on");
  });
});

test("⚠⚠ a page that stops answering is closed, ⚠ and it is called silent", () => {
  // ⚠⚠ **The whole point** (`docs/adr/0020`). ⚠ **Nobody answers, ⚠ so nobody is there** —
  //   ⚠ **and a timer expiring is the absence of an answer, ⚠ not an answer**
  //   (`.claude/rules/evidence.md`). ⚠ **So the code says "silent", ⚠ never "left".**
  withBeats((beat) => {
    const sessions = createSessions({ hub: createHub(), secret: "s" });
    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");

    for (let i = 0; i <= MISSED_PONGS_ALLOWED + 1; i++) beat();

    assert.deepEqual(
      a.closes.map((c) => c.code),
      [CLOSE_SILENT],
      "a socket that answered nothing at all stayed open",
    );
  });
});

test("⚠⚠ answering, ⚠ then stopping, ⚠ is noticed", () => {
  // ⚠ **The shape a real page takes when it goes away** — ⚠ **not silent from the start.**
  withBeats((beat) => {
    const sessions = createSessions({ hub: createHub(), secret: "s" });
    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");

    for (let i = 0; i < 5; i++) {
      beat();
      a.pong(numberOf(a.sent[a.sent.length - 1] as string));
    }
    assert.equal(a.closes.length, 0, "it was hung up on while answering");

    for (let i = 0; i <= MISSED_PONGS_ALLOWED + 1; i++) beat();
    assert.deepEqual(
      a.closes.map((c) => c.code),
      [CLOSE_SILENT],
      "it stopped and nobody noticed",
    );
  });
});

test("⚠⚠ a pong that echoes nothing we sent does not count as an answer", () => {
  // ⚠⚠ **Without the number, ⚠ a page could answer pings it never received** — ⚠ **and the
  //   ⚠ heartbeat would say "running" about a page that took delivery of nothing.**
  // ⚠ **The number is what makes "valid" mean anything.**
  const parsed = parseClientMessage(JSON.stringify({ type: "pong", n: 7 }));
  assert.equal(parsed.ok && parsed.message.type, "pong");

  for (const bad of [
    { type: "pong" },
    { type: "pong", n: "7" },
    { type: "pong", n: -1 },
    { type: "pong", n: 1.5 },
  ]) {
    const r = parseClientMessage(JSON.stringify(bad));
    assert.equal(r.ok, false, `${JSON.stringify(bad)} was accepted as a pong`);
  }
});

test("⚠⚠ an echo of an older ping is not an answer", () => {
  // ⚠⚠ **"valid pong" has to mean something.** ⚠ **A page that echoes a number it saw a minute
  //   ⚠ ago is telling us where it was, ⚠ not that it is here** — ⚠ **and a page that answers
  //   ⚠ pings it never received is telling us nothing at all.**
  //
  // ⚠ **The first version of this case only checked that the number moved.** ⚠ **A mutation that
  //   ⚠ accepted ANY pong walked straight past it, ⚠ because nothing turned on the number.**
  withBeats((beat) => {
    const sessions = createSessions({ hub: createHub(), secret: "s" });
    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");

    beat();
    const stale = numberOf(a.sent[0] as string);

    // ⚠ Keeps echoing the first number, ⚠ every beat, ⚠ for ever.
    for (let i = 0; i <= MISSED_PONGS_ALLOWED + 1; i++) {
      beat();
      a.pong(stale);
    }

    assert.deepEqual(
      a.closes.map((c) => c.code),
      [CLOSE_SILENT],
      "a page echoing an old number was treated as present",
    );
  });
});

test("⚠ a pong we never asked for is not an answer either", () => {
  withBeats((beat) => {
    const sessions = createSessions({ hub: createHub(), secret: "s" });
    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");

    for (let i = 0; i <= MISSED_PONGS_ALLOWED + 1; i++) {
      beat();
      // ⚠ A number we have not sent. ⚠ Answering ahead is not answering.
      a.pong(9999);
    }

    assert.deepEqual(
      a.closes.map((c) => c.code),
      [CLOSE_SILENT],
      "a pong for a ping we never sent was accepted",
    );
  });
});

test("⚠ a pong is never relayed, and is never answered", () => {
  withBeats((beat) => {
    const hub = createHub();
    const sessions = createSessions({ hub, secret: "s" });
    const a = fakeSocket();
    const b = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");
    sessions.open(b.socket, ROOM, "sb");

    beat();
    const sentToB = b.sent.length;
    a.say(JSON.stringify({ type: "pong", n: numberOf(a.sent[0] as string) }));

    assert.equal(b.sent.length, sentToB, "a pong was relayed to the other participant");
    assert.equal(a.sent.length, 1, "something was said back about a pong");
  });
});

test("⚠⚠ the shadow ended, ⚠ and what it left is held absent", async () => {
  // ⚠ **`CLAUDE.md` § 3 forbids two implementations of one question.** ⚠ **There were two, ⚠ for
  //   ⚠ as long as it took to measure** — ⚠ **the same shape `docs/adr/0011` used and `0014`
  //   ⚠ closed.** ⚠ **The end was written before the beginning, ⚠ and it has been reached.**
  const { readFile } = await import("node:fs/promises");
  const adr = await readFile(
    "docs/adr/0020-measure-the-message-heartbeat-in-shadow-before-trusting-it.md",
    "utf8",
  );

  // ⚠ The measurement that ended it, ⚠ and the numbers it turned on.
  assert.match(adr, /終わらせる条件/, "the ADR does not say what ended it");
  assert.match(adr, /kagima#62/, "the ADR does not name the measurement");
  assert.match(adr, /26/, "the ADR does not carry the number it decided on");

  // ⚠⚠ And the retirement is not a promise: ⚠ `docs-check` reads this list and looks for it in
  //   ⚠ the source. ⚠ Without the list, ⚠ "protocol ping is gone" is only a sentence.
  assert.match(adr, /socket\.ping/, "the ADR does not list what was retired");

  // ⚠ The seam really did shrink. ⚠ This is the claim the port rests on (`docs/adr/0015`).
  const socket = await readFile("src/signaling/socket.ts", "utf8");
  assert.doesNotMatch(socket, /readonly ping/, "the seam still carries a protocol ping");
  assert.doesNotMatch(socket, /onPong/, "the seam still carries a protocol pong");
});

// ⚠⚠ **The same beat says how long this room has been held** (`docs/adr/0031`).
//
// ⚠ **The budget is arithmetic in `src/quota/ledger.ts`, ⚠ and it is checked there.**
// ⚠ **What is checked here is that anything is ever handed to it** — ⚠ **a budget wired to
//   ⚠ nothing counts zero for ever, ⚠ and every sum in it stays right while it does.**

test("⚠⚠ the beat says how long the room has been held, and the close closes the span", () => {
  withBeats((beat) => {
    const said: Array<[string, number, boolean]> = [];
    let clock = 1_000;
    const sessions = createSessions({
      hub: createHub(),
      secret: "s",
      now: () => clock,
      usedSoFar: (roomId, ms, stillHolding) => void said.push([roomId, ms, stillHolding]),
    });
    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");

    clock += 5_000;
    beat();
    assert.deepEqual(said, [[ROOM, 5_000, true]], "the beat said nothing about the room's span");

    // ⚠ 2 人目が来ても、⚠ 部屋の span は 1 つである ― ⚠ socket の合計ではない (`docs/adr/0022`)。
    const b = fakeSocket();
    sessions.open(b.socket, ROOM, "sb");
    clock += 5_000;
    beat();
    assert.deepEqual(
      said.slice(1),
      [
        [ROOM, 10_000, true],
        [ROOM, 10_000, true],
      ],
      "two sockets made the room's span count twice",
    );

    said.length = 0;
    clock += 1_000;
    a.hangUp();
    assert.deepEqual(said, [], "the span was closed while somebody was still in the room");

    clock += 1_000;
    b.hangUp();
    assert.deepEqual(
      said,
      [[ROOM, 12_000, false]],
      "the last socket leaving did not close the room's span",
    );
  });
});

test("⚠ a room that is held again starts a new span, and the first is not repeated", () => {
  // ⚠⚠ **The total is the room's, ⚠ and it is kept by whoever is counting**
  //   (`src/room-object.ts` adds the spans up). ⚠ **What this side reports is one span.**
  withBeats((beat) => {
    const said: Array<[string, number, boolean]> = [];
    let clock = 0;
    const sessions = createSessions({
      hub: createHub(),
      secret: "s",
      now: () => clock,
      usedSoFar: (roomId, ms, stillHolding) => void said.push([roomId, ms, stillHolding]),
    });

    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");
    clock += 3_000;
    a.hangUp();

    const b = fakeSocket();
    sessions.open(b.socket, ROOM, "sb");
    clock += 4_000;
    beat();

    assert.deepEqual(said, [
      [ROOM, 3_000, false],
      [ROOM, 4_000, true],
    ]);
  });
});
