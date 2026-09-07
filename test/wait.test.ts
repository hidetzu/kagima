// ⚠⚠ **The waiting socket, ⚠ and the one thing it must never do** (`docs/adr/0028`).
//
// ⚠ **It replaced `GET /api/rooms/{roomId}/knock/{knockId}`, ⚠ which was read every two
//   ⚠ seconds** (kagima#78) ⚠ **and put the knock id in a path we do not control the logs of**
//   (kagima#99).
//
// ⚠ **What has to hold: ⚠ four different things must look like one thing from outside**
//   (`.claude/rules/security.md` § 3):
//
// ```text
// ⚠ a room that does not exist
// ⚠ a Host who has not answered
// ⚠ a knock dropped because too many were waiting
// ⚠ a watcher dropped because too many were watching
// ```
//
// ⚠ **All four are "the socket is open and nothing has been said".**
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createKnocks, type Knocks, MAX_WAITING, MAX_WATCHING } from "../src/knock/knocks.ts";
import { CLOSE_KNOCK_DECIDED, openWait, roomIdFromWaitPath } from "../src/knock/wait.ts";
import { codeOf } from "./source-text.ts";

/** ⚠ **Everything one socket was told.** ⚠ **The whole assertion is usually that it is empty.** */
const aSocket = () => {
  const said: string[] = [];
  const closed: number[] = [];
  return {
    said,
    closed,
    as: {
      send: (line: string) => void said.push(line),
      close: (code?: number) => void closed.push(code ?? 0),
    },
  };
};

const doorFor = (
  rooms: readonly string[],
  over: Partial<Parameters<typeof createKnocks>[0]> = {},
) => {
  let n = 0;
  return createKnocks({
    newId: () => {
      n += 1;
      return `knock-${n}`;
    },
    roomExists: (id) => rooms.includes(id),
    ...over,
  });
};

// ── ⚠⚠ the four that must look like one ─────────────────────────────────────

/** ⚠ **What a Guest sees while waiting: ⚠ nothing at all.** */
const sawNothing = (socket: ReturnType<typeof aSocket>, why: string): void => {
  assert.deepEqual(socket.said, [], `${why}: something was said`);
  assert.deepEqual(socket.closed, [], `${why}: the socket was closed`);
};

test("⚠⚠ a room that does not exist and a Host who has not answered are one behaviour", () => {
  const knocks = doorFor(["a-real-room"]);
  const real = knocks.knock("a-real-room", "みどり", 1);

  const waiting = aSocket();
  const nowhere = aSocket();
  const invented = aSocket();

  openWait(knocks, "a-real-room", real.id, waiting.as);
  openWait(knocks, "a-room-that-was-never-minted", "knock-1", nowhere.as);
  openWait(knocks, "a-real-room", "an-id-nobody-minted", invented.as);

  sawNothing(waiting, "a real knock nobody has answered");
  sawNothing(nowhere, "a room that does not exist");
  sawNothing(invented, "an invented knock id");
});

test("⚠⚠ a knock dropped at the cap waits exactly like one that was taken", () => {
  const knocks = doorFor(["a-real-room"]);
  for (let i = 0; i < MAX_WAITING; i += 1) knocks.knock("a-real-room", "みどり", 1);
  const dropped = knocks.knock("a-real-room", "あお", 1);
  assert.equal(dropped.refused, "too-many-waiting", "the cap did not drop it");

  const socket = aSocket();
  openWait(knocks, "a-real-room", dropped.id, socket.as);
  sawNothing(socket, "a knock dropped at the cap");
});

test("⚠⚠ a watcher over the cap is counted, ⚠ and looks like every other wait", () => {
  const knocks = doorFor(["a-real-room"]);
  const mine = knocks.knock("a-real-room", "みどり", 1);

  const refusals: (string | null)[] = [];
  for (let i = 0; i < MAX_WATCHING; i += 1) {
    refusals.push(openWait(knocks, "a-real-room", `filler-${i}`, aSocket().as).refused);
  }
  const overflowing = aSocket();
  const over = openWait(knocks, "a-real-room", mine.id, overflowing.as);

  assert.deepEqual(refusals, new Array(MAX_WATCHING).fill(null), "the cap bit too early");
  // ⚠ Counted, ⚠ because an uncounted rejection is indistinguishable from a request that never
  //   ⚠ arrived (`.claude/rules/evidence.md`).
  assert.equal(over.refused, "too-many-watching");
  // ⚠⚠ And never shown.
  sawNothing(overflowing, "a watcher over the cap");
});

test("⚠⚠ the Host deciding is the only thing that ever reaches the socket", () => {
  const knocks = doorFor(["a-real-room"]);
  const mine = knocks.knock("a-real-room", "みどり", 1);
  const socket = aSocket();
  openWait(knocks, "a-real-room", mine.id, socket.as);

  knocks.decide("a-real-room", mine.id, true, "a-real-looking-token");

  assert.deepEqual(socket.said, ['{"state":"admitted","token":"a-real-looking-token"}']);
  assert.deepEqual(socket.closed, [CLOSE_KNOCK_DECIDED]);
});

test("⚠ refused, and the room ending while waiting, are one word", () => {
  const knocks = doorFor(["a-real-room"]);
  const refused = knocks.knock("a-real-room", "みどり", 1);
  const stranded = knocks.knock("a-real-room", "あお", 1);
  const a = aSocket();
  const b = aSocket();
  openWait(knocks, "a-real-room", refused.id, a.as);
  openWait(knocks, "a-real-room", stranded.id, b.as);

  knocks.decide("a-real-room", refused.id, false, null);
  knocks.endRoom("a-real-room");

  assert.deepEqual(a.said, ['{"state":"over"}']);
  assert.deepEqual(b.said, ['{"state":"over"}'], "ending the room said something else");
});

