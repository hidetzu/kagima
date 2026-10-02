// ⚠⚠ **その日ぶんの数** (`docs/adr/0032`)。
//
// ⚠ **数えるのは ルームについてであって、⚠ 人についてではない。**
// ⚠ **ここには id も hash も 1 つも入らない** — ⚠ **入るのは 数だけである。**
// ⚠ **so 日が変わって ログに 1 行出たあと、⚠ その行は 誰についての記録でもない**
//   (`.claude/rules/security.md` § 2)。
//
// ## ⚠⚠ ここに無いもの、⚠ と その理由
//
// ⚠ **`docs/adr/0032` の表には、⚠ 画面共有・ポインタ・camera・mute も載っている。**
// ⚠⚠ **入れていない。** ⚠ **どれも ブラウザの中でしか起きず、⚠ サーバに言わせるには
//   ⚠ [`0033`](../../docs/adr/0033-share-a-screen-where-it-can-be-shared-and-point-over-a-data-channel.md)
//   ⚠ が 明示的に断ったことを ひっくり返す必要がある** — ⚠ **あの ADR は「シグナリングで送れば、
//   ⚠ kagima のサーバに『いつ画面を出し始めたか』という新しい事実を持たせることになる」と書いて、
//   ⚠ だから データチャネルにした。**
// ⚠ **約束を 1 枚でも削る変更は Owner のものである**(`CLAUDE.md` § 1)。
// ⚠ **so ここに在るのは、⚠ サーバが もともと知っていること だけである。**
//
// ⚠ **Pure on purpose.** ⚠ **時計も保存も触らない** — ⚠ **足し算が 合っていることが要るのであって、
//   ⚠ Durable Object は 要らない**(`./ledger.ts` と同じ理由)。

/**
 * ⚠⚠ **「5〜20 分」が 本当にそうなのかを見るための 区切り** (`docs/PRODUCT.md` § 1)。
 *
 * ⚠ **区切りは コンセプトの言葉から 取っている** — ⚠ **分布を見るための区切りではなく、
 * ⚠ 「5〜20 分だと言っていることが 当たっているか」を見るための区切りである。**
 * ⚠ **so 区切りを動かすときは、⚠ コンセプトが動いたときである。**
 */
export const SHORT_MS = 5 * 60 * 1000;
export const LONG_MS = 20 * 60 * 1000;

/**
 * ⚠ **ルームが どう終わったか。**
 *
 * ⚠ **`closed` は Host が閉じたこと。** ⚠ **`left` は 誰も居なくなって 時間切れになったこと** —
 * ⚠ **「途中で離れた」であって、⚠ 失敗ではない**(`CLAUDE.md` § 4-1)。
 */
export type Ending = "closed" | "left";

/** ⚠ **1 つのルームについて、⚠ 終わるときに 1 度だけ 分かること。** */
export type RoomFacts = {
  /** ⚠ **2 人が 同時に居た。** ⚠ **ノックだけで終わったルームと 分けるための 1 ビットである。** */
  readonly bothHere: boolean;
  readonly heldMs: number;
  readonly ending: Ending;
};

/**
 * ⚠⚠ **その日の数。** ⚠ **これで全部である。**
 *
 * ⚠ **どの数も「何ルームか」であり、⚠ 「誰が」は どこにも無い。**
 */
export type Counts = {
  /** ⚠ **分母。** ⚠ **割合を書くときは 必ずこれと一緒に書く**(`.claude/rules/evidence.md`)。 */
  readonly rooms: number;
  /** ⚠ **2 人が 同時に居たルーム。** ⚠ **入口が成立したか**(⚠ E1 と同じ問い)。 */
  readonly calls: number;
  /** ⚠ **5 分未満 / 5〜20 分 / 20 分超。** ⚠ **コンセプトの言葉で区切ってある。** */
  readonly short: number;
  readonly middle: number;
  readonly long: number;
  /** ⚠ **Host が閉じた / 誰も居なくなった。** */
  readonly closed: number;
  readonly left: number;
};

export const NO_COUNTS: Counts = {
  rooms: 0,
  calls: 0,
  short: 0,
  middle: 0,
  long: 0,
  closed: 0,
  left: 0,
};

/** ⚠ **ルームが 1 つ 作られた。** ⚠ **分母は ここで増える** — ⚠ **使われなくても 作られている。** */
export const roomMade = (counts: Counts): Counts => ({ ...counts, rooms: counts.rooms + 1 });

/**
 * ⚠ **ルームが 1 つ 終わった。**
 *
 * ⚠ **終わるときに 1 度だけ呼ばれる** — ⚠ **呼ばれなければ 数えない。**
 * ⚠ **数えられなかったルームは「終わらなかった」のではなく「数えられなかった」である**
 * ([`../../.claude/rules/evidence.md`](../../.claude/rules/evidence.md))。
 */
export const roomOver = (counts: Counts, facts: RoomFacts): Counts => ({
  ...counts,
  calls: counts.calls + (facts.bothHere ? 1 : 0),
  short: counts.short + (facts.heldMs < SHORT_MS ? 1 : 0),
  middle: counts.middle + (facts.heldMs >= SHORT_MS && facts.heldMs <= LONG_MS ? 1 : 0),
  long: counts.long + (facts.heldMs > LONG_MS ? 1 : 0),
  closed: counts.closed + (facts.ending === "closed" ? 1 : 0),
  left: counts.left + (facts.ending === "left" ? 1 : 0),
});

/**
 * ⚠⚠ **線の上を通る形。** ⚠ **書く側と 読む側が 同じものを見る**(`CLAUDE.md` § 3)。
 *
 * ⚠ **部屋が 終わるときに 1 度だけ送る。** ⚠ **読む口は 無い** — ⚠ **作れば それは 数を
 * 外に出す口になる。** ⚠ **so 通ることを確かめる手は、⚠ 書いたものを 読んでみることだけである。**
 */
export const writeFacts = (facts: RoomFacts): Record<string, unknown> => ({
  bothHere: facts.bothHere,
  heldMs: facts.heldMs,
  ending: facts.ending,
});

/**
 * ⚠ **届いたものが 読めるかどうか。** ⚠ **読めなければ 数えない。**
 *
 * ⚠ **我々自身の中から来るが、⚠ 形は確かめる** — ⚠ **確かめていないものを 確かめたことにしない。**
 */
export const readFacts = (said: unknown): RoomFacts | null => {
  if (typeof said !== "object" || said === null) return null;
  const facts = said as Record<string, unknown>;
  const { bothHere, heldMs, ending } = facts;
  if (typeof bothHere !== "boolean") return null;
  if (typeof heldMs !== "number" || !Number.isFinite(heldMs) || heldMs < 0) return null;
  if (ending !== "closed" && ending !== "left") return null;
  return { bothHere, heldMs, ending };
};

/**
 * ⚠⚠ **日が変わるときに、⚠ 1 行だけ 残すもの** (`docs/adr/0032` 決定 4)。
 *
 * ⚠ **数しか入らない。** ⚠ **ルーム id も、⚠ hash も、⚠ 誰についての何も 入らない。**
 * ⚠ **so これが出たあと 台帳は 0 から始まり、⚠ 出た行は 誰についての記録でもない。**
 *
 * ⚠ **割合は ここでは出さない。** ⚠ **分母と一緒でなければ 数ではなく、⚠ 読む側が
 * 分母を見ながら割るほうが、⚠ こちらが割って渡すより 間違えにくい**
 * (`.claude/rules/evidence.md`)。
 */
export const dayLine = (day: string, counts: Counts): Record<string, string | number> => ({
  day,
  ...counts,
});
