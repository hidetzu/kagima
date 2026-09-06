# 0023. ルームが socket より長く生きるよう、⚠ 必要最低限だけ書く

- 状態: **決定**
- 日付: 2026-09-06
- 決めた人: **Owner**
- 片付ける課題: [kagima#80](https://github.com/hidetzu/kagima/issues/80)
- 対象: ⚠ **[`0005`](0005-keep-room-state-in-process-memory-only.md) の主語を変える**

## 文脈

⚠ **[`0005`](0005-keep-room-state-in-process-memory-only.md) は「ルームの状態はプロセスの
メモリだけに置き、⚠ 永続化しない」と決めた。** ⚠ **[`0015`](0015-put-the-service-on-cloudflare-after-three-things-are-settled.md)
は「これは置き換わらない」と書いた。**

⚠⚠ **測ったら、⚠ 置き換わらざるを得ないと分かった。**

### ⚠ 実測(2026-09-06、⚠ `wrangler dev --local`、⚠ アカウント無し、⚠ `spike/room-do.ts`)

```text
⚠ 書かない場合
  ルームを作る(⚠ メモリだけ。⚠ storageKeys: 0)
  socket を 20 秒 開いたまま  → ⚠ 生きている
  socket を閉じる
  +5 秒   → ⚠ まだ生きている
  ⚠⚠ +15 秒  → ⚠⚠ 消えた

⚠ 書いた場合(⚠ 対照)
  storage に 1 キー書く
  ⚠ +105 秒 → ⚠ 生きている(⚠ socket は 1 本も無いまま)
```

⚠ **[`0015`](0015-put-the-service-on-cloudflare-after-three-things-are-settled.md) が
2026-09-05 に測った「8 秒 生存 / 15 秒 消滅」と同じ範囲である。**

### ⚠⚠ なぜ これが効くようになったか

⚠ **[`0017`](0017-let-the-host-decide-who-comes-in-instead-of-a-passphrase.md) により、⚠ Host は
作った直後に socket を開き、⚠ URL を配るあいだ開いたままにする。** ⚠ **so Host が居るかぎり
DO は起きている。**

⚠⚠ **だが 2026-09-06 に実機で測った**([kagima#75](https://github.com/hidetzu/kagima/issues/75)):

```text
⚠ 背面のタブは 73 秒 で捨てられる(⚠ 画面 点灯 でも 消灯 でも。⚠ 各 1 回)
  → ⚠ Host の socket が落ちる
  → ⚠ DO に socket が 1 本も無くなる
  → ⚠⚠ 15 秒で ルームが消える
```

⚠ **`ROOM_IDLE_MS` は 20 分である。** ⚠⚠ **書かなければ、⚠ Cloudflare では意味を持たない。**
⚠ **そして [`0021`](0021-keep-one-room-key-on-the-device-and-nothing-else.md) の「捨てられた
ページから戻る」は、⚠ 戻る先が無くなる** — ⚠ **鍵はあっても部屋がない。**

## 決定

⚠ **Durable Object の storage に、⚠ 必要最低限だけ書く。**

```text
⚠ 書く: roomId / hostKey / createdAt / lastSeenAt
```

⚠ **これで `ROOM_IDLE_MS` が意味を取り戻す** — ⚠ **ルームは「誰かが居るあいだ」ではなく
「最後に誰かが居てから `ROOM_IDLE_MS`」生きる**([`0010`](0010-a-room-lives-while-somebody-is-in-it-and-not-longer.md)
が最初からそう決めていた)。

### ⚠⚠ 書かないもの

```text
⚠ ノック         ⚠ 誰が来たかは残さない (PRODUCT.md § 5)
⚠ join token     ⚠ 短命さが security.md § 4 の要点である。⚠ 書けば取り去ることになる
⚠ ニックネーム    ⚠ 来訪者のものであって、⚠ ルームのものではない
⚠ signalling の中身 ⚠ そもそも見ていない (0001)
⚠ 参加者の一覧    ⚠ socket が在るあいだの話であり、⚠ socket と一緒に消えてよい
```

⚠⚠ **ノックを書かないことの帰結**: ⚠ **DO が evict されると、⚠ 待っている人は消える。**
⚠ **それは正しい** — ⚠ **Host が居ないあいだのノックは、⚠ もともと誰にも届いていない**
([`0018`](0018-give-the-host-a-short-lived-role-inside-one-room.md))。
⚠ **待っている人には、⚠ 断られたときと同じ 1 つの答えが返る**
([`0017`](0017-let-the-host-decide-who-comes-in-instead-of-a-passphrase.md))。

### ⚠ 消える経路

⚠ **書いたものは、⚠ 誰かが消さねばならない。** ⚠ **プロセスが終われば消える、はもう無い。**

```text
⚠ Host がルームを閉じたとき   ⚠ その場で消す
⚠ 期限が切れたとき            ⚠ 読むときに見て、⚠ 切れていれば 存在しないルームと同じ答え (0010)
```

⚠ **`0010` は「期限が切れたルームは、⚠ 存在しなかったルームと同じ応答を返す。⚠ 回収を待たない」
と決めている。** ⚠ **読むときに期限を見れば、⚠ 掃除の周期に依存しない。** ⚠ **その決定は保たれる。**

## ⚠ [`0005`](0005-keep-room-state-in-process-memory-only.md) はどうなるか

⚠⚠ **置き換わる。** ⚠ **[`0015`](0015-put-the-service-on-cloudflare-after-three-things-are-settled.md)
の「置き換わらない」は 間違っていた。** ⚠ **測る前に書いたからである。**

⚠ **ただし `0005` が守ろうとしたものは 変わらない:**

| `0005` が言ったこと | ⚠ いまどうなるか |
|---|---|
| ⚠ データベースを持たない | ⚠ **持たない。** ⚠ DO の storage は その部屋のものであり、⚠ 部屋と一緒に消える |
| ⚠ 会話の内容を書かない | ⚠ **書かない** |
| ⚠ 誰が来たかを書かない | ⚠ **書かない** |
| ⚠ プロセス外に出さない | ⚠⚠ **これだけ変わる** |

⚠ **`0005` の「ディスクに書いていない ≠ 保持していない」という evidence の行は、⚠ そのまま
効き続ける。** ⚠ **むしろ 逆向きに 効くようになる** — ⚠ **書いたものは、⚠ 消したと言うために
消したことを確かめねばならない。**

## 却下した案

| 案 | ⚠ 却下の理由 |
|---|---|
| **何も書かない** | ⚠⚠ **Host のページが背面で捨てられたらルームも消える。** ⚠ **[`0021`](0021-keep-one-room-key-on-the-device-and-nothing-else.md) が無意味になる。** ⚠ **73 秒 は実測である** |
| **Host の socket を切らせない** | ⚠⚠ **できない。** ⚠ **ブラウザがページごと捨てる。⚠ 測った** |
| **ノックも書く** | ⚠ **「誰がノックしたかを記録に残さない」に触る**(`PRODUCT.md` § 5)。⚠ **そして 要らない** — ⚠ Host が居ないあいだのノックは、⚠ もともと届いていない |
| **D1 に置く** | ⚠ **部屋をまたぐ 1 つの箱になる。** ⚠ **DO の storage なら、⚠ 部屋の外に出ない** |
| **hibernation を使って socket を保つ** | ⚠ **Owner が 2026-09-05 に「hibernate しない」と決めている。** ⚠ **覆すなら別の判断である** |

## ⚠ 越えてはならない境界

```text
書くのは roomId / hostKey / createdAt / lastSeenAt だけ
⚠⚠ 部屋をまたぐ箱を作らない       ⚠ DO の storage は その部屋のもの
⚠ 期限は 読むときに 見る          ⚠ 掃除の周期に依存させない (0010)
⚠ 閉じたら 消す                   ⚠ 書いたものには 消す義務が付く
⚠ 消したことを 確かめる           ⚠ 「消した」は主張であって、⚠ 検査が要る (evidence.md)
```

## ⚠ しないと決めた主張

- ⚠ **「これでルームが必ず 20 分もつ」とは言わない。**
  ⚠ **測ったのは 105 秒までである。** ⚠ **それ以上は測っていない。**
- ⚠ **「書いたものは必ず消える」とも言わない。**
  ⚠ **言えるのは「消す経路が在り、⚠ 検査がそれを見た」までである**
  ([`0005`](0005-keep-room-state-in-process-memory-only.md) の evidence の行がそのまま効く)。

## 影響

- ⚠ **[`0005`](0005-keep-room-state-in-process-memory-only.md) は 置き換え済み になる。**
- ⚠ **[`0010`](0010-a-room-lives-while-somebody-is-in-it-and-not-longer.md) の寿命が、⚠ 移植後も
  意味を持つ。** ⚠ **書かなければ持たなかった。**
- ⚠ **[`0021`](0021-keep-one-room-key-on-the-device-and-nothing-else.md) の「戻る」に、⚠ 戻る先が
  在る。**
- ⚠ **DO の形が決まった。** ⚠ **移植を始められる。**
