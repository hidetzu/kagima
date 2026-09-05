// ⚠⚠ **The one sentence a person reads.**
//
// ⚠ **This used to live twice, ⚠ once in each page, ⚠ where the fast tier could not see it.**
// ⚠ **The rules it is held to are `CLAUDE.md` § 4-1**, ⚠ **and kagima#16 made them bite:**
// ⚠ **v0.1.0 ships with STUN only, ⚠ so some pairs of networks never build a path** —
// ⚠ **and before this the screen said "つないでいます。" for ever.**
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { type Ending, guestStatus, hostStatus, outranks } from "../src/status/status.ts";

const ENDINGS: readonly Exclude<Ending, null>[] = [
  "closed",
  "room-full",
  "peer-left",
  "detached",
  "unreachable",
  "dropped",
];

const everySentence = (): string[] => [
  ...ENDINGS.map((ending) => hostStatus({ ending, connected: false, guestName: null })),
  ...ENDINGS.map((ending) => guestStatus({ ending, connected: false })),
];

// ── ⚠ the failure kagima#16 leaves in the product ───────────────────────────

test("⚠⚠ a path that could not be built is said, not left on the progressive", () => {
  // ⚠⚠ **The whole point.** ⚠ **"つないでいます。" reads as something happening right now, ⚠ so
  //   ⚠ somebody waits for what is not coming** (`CLAUDE.md` § 4-1).
  for (const said of [
    hostStatus({ ending: "unreachable", connected: false, guestName: "あん" }),
    guestStatus({ ending: "unreachable", connected: false }),
  ]) {
    assert.doesNotMatch(said, /つないでいます/, `still saying it is connecting: ${said}`);
    assert.match(said, /接続できませんでした/, said);
    // ⚠ Leaves a reason to come back, ⚠ rather than only naming the failure.
    assert.match(said, /もう一度|入り直/, `nothing to do next: ${said}`);
  }
});

test("⚠⚠ never connected and having connected are different sentences", () => {
  // ⚠ "接続できませんでした" after a ten-minute call is a lie about what happened.
  const never = guestStatus({ ending: "unreachable", connected: false });
  const had = guestStatus({ ending: "dropped", connected: true });
  assert.notEqual(never, had);
  assert.match(had, /途切れました/, had);
  assert.doesNotMatch(had, /接続できませんでした/, had);
});

test("⚠⚠ no sentence names a cause we cannot see", () => {
  // ⚠ `docs/adr/0012` stripped the instrument of exactly these guesses. ⚠ The screen is the
  //   ⚠ other place they would creep back in — ⚠ and it is the one a person believes.
  for (const said of everySentence()) {
    assert.doesNotMatch(said, /NAT|ファイアウォール|ルータ|IPv[46]|STUN|TURN/, said);
  }
});

test("⚠ no sentence blames the other side for our own gap", () => {
  // ⚠ `CLAUDE.md` § 4-1. ⚠ The reader's next move depends on which it is.
  for (const said of everySentence()) {
    assert.doesNotMatch(said, /相手が応答|返事がありません|相手のせい/, said);
  }
});

test("⚠⚠ an unreachable call is never reported as the room having ended", () => {
  // ⚠ `docs/adr/0010`: ⚠ `closed` means the room is over and its state is gone.
  //   ⚠ ⚠ Saying that when the room is fine tells somebody to give up on a room they can retry.
  for (const said of [
    hostStatus({ ending: "unreachable", connected: false, guestName: null }),
    guestStatus({ ending: "unreachable", connected: false }),
    guestStatus({ ending: "dropped", connected: true }),
  ]) {
    assert.doesNotMatch(said, /終わりました|閉じました|何も残っていません/, said);
  }
});

test("⚠ every ending has its own sentence, and no two are the same", () => {
  // ⚠ Two endings sharing a sentence is the same as collapsing them (`docs/adr/0010`).
  for (const status of [
    (e: Exclude<Ending, null>) => hostStatus({ ending: e, connected: false, guestName: null }),
    (e: Exclude<Ending, null>) => guestStatus({ ending: e, connected: false }),
  ]) {
    const said = ENDINGS.map(status);
    assert.equal(new Set(said).size, said.length, `two endings read the same: ${said.join(" / ")}`);
    for (const one of said) assert.notEqual(one.trim(), "", "an ending has no sentence");
  }
});

test("⚠⚠ a connection that was never admitted is not called a dropped one", () => {
  // ⚠⚠ **Measured on a real device** (kagima#40): ⚠ **a third person opened the shared URL, ⚠ was
  //   ⚠ refused with close 4002, ⚠ and was told "通話は続いているかもしれません。"**
  // ⚠ **It was not. ⚠ It never started.** ⚠ **Waiting does not help; ⚠ the room is full.**
  for (const said of [
    guestStatus({ ending: "room-full", connected: false }),
    hostStatus({ ending: "room-full", connected: false, guestName: null }),
  ]) {
    assert.match(said, /もう 2 人/, said);
    assert.doesNotMatch(said, /続いているかもしれません/, said);
    // ⚠ And it is not the room ending either.
    assert.doesNotMatch(said, /終わりました|閉じました/, said);
    // ⚠ It leaves a reason to come back: ⚠ the room may empty.
    assert.match(said, /もう一度/, said);
  }
  // ⚠ It outranks `detached`, ⚠ because a drop cannot mask never having been let in.
  assert.equal(outranks("room-full", "detached"), "room-full");
  assert.equal(outranks("detached", "room-full"), "room-full");
});

