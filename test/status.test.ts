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
