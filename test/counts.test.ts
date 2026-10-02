// ⚠⚠ **その日ぶんの数** (`docs/adr/0032`)。
//
// ⚠ **Durable Object が買うのは「1 度に 1 呼び出し」であって、⚠ 足し算が合っていることではない。**
// ⚠ **so 足し算は ここで、⚠ object 無しで 確かめる**(`test/ledger.test.ts` と同じ理由)。
import assert from "node:assert/strict";
import test from "node:test";
import {
  type Counts,
  dayLine,
  LONG_MS,
  NO_COUNTS,
  readFacts,
  type RoomFacts,
  roomMade,
  roomOver,
  SHORT_MS,
  writeFacts,
} from "../src/quota/counts.ts";

const made = (over: Partial<RoomFacts> = {}): RoomFacts => ({
  bothHere: true,
  heldMs: 10 * 60 * 1000,
  ending: "closed",
  ...over,
});

test("⚠ 分母は 作られた時点で増える ― ⚠ 使われなくても 作られている", () => {
  const counts = roomMade(roomMade(NO_COUNTS));
  assert.equal(counts.rooms, 2);
  // ⚠ まだ 1 つも終わっていない。⚠ 終わった数を 作られた数で埋めない。
  assert.equal(counts.calls, 0);
  assert.equal(counts.closed + counts.left, 0);
});

test("⚠⚠ ノックだけで終わったルームと、⚠ 会話が始まったルームを 分ける", () => {
  let counts: Counts = roomMade(roomMade(NO_COUNTS));
  counts = roomOver(counts, made({ bothHere: true }));
  counts = roomOver(counts, made({ bothHere: false }));
  assert.equal(counts.rooms, 2);
  assert.equal(counts.calls, 1, "a room nobody joined was counted as a call");
});

test("⚠⚠ 区切りは コンセプトの言葉から 来ている ― ⚠ 5〜20 分", () => {
  // ⚠ `docs/PRODUCT.md` § 1: ⚠ 「誰かと 5〜20 分だけ」。
  //   ⚠ so 区切りは 分布のためではなく、⚠ その言葉が当たっているかを見るためである。
  let counts: Counts = NO_COUNTS;
  counts = roomOver(counts, made({ heldMs: SHORT_MS - 1 }));
  counts = roomOver(counts, made({ heldMs: SHORT_MS }));
  counts = roomOver(counts, made({ heldMs: LONG_MS }));
  counts = roomOver(counts, made({ heldMs: LONG_MS + 1 }));
  assert.deepEqual(
    { short: counts.short, middle: counts.middle, long: counts.long },
    { short: 1, middle: 2, long: 1 },
  );
  // ⚠ 端は 内側である ― ⚠ ちょうど 5 分 と ちょうど 20 分は「5〜20 分」である。
});

test("⚠ Host が閉じたのか、⚠ 誰も居なくなったのか を 分ける", () => {
  let counts: Counts = NO_COUNTS;
  counts = roomOver(counts, made({ ending: "closed" }));
  counts = roomOver(counts, made({ ending: "left" }));
  counts = roomOver(counts, made({ ending: "left" }));
  assert.deepEqual({ closed: counts.closed, left: counts.left }, { closed: 1, left: 2 });
});

test("⚠ 読めないものは 数えない ― ⚠ 確かめていないものを 確かめたことにしない", () => {
  assert.equal(readFacts(null), null);
  assert.equal(readFacts("closed"), null);
  assert.equal(readFacts({}), null);
  // ⚠ 欄が 1 つ欠けていたら 丸ごと捨てる ― ⚠ 欠けた欄を 埋めない。
  assert.equal(readFacts({ bothHere: true, heldMs: 1 }), null);
  assert.equal(readFacts({ bothHere: true, ending: "closed" }), null);
  assert.equal(readFacts({ heldMs: 1, ending: "closed" }), null);
  // ⚠ 知らない終わり方は 読まない。
  assert.equal(readFacts({ bothHere: true, heldMs: 1, ending: "exploded" }), null);
  // ⚠ 数でないもの、⚠ 負の時間。
  assert.equal(readFacts({ bothHere: true, heldMs: "1", ending: "closed" }), null);
  assert.equal(readFacts({ bothHere: true, heldMs: -1, ending: "closed" }), null);
  assert.equal(readFacts({ bothHere: true, heldMs: Number.NaN, ending: "closed" }), null);
  // ⚠ 読めるものは 読める。
  assert.deepEqual(readFacts({ bothHere: false, heldMs: 0, ending: "left" }), {
    bothHere: false,
    heldMs: 0,
    ending: "left",
  });
});

test("⚠⚠ 日が変わるときに残る行に、⚠ 数以外が 1 つも入らない", () => {
  // ⚠⚠ **`docs/adr/0032` 決定 4 の 中心である。** ⚠ **ルーム id も hash も 入らない** —
  //   ⚠ **入っていれば、⚠ 出たあとの行が 誰かについての記録になる**
  //   (`.claude/rules/security.md` § 2)。
  const line = dayLine("2026-10-03", roomOver(roomMade(NO_COUNTS), made()));
  assert.equal(line["day"], "2026-10-03");
  for (const [name, value] of Object.entries(line)) {
    if (name === "day") continue;
    assert.equal(typeof value, "number", `${name} is not a number, so it is not only a count`);
  }
  // ⚠ 割合は 出さない ― ⚠ 分母と一緒でなければ 数ではない (`.claude/rules/evidence.md`)。
  assert.deepEqual(
    Object.keys(line).filter((k) => /率|rate|percent|pct/i.test(k)),
    [],
  );
});

test("⚠⚠ 部屋が書いたものを、⚠ 台帳が 読める", () => {
  // ⚠⚠ **読む口は 無い**(⚠ 作れば それは 数を外に出す口になる)。
  //   ⚠ **so 通っていることを確かめる手は、⚠ 書いたものを 読んでみることだけである。**
  // ⚠ **`CLAUDE.md` § 3: ⚠ 同じ問いに 2 つの実装を置くなら、⚠ 機械的に突き合わせる。**
  for (const facts of [
    made(),
    made({ bothHere: false, ending: "left", heldMs: 0 }),
    made({ heldMs: LONG_MS + 1 }),
  ]) {
    assert.deepEqual(
      readFacts(JSON.parse(JSON.stringify(writeFacts(facts)))),
      facts,
      "what the room sends is not what the ledger reads",
    );
  }
});
