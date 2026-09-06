# 0027. ⚠ 答える側も張り直す。⚠ ただし 長く待ってから

- 状態: **決定**
- 日付: 2026-09-06
- 対象: ⚠ [`0026`](0026-restart-ice-when-media-fails-and-signalling-has-not.md) の
  ⚠ **「offer を出す側だけが張り直す」を 置き換える**

## 文脈

⚠ **[`0026`](0026-restart-ice-when-media-fails-and-signalling-has-not.md) はこう書いた** —
⚠ **「1 本の接続なので、⚠ offer 側も同じ `failed` を見る。⚠ so 取り逃がしはしない」。**

⚠⚠ **見ることと、⚠ 動けることは 別だった。**

⚠ **実測(2026-09-06、⚠ [`0026`](0026-restart-ice-when-media-fails-and-signalling-has-not.md)
を出したあとの実機)。** ⚠ **PC を Host、⚠ スマホを Guest にし、⚠ スマホを背面に置いた。**

```text
 39184ms  connected
118363ms  disconnected
128363ms  failed
          ⚠⚠ 以後なにもない
last answered at: 211085ms   ⇒ ⚠⚠ 82.7 秒 落ちたまま
signalling socket: open throughout   /   heartbeats answered: 10
```

```text
public/index.html (Host、PC)      → isOfferer: false   ⚠ 張り直さない
public/room.html  (Guest、スマホ)  → isOfferer: true    ⚠ 張り直す側
```

⚠⚠ **張り直す義務を、⚠ いちばん眠っている側にだけ置いていた。**
⚠ **背面のページはタイマーを絞られ、⚠ 捨てられることもある**
([`0021`](0021-keep-one-room-key-on-the-device-and-nothing-else.md) が扱った実測)。
⚠ **起きていたのは Host のほうで、⚠ Host は何もしない側だった。**

## 決定

⚠ **両側が張り直す。** ⚠ **glare は 待ち時間の差だけで避ける。**

```text
⚠ offer 側    ⚠ 短い待ちから試す         ⚠ 0026 のまま
⚠ 答える側    ⚠⚠ offer 側の最初の 2 回ぶんより 長く待ってから、⚠ 初めて試す
              ⚠ そのあいだに戻れば、⚠ 1 回も offer を出さない
```

⚠ **この差が 仕掛けの全部である。** ⚠ **so コメントではなく 壁にした**
(`test/ice-restart.test.ts`、⚠ **2 つの数を比べる 1 本**)。

### ⚠ それでも重なったとき

⚠ **両側が同時に offer を出すと、⚠ `have-local-offer` のまま相手の offer を入れることになり、⚠ 例外
になる。** ⚠ **決め打ちで片を付ける。**

| 受け取った側 | ⚠ どうするか |
|---|---|
| ⚠ **先に offer した側** | ⚠ **相手の offer を無視する**(⚠ こちらが勝つ) |
| ⚠ **答える側** | ⚠ **自分の offer を巻き戻してから、⚠ 相手のに答える** |

⚠ **勝ち負けを その場で相談しない。** ⚠ **相談する仕組みは、⚠ 相談が届かないときに壊れる。**

⚠ **新しいメッセージは足していない。** ⚠ **答える側が出す offer は、⚠ 相手の既にある `offer` の
処理がそのまま受ける** — ⚠ **実測で 126873ms の再交渉が通っている経路である。**

## ⚠ 変わっていないこと

⚠ **扉には触らない。** ⚠ **ノックは起きず、⚠ join token も出し直されず、⚠ Host にもう一度は訊かない**
([`0017`](0017-let-the-host-decide-who-comes-in-instead-of-a-passphrase.md)、
[`../../.claude/rules/security.md`](../../.claude/rules/security.md) § 4)。
⚠ **[`0026`](0026-restart-ice-when-media-fails-and-signalling-has-not.md) のこの一節は そのまま
生きている。** ⚠ **置き換えたのは 「誰が張り直すか」だけである。**

⚠ **画面にも何も出さない。**

## 代償

- ⚠ **答える側は、⚠ 待つぶんだけ遅い。** ⚠ **offer 側が生きていれば その待ちは丸ごと無駄になる。**
  ⚠ **82.7 秒 何も起きなかったことと引き比べて、⚠ 引き受けた。**
- ⚠ **待ち時間は測って決めた値ではない**
  ([`../../.claude/rules/evidence.md`](../../.claude/rules/evidence.md))。
  ⚠ **測って決めたのは 2 つの大小関係だけで、⚠ 壁もそこにしか置いていない。**
- ⚠⚠ **両側とも眠っている / 片方のページが消えている場合は、⚠ これでも戻らない。**
  ⚠ **それは [`hidetzu/kagima#90`](https://github.com/hidetzu/kagima/issues/90) である。**
