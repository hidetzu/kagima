// ⚠⚠ **The heartbeat that decides nothing, yet** (`docs/adr/0020`, kagima#62).
//
// ⚠ **A Worker's server-side WebSocket has no `ping`** (⚠ measured 2026-09-06, `docs/adr/0015`).
// ⚠ **So the heartbeat has to become a message.** ⚠ **Moving it changes what is measured** —
//   ⚠ **from "the socket is alive" to "the page is running"** — ⚠ **and that closes MORE sockets,
//   ⚠ ⚠ by an amount nobody has measured.**
//
// ⚠ **So it runs in shadow first: ⚠ it answers, ⚠ it counts, ⚠ and it closes nothing.**
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
  let pings = 0;
  const socket: SignalingSocket = {
    send: (line) => void sent.push(line),
    close: (code) => void closes.push({ code }),
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
    say: (line: string) => handlers?.onText(line),
    pong: () => handlers?.onPong(),
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

    const numbers = a.sent.map(numberOf);
    assert.deepEqual(numbers, [1, 2], "the pings do not carry rising numbers");
    // ⚠ And the real heartbeat is still the one being answered by the browser.
    assert.equal(a.pings(), 2, "the protocol ping stopped");
  });
});

test("⚠⚠ a page that never answers is NOT closed — it is only counted", () => {
  // ⚠⚠ **This is the whole point of the shadow** (`docs/adr/0020`).
  // ⚠ **The protocol ping is what closes a socket today.** ⚠ **Nobody is hung up on for a number
  //   ⚠ that has not been measured.**
  withBeats((beat) => {
    const sessions = createSessions({ hub: createHub(), secret: "s" });
    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");

    // ⚠ The protocol pong keeps arriving. ⚠ The message-shaped one never does.
    for (let i = 0; i < MISSED_PONGS_ALLOWED + 5; i++) {
      beat();
      a.pong();
    }

    assert.deepEqual(a.closes, [], "the shadow heartbeat closed a socket");
  });
});

test("⚠ the protocol heartbeat still closes a silent socket", () => {
  // ⚠ ⚠ The shadow must not have taken anything away either.
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

test("⚠⚠ only the number being waited on resets the count", () => {
  withBeats((beat) => {
    const sessions = createSessions({ hub: createHub(), secret: "s" });
    const a = fakeSocket();
    sessions.open(a.socket, ROOM, "sa");

    beat();
    const first = numberOf(a.sent[0] as string);

    // ⚠ An echo of a ping that is no longer the current one. ⚠ It says the page is behind,
    //   ⚠ not that it is here now.
    beat();
    a.say(JSON.stringify({ type: "pong", n: first }));

    // ⚠ Nothing observable happens either way — ⚠ so the claim is checked where it shows:
    //   ⚠ the current number is what an answer has to carry.
    const current = numberOf(a.sent[a.sent.length - 1] as string);
    assert.notEqual(current, first, "the ping number did not move");
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

test("⚠⚠ the shadow is written down as time-limited, with an end", async () => {
  // ⚠ **`CLAUDE.md` § 3 forbids two implementations of one question.** ⚠ **This is deliberately
  //   ⚠ two, ⚠ for as long as it takes to measure** — ⚠ **so the end is written before the
  //   ⚠ beginning, ⚠ the way `docs/adr/0011` was and `docs/adr/0014` closed it.**
  const { readFile } = await import("node:fs/promises");
  const adr = await readFile(
    "docs/adr/0020-measure-the-message-heartbeat-in-shadow-before-trusting-it.md",
    "utf8",
  );
  // ⚠ The claim, ⚠ not a marker string. ⚠ Asserting the marker would put the words
  //   ⚠ `retired-mechanism-is-absent` into the ADR, ⚠ and `docs-check` reads that as "this ADR
  //   ⚠ has already retired something" — ⚠ which it has not.
  assert.match(adr, /終わらせる条件/, "the ADR does not say what ends it");
  assert.match(adr, /kagima#62/, "the ADR does not name the measurement that ends it");
  assert.match(adr, /期限つき/, "the ADR does not say it is time-limited");
});
