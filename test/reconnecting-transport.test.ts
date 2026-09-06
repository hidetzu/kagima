// ⚠⚠ **The transport whose socket is replaced underneath it** (`src/client/reconnect.ts`).
//
// ⚠ **`createCall({ transport })` keeps the object it was handed.** ⚠ **If a reconnect produced a
//   ⚠ new object, the call would go on talking to a socket nobody is listening to** — ⚠ **and it
//   ⚠ would fail silently.** ⚠ **So identity is the claim, ⚠ and it is checked here.**
//
// ⚠ **No browser, ⚠ no server, ⚠ no waiting** — ⚠ **the socket and the clock are both injected.**
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SignalMessage } from "../src/client/call.ts";
import {
  connectReconnecting,
  FINAL_CLOSE_CODES,
  RETRY_DELAYS_MS,
} from "../src/client/reconnect.ts";
import type { SocketTransport } from "../src/client/transport.ts";
import {
  CLOSE_ROOM_CLOSED,
  CLOSE_ROOM_FULL,
  CLOSE_SILENT,
  CLOSE_UNAUTHORIZED,
} from "../src/signaling/protocol.ts";

/** ⚠ A socket that records, ⚠ and that can be closed with any code from the outside. */
const fake = () => {
  const sent: SignalMessage[] = [];
  const onMessage: Array<(m: SignalMessage) => void> = [];
  const onClose: Array<(e: { code: number }) => void> = [];
  let closedByUs = false;

  const transport = {
    sent,
    closedByUs: () => closedByUs,
    deliver: (m: SignalMessage) => {
      for (const h of onMessage) h(m);
    },
    dropWith: (code: number) => {
      for (const h of onClose) h({ code });
    },
    as: {
      socket: {
        addEventListener: (name: string, h: (e: { code: number }) => void) => {
          if (name === "close") onClose.push(h);
        },
      } as unknown as WebSocket,
      send: (m: SignalMessage) => void sent.push(m),
      onMessage: (h: (m: SignalMessage) => void) => void onMessage.push(h),
      close: () => {
        closedByUs = true;
      },
    } as SocketTransport,
  };
  return transport;
};

/** ⚠ A world where sockets are handed out in order and nothing waits. */
const world = (...sockets: ReturnType<typeof fake>[]) => {
  let handed = 0;
  const tokensAsked: number[] = [];
  const waits: number[] = [];
  return {
    tokensAsked,
    waits,
    handedOut: () => handed,
    options: {
      roomId: "abcdefghij123456",
      token: async () => {
        tokensAsked.push(Date.now());
        return `token-${tokensAsked.length}`;
      },
      wait: async (ms: number) => void waits.push(ms),
      connect: async () => {
        const next = sockets[handed++];
        if (next === undefined) throw new Error("no socket left");
        return next.as;
      },
    },
  };
};

test("⚠⚠ the object stays the same while the socket underneath is replaced", async () => {
  const first = fake();
  const second = fake();
  const w = world(first, second);

  const t = await connectReconnecting(w.options);
  const before = t;

  t.send({ type: "bye" });
  assert.deepEqual(first.sent, [{ type: "bye" }]);

  first.dropWith(1006);
  await new Promise((r) => setTimeout(r, 5));

  // ⚠⚠ The same object. ⚠ This is what `createCall` is holding.
  assert.equal(t, before, "the transport object was replaced");
  t.send({ type: "bye" });
  assert.deepEqual(second.sent, [{ type: "bye" }], "sending went to the socket that is gone");
  assert.deepEqual(first.sent.length, 1, "the old socket was written to after it closed");
});

test("⚠⚠ handlers registered once keep receiving across a reconnect", async () => {
  const first = fake();
  const second = fake();
  const w = world(first, second);

  const t = await connectReconnecting(w.options);
  const seen: SignalMessage[] = [];
  t.onMessage((m) => void seen.push(m));

  first.deliver({ type: "peer-left" });
  first.dropWith(1006);
  await new Promise((r) => setTimeout(r, 5));
  second.deliver({ type: "bye" });

  assert.deepEqual(seen, [{ type: "peer-left" }, { type: "bye" }], "a handler stopped hearing");
});

