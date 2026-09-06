# 0026. ⚠ メディアが落ちてシグナリングが生きているとき、⚠ 張り直す

- 状態: **決定**
- 日付: 2026-09-06
- 対象: ⚠ [`0017`](0017-let-the-host-decide-who-comes-in-instead-of-a-passphrase.md) が定めた扉に、⚠ 触れないこと

## 文脈

⚠ **実測(2026-09-06、実機 1 回、PC 固定回線 × スマホ モバイル回線)。**

```text
 45203ms  connectionState -> connected
 78761ms  iceConnectionState -> disconnected
 88762ms  connectionState -> failed        ⚠ Chromium は 10.0 秒 かけて failed にした
126873ms  signalingState -> have-remote-offer
127337ms  connectionState -> connected     ⚠ 48.6 秒、メディアが無かった
```

⚠⚠ **その 48.6 秒のあいだ、⚠ シグナリングは両側とも開いていた。**
⚠ **PC は 243.0 秒で 12 回のハートビートを返し、⚠ 1 回も欠けていない。**
⚠ **スマホも `open throughout`。**

⚠⚠ **張り直すのに要るものは、⚠ 両方の機械に揃っていた。** ⚠ **誰も手を伸ばさなかった。**

⚠ **戻ったのは、⚠ スマホ側で 新しいページが立ち上がって 入り直したから**である。
⚠ **2 枚の診断パネルの遷移が、⚠ 独立に 126.6 秒前後の同じずれを出す**
(390/126878、475/127233、693/127337 — ⚠ 幅 270ms)。
⚠ **最初のスマホセッションのパネルは残っていない。**

## 決定

⚠ **`connectionState` が `failed` になり、⚠ かつ offer が実際にこのページを出られるとき、⚠ ICE を
張り直した offer を出し直す。**

```text
⚠ failed になった       → ⚠ 決められた回数だけ、⚠ 間を置いて試す
⚠ connected に戻った    → ⚠ やめる(⚠ 自力で治ったのか これが効いたのかは、⚠ ここからは分からない)
⚠ closed になった       → ⚠ やめる(⚠ 誰かが切った。⚠ 復旧の失敗ではない)
⚠ socket が閉じている   → ⚠ その回は使わない(⚠ 出られない offer は、⚠ 出していないのと同じ)
⚠ 回数を使い切った      → ⚠ 止まる。⚠ 挽かない
```

⚠ **判断は [`../../src/call/restart.ts`](../../src/call/restart.ts) に置く。**
⚠ **`src/client/call.ts` は kagima で唯一メディアに触るファイルで、⚠ 単体検査には ICE エージェント
が無い。** ⚠ **fixture で決められる部分を fixture の届くところへ出す形は、
⚠ [`../../src/diagnostics/report.ts`](../../src/diagnostics/report.ts) と同じである。**

## ⚠ 決めなかったこと、⚠ そしてその理由

### ⚠ `disconnected` では動かない

⚠ **`disconnected` は自力で治る。** ⚠ **そこで張り直すと、⚠ 治りかけの接続を壊す。**
⚠ **Chromium が `failed` を出すまでの 10.0 秒は、⚠ どのみち払われている。**

### ⚠ offer を出す側だけが張り直す

⚠ **`start()` が offer 側だけなのと同じ理由で、⚠ 両側が同時に offer を投げれば glare になる。**
⚠ **1 本の接続なので、⚠ offer 側も同じ `failed` を見る。** ⚠ **so 取り逃がしはしない。**

⚠⚠ **拾えないのは「offer 側のページごと消えた」場合で、⚠ それは
[`hidetzu/kagima#90`](https://github.com/hidetzu/kagima/issues/90) である。**
⚠ **別の問いなのは、⚠ そちらが 扉の判断に触れるからである。**

### ⚠⚠ 扉は開かない

⚠ **ICE の張り直しは、⚠ すでに通った接続を結び直すだけである。**
⚠ **ノックは起きず、⚠ join token も出し直されず、⚠ Host にもう一度は訊かない。**
⚠ **[`0017`](0017-let-the-host-decide-who-comes-in-instead-of-a-passphrase.md) の「誰を入れるかは Host が決める」も、
⚠ [`../../.claude/rules/security.md`](../../.claude/rules/security.md) § 4 の「Host の判断は一度
だけ短命な token に交換される」も、⚠ どちらも動かない。**

⚠ **ここを取り違えると、⚠ 「切れた人はいつでも戻れる」に化ける。** ⚠ **化けさせない。**

### ⚠ 画面には何も出さない

⚠ **再接続中に何を見せるかは Owner がすでに決めている(⚠ 何も出さない)。**
⚠ **この決定はそれを変えない。**

## 代償

- ⚠ **落ちた側が黙って戻るので、⚠ 落ちたこと自体が人には見えない。**
  ⚠ **見えるのは診断パネルだけで、⚠ その パネルが断絶を隠していることは
  [`hidetzu/kagima#91`](https://github.com/hidetzu/kagima/issues/91) である。**
- ⚠ **回数は測って決めた値ではない**
  ([`../../.claude/rules/evidence.md`](../../.claude/rules/evidence.md))。
  ⚠ **`src/client/reconnect.ts` の `RETRY_DELAYS_MS` と同じ足場にある。**
- ⚠ **単体検査が言えるのは「所定の場面で所定のことを頼む」までで、⚠ 「本物の接続が戻る」ではない。**
  ⚠ **そこは最終ゲートの領分である。**