test("⚠⚠ a room ending never reaches a watcher on an id that room never had", () => {
  // ⚠⚠ **This is the 80-bit URL still being the wall** (`src/knock/knocks.ts`).
  // ⚠ **Telling this socket `over` would say the URL was a real room.**
  const knocks = doorFor(["a-real-room"]);
  const stranger = aSocket();
  openWait(knocks, "a-real-room", "an-id-nobody-minted", stranger.as);

  knocks.endRoom("a-real-room");

  sawNothing(stranger, "a watcher on an id the room never had");
});

test("⚠⚠ a decision made before the socket arrived is not lost", () => {
  // ⚠ **The Host can press the button between the knock and the socket opening.**
  //   ⚠ **Waiting for an event that has been and gone is waiting for ever.**
  const knocks = doorFor(["a-real-room"]);
  const mine = knocks.knock("a-real-room", "みどり", 1);
  knocks.decide("a-real-room", mine.id, true, "a-real-looking-token");

  const late = aSocket();
  openWait(knocks, "a-real-room", mine.id, late.as);

  assert.deepEqual(late.said, ['{"state":"admitted","token":"a-real-looking-token"}']);
  assert.deepEqual(late.closed, [CLOSE_KNOCK_DECIDED]);
});

test("⚠ a socket that stopped watching is not told anything afterwards", () => {
  const knocks = doorFor(["a-real-room"]);
  const mine = knocks.knock("a-real-room", "みどり", 1);
  const gone = aSocket();
  const { stop } = openWait(knocks, "a-real-room", mine.id, gone.as);

  stop();
  knocks.decide("a-real-room", mine.id, true, "a-real-looking-token");

  sawNothing(gone, "a socket that had gone away");
});

// ── ⚠ coming back after the object slept ────────────────────────────────────

test("⚠⚠ a knock put back with its own id is the same knock, ⚠ not a second one", () => {
  // ⚠ **A hibernating object loses what it held** (`docs/adr/0028`), ⚠ **and the waiting socket
  //   ⚠ is what carries who it is.**
  const knocks: Knocks = doorFor(["a-real-room"]);
  const first = knocks.restore("a-real-room", "carried-on-the-socket", "みどり", 7);
  const again = knocks.restore("a-real-room", "carried-on-the-socket", "みどり", 7);

  assert.equal(first.refused, null);
  assert.equal(again.refused, null, "putting it back twice was refused");
  assert.deepEqual(
    knocks.waiting("a-real-room").map((k) => k.id),
    ["carried-on-the-socket"],
    "one person at the door became two",
  );
});

test("⚠ a knock cannot be put back into a room that is not there", () => {
  const knocks = doorFor([]);
  assert.equal(knocks.restore("a-room-that-is-gone", "x", "みどり", 1).refused, "no-such-room");
});

// ── ⚠ the path ──────────────────────────────────────────────────────────────

test("⚠ the waiting path names a room and never a knock", () => {
  assert.equal(roomIdFromWaitPath("/api/rooms/abcdefghij123456/wait"), "abcdefghij123456");
  assert.equal(roomIdFromWaitPath("/api/rooms/abcdefghij123456/wait?x=1"), "abcdefghij123456");
  assert.equal(roomIdFromWaitPath("/api/rooms/abcdefghij123456/signal"), null);
  // ⚠⚠ A knock id in the path is the thing kagima#99 is about. ⚠ There is no shape for one.
  assert.equal(roomIdFromWaitPath("/api/rooms/abcdefghij123456/wait/some-knock-id"), null);
});

// ── ⚠⚠ the wall kagima#99 leaves behind ─────────────────────────────────────

test("⚠⚠ no source builds a URL with a knock id in it", async () => {
  // ⚠ **Measured 2026-09-06: ⚠ Cloudflare's own log carried
  //   ⚠ `GET /api/rooms/{roomId}/knock/{knockId}`.** ⚠ **kagima never wrote that line** —
  //   ⚠ **the id was in the path, ⚠ so the path is what was recorded** (kagima#99).
  // ⚠ **Comments are stripped first** (`CLAUDE.md` § 5): ⚠ this file and the sources describe
  //   ⚠ the very shape being forbidden, ⚠ and a check that trips over the description is
  //   ⚠ checking the wrong thing.
  const files = [
    "src/server.ts",
    "src/client/guest.ts",
    "src/knock/wait.ts",
    "src/signaling/protocol.ts",
    "src/worker.ts",
    "src/room-object.ts",
    "public/room.html",
  ];
  for (const file of files) {
    const code = codeOf(await readFile(file, "utf8"));
    // ⚠ A knock segment with something after it, ⚠ inside a rooms path. ⚠ The backslashes are
    //   ⚠ optional so an escaped regex literal is caught too — ⚠ the removed endpoint was one.
    //   ⚠⚠ `./knock/knocks.ts` is an import, ⚠ not a URL, ⚠ and `api/rooms/` is what tells
    //   ⚠ them apart: ⚠ the first version of this check matched the import and could not pass.
    assert.doesNotMatch(
      code,
      /api\\?\/rooms\\?\/[^"'\s]*knock\\?\//,
      `${file} puts a knock id in a path`,
    );
  }
});
