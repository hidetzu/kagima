# 0022. Free で始める。⚠ 1 ルーム = 1 Durable Object に集約する

- 状態: **決定**
- 日付: 2026-09-06
- 決めた人: **Owner**
- 片付ける課題: [kagima#47](https://github.com/hidetzu/kagima/issues/47)
- 対象: ⚠ [`0015`](0015-put-the-service-on-cloudflare-after-three-things-are-settled.md) の 1 番目

## 文脈

⚠ **[`0015`](0015-put-the-service-on-cloudflare-after-three-things-are-settled.md) は、移植の前に
3 つ片付けると決めた。** ⚠ **これはその 1 番目である** — ⚠ **「継続的な running cost が発生する
構成」は Owner 判断だからである**([`../PRODUCT.md`](../PRODUCT.md) § 6)。

## ⚠ 単位 — ⚠ 通話時間を仮定しない

⚠ **出所: [Cloudflare Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)、
⚠ 参照日 2026-09-06。** ⚠ **これは Cloudflare が公開した値であって、⚠ kagima についての
測定ではない**([`../../.claude/rules/evidence.md`](../../.claude/rules/evidence.md))。

```text
⚠ 課金は 128 MB 固定  ("regardless of actual usage")
⚠ Cloudflare 自身が 128 MB / 1 GB = 0.128 として計算する
⚠ so 1 room-hour = 3600 s × 0.128 GB = ⚠⚠ 460.8 GB-s
```

⚠ **`room-hour` = ⚠ 「1 つのルームの Durable Object が 1 時間 起きていた」。**
⚠ **通話が 5 分でも 3 時間でも、⚠ この単位なら仮定が要らない。**

| | ⚠ 公式の値 | ⚠⚠ room-hours |
|---|---|---|
| **Free / day** | 13,000 GB-s | ⚠⚠ **28.21 room-hours/day** |
| **Paid $5 / month に含まれる** | 400,000 GB-s | ⚠⚠ **868.06 room-hours/month** |
| ⚠ 上を 1 日に均すと | — | ⚠ **28.94 room-hours/day** |
| **超過** | $12.50 / 1M GB-s | ⚠ **$0.00576 / room-hour**(⚠ 1000 room-hours で $5.76) |

### ⚠⚠ Paid が買っているのは「量」ではない

```text
Free  13,000 GB-s/day
Paid 400,000 GB-s/month ÷ 30 = 13,333 GB-s/day
```

⚠⚠ **$5 払っても、⚠ 含まれる duration は 1 日あたり ほぼ変わらない。**
⚠ **買っているのは 超過できること である。**
⚠ **so 判断は「$5 を払うか」ではなく、⚠ 「28 room-hours/day を超える日があるか」になる。**

## 決定

### ⚠ 1. Free で始める

⚠ **境界は 28.21 room-hours/day。**

### ⚠ 2. ルームの状態は、⚠ ノックも含めて 1 ルーム = 1 DO に集約する

⚠ **`store` / `knocks` / `hub` / `roomOpenedAt` を分けない。**
⚠ **[`0005`](0005-keep-room-state-in-process-memory-only.md) が「1 か所にしか置かない」と決めた
ものを、⚠ 主語をプロセスから DO に替えて そのまま 引き継ぐ。**

### ⚠ 3. Free の上限超過は、⚠ 課金ではなく 失敗 として扱う

⚠ **Owner の指定(2026-09-06):**
⚠ **「課金されず、⚠ その種類の operation が失敗する」。**

⚠⚠ **これは Owner から受け取った事実であり、⚠ 私が公式で確かめたものではない。**
⚠ **`docs/adr/0015` § 測った の行とは 出所が違う。** ⚠ **混ぜない。**

### ⚠ 4. Paid 化は、⚠ 実測が上限へ近づいてから判断する

⚠ **先回りしない。** ⚠ **`socketOpenMs` が既に room-hours を測っている**(下記)。

## ⚠ `socketOpenMs` を料金式に使う

⚠ **使える。** ⚠⚠ **ただし 下限 としてである。**

```text
socketOpenMs  ⚠ 「1 本以上 socket が開いていた room wall-clock」
              ⚠ 部屋ごと。⚠ socket の合計ではない(⚠ 2 人 30 分 = 30 分、⚠ 60 分ではない)
```

⚠ **Cloudflare は "Calling `accept()` on a WebSocket in an Object will incur duration charges
for the entire time the WebSocket is connected" と書いている。** ⚠ **定義が一致する。**

⚠ **一致しない分が 2 つあり、⚠ どちらも `socketOpenMs` を 短くする 向きである:**

| ⚠ 数えていない時間 | ⚠ どれくらいか |
|---|---|
| ⚠ 最初の socket が開く 前 | ⚠ **秒。** ⚠ Host は作成直後に繋ぐ |
| ⚠ 最後の socket が閉じた 後 | ⚠ **実測 2026-09-05: ⚠ socket 無しで 8 秒 生存 / 15 秒 消滅** |

⚠ **so 実務上は `socketOpenMs` ≒ duration と見てよい。** ⚠ **`≒` であることは書く。**

## ⚠ Durable Object の spike で測り直さない

⚠ **料金の判断には 要らない。**

```text
⚠ 知りたいのは「DO が何秒起きていたか」
⚠ Cloudflare は「socket が繋がっているあいだ起きている」と 明言している
⚠ その秒数は、⚠ いま Node で socketOpenMs として 測れている
⚠⚠ そして wrangler dev --local は 課金しない — ⚠ 測れるのは wall-clock だけで、
   ⚠ それは既に測れているものと同じである
```

⚠ **spike が要るのは 別の問いである** — ⚠ **「我々のコードが DO の中で動くか」。**

## ⚠⚠ 決定 2 と 3 が掛かると、⚠ 扉が枯れうる

⚠ **requests は、⚠ ハートビートでは効かない。**

```text
⚠ WebSocket の incoming message は 20:1
⚠ kagima の pong: 20 秒ごと × 2 socket = 360 /room-hour → ⚠ 18 requests/room-hour
⚠ 28.21 room-hours ぶん出しても 約 508 requests。⚠ Free は 100,000/day
```

⚠⚠ **効くのは ノック待ちの polling である。**

```text
⚠ 2 秒ごと = 1,800 requests/hour(⚠ 待っている人 1 人あたり)
⚠ 1 人で Free の 100,000/day を使い切るのに 55.6 時間
⚠ 3 人なら 18.5 時間
```

⚠ **決定 2 により、⚠ その polling は DO に当たる。**
⚠ **決定 3 により、⚠ 使い切れば その種類の operation が 失敗する。**

⚠⚠ **so URL を持つ者が polling を続けると、⚠ 扉そのものが応じなくなりうる。**
⚠ **[`0017`](0017-let-the-host-decide-who-comes-in-instead-of-a-passphrase.md) が
「URL は誰かの手を経て渡る」「入力は敵対的である」と置いた前提の、⚠ 直接の帰結である。**

⚠ **これは この ADR では決めない。** ⚠ **[kagima#78](https://github.com/hidetzu/kagima/issues/78)。**
⚠ **記録しておく理由は、⚠ 決定 2 と 3 を選んだ結果として生じたものだからである。**

## 却下した案

| 案 | ⚠ 却下の理由 |
|---|---|
| **最初から Paid** | ⚠ **含まれる量は Free とほぼ同じ。** ⚠ **超過が起きるまで払うものが無い** |
| **ノックだけ DO の外に置く** | ⚠ **状態が 2 か所に出る。** ⚠ **[`0005`](0005-keep-room-state-in-process-memory-only.md) が避けたかった形そのもの** |
| **DO の spike で秒数を測り直す** | ⚠ **同じ wall-clock を 2 度測ることになる。** ⚠ **local は課金しない** |
| **通話時間を仮定して「1 本いくら」を出す** | ⚠ **仮定が答えを決めてしまう。** ⚠ **room-hour なら仮定が要らない** |

## ⚠ 越えてはならない境界

```text
ルームの状態を 2 か所に置かない       ⚠ 0005 の主語が替わっただけである
料金の数字には 出所と参照日を付ける    ⚠ 他所が公開した値であって、⚠ 我々の測定ではない
Owner から受け取った事実と、⚠ 公式で確かめた事実を 混ぜない
実測が上限に近づくまで Paid 化を先回りしない
```

## ⚠ しないと決めた主張

- ⚠ **「1 通話あたりいくら」とは言わない。** ⚠ **通話の長さは測っていない。**
  ⚠ **単位は room-hour である。**
- ⚠ **「Free で足りる」とも言わない。** ⚠ **言えるのは境界だけである** — ⚠ **28.21 room-hours/day。**
  ⚠ **足りるかどうかは、⚠ 実測が出てから分かる。**
- ⚠ **Hibernation を使えばこの数字は大きく変わる**(⚠ 公式が "can reduce these charges
  substantially" と書いている)。⚠ **Owner は 2026-09-05 に「hibernate しない」と決めており、
  ⚠ 上の全部はその決定の結果である。** ⚠ **窮屈だと分かったとき動かせる場所は そこ である。**

## 影響

- ⚠ **[`0015`](0015-put-the-service-on-cloudflare-after-three-things-are-settled.md) の 1 番目が
  片付いた。**
- ⚠ **`socketOpenMs` は、⚠ 移植後も同じ意味を持ち続ける。** ⚠ **いま Node で測っているものが、
  ⚠ そのまま料金の分母になる。**
- ⚠ **[kagima#78](https://github.com/hidetzu/kagima/issues/78) が開いた。**