test("⚠ every attempt asks for a fresh token", async () => {
  // ⚠ A join token is short-lived. ⚠ Reusing the one that worked before the drop is exactly the
  //   ⚠ one that will not work now (`docs/adr/0018`).
  const first = fake();
  const second = fake();
  const w = world(first, second);

  await connectReconnecting(w.options);
  assert.equal(w.tokensAsked.length, 1);

  first.dropWith(1006);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(w.tokensAsked.length, 2, "the reconnect reused a token");
});

test("⚠⚠ a close that is an answer gives up at once, without retrying", async () => {
  const only = fake();
  const w = world(only);

  const t = await connectReconnecting(w.options);
  const gaveUp: number[] = [];
  t.onGaveUp((c) => void gaveUp.push(c));

  only.dropWith(4005);
  await new Promise((r) => setTimeout(r, 5));

  assert.deepEqual(gaveUp, [4005]);
  assert.deepEqual(w.waits, [], "it waited before giving up on an answer");
  assert.equal(w.handedOut(), 1, "it opened another socket for a room that is over");
});

test("⚠⚠ it gives up after the bound, and says the code it last saw", async () => {
  const only = fake();
  const w = world(only); // ⚠ ⚠ Every later `connect` throws: ⚠ nothing comes back.

  const t = await connectReconnecting({ ...w.options, delaysMs: [1, 2, 3] });
  const gaveUp: number[] = [];
  t.onGaveUp((c) => void gaveUp.push(c));

  only.dropWith(4004);
  await new Promise((r) => setTimeout(r, 20));

  assert.deepEqual(w.waits, [1, 2, 3], "the bound was not the list");
  assert.deepEqual(gaveUp, [4004], "it did not say what it last saw");
});

test("⚠ closing on purpose stops it, and says nothing", async () => {
  const only = fake();
  const w = world(only);

  const t = await connectReconnecting(w.options);
  const gaveUp: number[] = [];
  t.onGaveUp((c) => void gaveUp.push(c));

  t.close();
  only.dropWith(1006);
  await new Promise((r) => setTimeout(r, 5));

  assert.ok(only.closedByUs(), "the socket was left open");
  assert.deepEqual(gaveUp, [], "a deliberate close was reported as giving up");
  assert.deepEqual(w.waits, [], "it retried after being told to stop");
});

test("⚠⚠ a close that is an answer is never retried", () => {
  // ⚠ **Asking again cannot change any of these.** ⚠ **Retrying them is noise at best and a
  //   ⚠ hammer at worst** (`src/client/reconnect.ts`).
  for (const code of [CLOSE_UNAUTHORIZED, CLOSE_ROOM_FULL, CLOSE_ROOM_CLOSED, 1000]) {
    assert.ok(FINAL_CLOSE_CODES.includes(code), `${code} would be retried, and it is an answer`);
  }
  // ⚠⚠ And the one that MUST be retried — ⚠ the one kagima#62 will start producing.
  assert.ok(
    !FINAL_CLOSE_CODES.includes(CLOSE_SILENT),
    "a silent socket would never be reconnected, which is the whole point",
  );
});

test("⚠ retrying is bounded", () => {
  // ⚠ **An unbounded retry is an attack on us and on somebody's battery.**
  //   ⚠ The length of the list is the bound; ⚠ there is no other place a bound could hide.
  assert.ok(RETRY_DELAYS_MS.length > 0, "there is no retry at all");
  assert.ok(RETRY_DELAYS_MS.length <= 10, "the bound is not a bound");
  assert.ok(
    RETRY_DELAYS_MS.every((d) => d > 0),
    "a zero delay makes this a spin, not a retry",
  );
  console.log(
    `  observed: ${RETRY_DELAYS_MS.length} attempts over ${RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)}ms`,
  );
});