// ── ⚠ the screen must not say connected before a frame ──────────────────────

test("⚠⚠ neither page decides connected from a negotiation event", async () => {
  // ⚠⚠ **`track` fires when the transceiver is created — ⚠ before any media moves.**
  // ⚠ **The instrument was fixed for this reason** (kagima#37); ⚠ **the screen was not, ⚠ and the
  //   ⚠ screen is the half a person believes.**
  // ⚠ **A screen saying "つながりました。" with zero frames decoded is exactly the failure the
  //   ⚠ final gate exists to catch.**
  for (const page of ["public/index.html", "public/room.html"]) {
    const code = (await readFile(page, "utf8")).replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /addEventListener\("track"/,
      `${page} still decides connected from the track event`,
    );
    assert.match(code, /addEventListener\("loadeddata"/, `${page} waits for no frame at all`);
  }
});

test("⚠⚠ both pages listen before the camera prompt, and remember what arrived", async () => {
  // ⚠⚠ **Measured on a real device** (kagima#40): ⚠ **a refused join arrives ~5ms after the
  //   ⚠ socket opens, ⚠ while `getUserMedia` is still waiting for a person to tap "allow".**
  // ⚠ **Every listener attached after that misses it, ⚠ and the page carries on as though the
  //   ⚠ socket were alive.** ⚠ **The diagnostics then said `open throughout`** — ⚠ **which meant
  //   ⚠ "we never saw it close", ⚠ not "it stayed open".**
  // ⚠⚠ **Fake cameras grant instantly, ⚠ so no browser check could have found this.**
  //   ⚠ **This one is held in source, ⚠ by order.**
  for (const page of ["public/index.html", "public/room.html"]) {
    const code = (await readFile(page, "utf8")).replace(/^\s*\/\/.*$/gm, "");
    const listen = code.indexOf('socket.addEventListener("close"');
    const slow = code.indexOf("await createCall");
    assert.ok(listen >= 0, `${page} never listens for the socket closing`);
    assert.ok(slow >= 0, `${page} does not await createCall — this check needs rewriting`);
    assert.ok(
      listen < slow,
      `${page} listens for the close only after getUserMedia (${listen} > ${slow})`,
    );
    // ⚠ Moving the listener is half of it. ⚠ ⚠ The diagnostics is built after `createCall`, ⚠ so
    //   ⚠ a close that already happened has nobody to tell unless it was remembered.
    assert.match(code, /closedCode/, `${page} forwards the close but does not remember it`);
  }
});

// ── ⚠ precedence ────────────────────────────────────────────────────────────

test("⚠⚠ the room being over outranks everything that happened on the way there", () => {
  for (const other of ENDINGS) {
    assert.equal(outranks("closed", other), "closed");
    assert.equal(outranks(other, "closed"), "closed");
  }
});

test("⚠ an ending outranks nothing-yet, in both directions", () => {
  assert.equal(outranks(null, "unreachable"), "unreachable");
  assert.equal(outranks("unreachable", null), "unreachable");
  assert.equal(outranks(null, null), null);
});

test("⚠⚠ an ending is never talked over by a later connection", () => {
  // ⚠ CI caught this once already: ⚠ a `track` landing after "the other side left" re-rendered
  //   ⚠ "つながりました。" over it. ⚠ ⚠ `connected` must not reach the screen once an ending has.
  assert.match(
    hostStatus({ ending: "peer-left", connected: true, guestName: "あん" }),
    /切れました/,
  );
  assert.match(guestStatus({ ending: "unreachable", connected: true }), /接続できませんでした/);
});

// ── ⚠ the wiring ────────────────────────────────────────────────────────────

test("⚠⚠ both pages act on failed, and on nothing weaker", async () => {
  // ⚠ **The pure part above is only worth having if it is reached.**
  // ⚠ ⚠ `disconnected` recovers and must NOT produce an ending (`CLAUDE.md` § 4) — ⚠ reporting
  //   ⚠ it would end a call that nobody ended.
  for (const page of ["public/index.html", "public/room.html"]) {
    const code = (await readFile(page, "utf8")).replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /connectionstatechange/, `${page} never listens for the state`);
    assert.match(code, /connectionState !== "failed"/, `${page} does not act on failed`);
    assert.doesNotMatch(
      code,
      /connectionState === "disconnected"/,
      `${page} treats a recoverable drop as an ending`,
    );
  }
});

test("⚠ neither page decides the sentence for itself any more", async () => {
  // ⚠ `CLAUDE.md` § 3: ⚠ never keep two implementations that answer the same question.
  //   ⚠ ⚠ These two drifted once already.
  for (const page of ["public/index.html", "public/room.html"]) {
    const code = (await readFile(page, "utf8")).replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /ending === "closed"/, `${page} still decides its own wording`);
    assert.match(code, /(host|guest)Status\(/, `${page} does not use the one decision`);
  }
});
