# 0014. kagima#16 が閉じたので、field-test mode を終了する

- 状態: **決定**
- 日付: 2026-09-05
- 決めた人: **Owner**
- 終了させるもの: [`0011`](0011-turn-on-a-field-test-mode-that-costs-two-promises-on-purpose.md)

## 文脈

⚠ **[`0011`](0011-turn-on-a-field-test-mode-that-costs-two-promises-on-purpose.md) は
「期限つき」と書かれた ADR である。**
⚠ **その本文が、⚠ 自分で終了条件を書いていた:**

> ⚠ **kagima#16 の実測が終わったら、残すかどうかを改めて決める。**
> ⚠ **「消し忘れたので残った」は理由ではない。**

⚠ **[kagima#16](https://github.com/hidetzu/kagima/issues/16) は閉じた**([`0013`](0013-ship-v0-1-0-with-stun-only-and-say-so-when-it-does-not-reach.md))。
⚠ **so 期限が来た。**

## 決定

⚠ **field-test mode を削除する。** ⚠ **フラグごと、経路ごと、ファイルごと。**

| 消したもの | ⚠ 何を取り戻したか |
|---|---|
| ⚠ **`KAGIMA_FIELD_TEST` そのもの** | ⚠ **合言葉を短くする経路が存在しない** |
| ⚠ **短い合言葉の生成器** | ⚠ **合言葉は 4 語だけである**([`0007`](0007-say-a-passphrase-in-four-words-chosen-to-be-heard-correctly.md)) |
| ⚠ **`/api/observations`(集約と読み出し)** | ⚠ **サーバは観測を持たない**([`0005`](0005-keep-room-state-in-process-memory-only.md)) |
| ⚠ **`/api/field-test`** | ⚠ **モードの有無を尋ねる先が無い** |
| ⚠ **ページからの自動送信** | ⚠ **ブラウザは kagima に何も送らない** |
| ⚠ **観測レポート専用の body 上限** | ⚠ **body の上限は 1 つに戻った** |

## 残したもの

⚠ **診断そのものは、⚠ 約束を何も削っていない。** ⚠ **so 残す。**

| 残したもの | ⚠ なぜ約束を削らないのか |
|---|---|
| 診断パネルとコピーボタン | ⚠ **端末の中だけで完結する。** ⚠ **どこにも送らない** |
| [`src/diagnostics/report.ts`](../../src/diagnostics/report.ts) | ⚠ **住所を出せない**([`0012`](0012-let-the-diagnostics-say-the-address-family-and-nothing-more.md))。⚠ 原因も名指さない |
| [`../FIELD-TEST.md`](../FIELD-TEST.md) | ⚠ **手順。** ⚠ **観測は手でコピーして貼る** — ⚠ 0011 の前と同じやり方に戻る |
| [`0011`](0011-turn-on-a-field-test-mode-that-costs-two-promises-on-purpose.md) と [`0012`](0012-let-the-diagnostics-say-the-address-family-and-nothing-more.md) | ⚠ **記録は消さない。** ⚠ **0011 は「終了した決定」として残る** |
| 診断の検査 | ⚠ **住所の壁も、⚠ 原因を名指さない壁も、⚠ そのまま効く** |

⚠ **`0011` を削除しないこと。** ⚠ **削除すると、⚠ 「約束を 2 つ削った期間があった」という事実が
消える。** ⚠ **ADR は決定の記録であって、⚠ 現在の設定ではない。**

## ⚠ 消えたことは、検査が確かめる

⚠ **「期限つき」と書いただけでは期限にならない。** ⚠ **期限が来たことに誰かが気づく必要があり、
⚠ その誰かは人であってはならない。**

⚠ **so 下の一覧は検査に読まれる。** ⚠ **どれか 1 つでも `src/` か `public/` に現れたら失敗する**
(`.claude/tools/docs-check.mjs` の case `retired-mechanism-is-absent`)。

```text
KAGIMA_FIELD_TEST
generateShortPassphrase
SHORT_ALPHABET
/api/field-test
/api/observations
```

⚠ **e2e の `field-test-mode-is-gone` は、⚠ わざとフラグを立てて起動する。**
⚠ **「既定でオフ」を確かめても何も証明しない** — ⚠ **もともと既定はオフだった。**
⚠ **確かめるべきは、⚠ フラグが何もしないことである。**
⚠ **合言葉が 4 語のままであること、⚠ 2 つの経路が GET でも POST でも 404 であることを見る。**

## 却下した案

| 案 | ⚠ 却下の理由 |
|---|---|
| **残しておく(既定オフだから安全)** | ⚠ **`0011` が自分で禁じている。** ⚠ **「消し忘れたので残った」は理由ではない** |
| ⚠ **合言葉だけ戻し、観測集約は残す** | ⚠ **サーバが観測を保持することが [`0005`](0005-keep-room-state-in-process-memory-only.md) に触れる。** ⚠ **デバッグのためでも曲げない**([`../../.claude/rules/security.md`](../../.claude/rules/security.md) § 7) |
| **`0011` を削除する** | ⚠ **約束を削った期間があった事実が消える。** ⚠ **ADR は現在の設定ではない** |
| ⚠ **診断も一緒に消す** | ⚠ **診断は約束を削っていない。** ⚠ **消す理由が無く、⚠ 次の実測でまた要る** |
| **検査を書かず、消したことにする** | ⚠ **次に期限つきのものを作ったとき、⚠ 同じ約束が同じように守られない** |

## 影響

- ⚠ **次の実測では、⚠ 観測は両端で手でコピーする。**
  ⚠ **前回それで片側しか記録されなかったので、⚠ [`../FIELD-TEST.md`](../FIELD-TEST.md) は
  「両方揃っているか確かめる」を手順として持っている。**
- ⚠ **また集約が要るなら、⚠ そのとき改めて ADR を書く。**
  ⚠ **`0011` を復活させない** — ⚠ **同じ理由で同じものを作るなら、⚠ 同じ検討をもう一度する。**
