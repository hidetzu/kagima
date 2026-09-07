# 0028. ⚠ Host の判断を、⚠ hibernate しうる待機 socket で push する

- 状態: **決定**
- 日付: 2026-09-07
- 対象: ⚠ [kagima#99](https://github.com/hidetzu/kagima/issues/99) と
  [kagima#78](https://github.com/hidetzu/kagima/issues/78) を **同時に** 閉じる。
  ⚠ **[`0022`](0022-start-on-cloudflares-free-tier-with-one-durable-object-per-room.md) が
  記録した「hibernate しない」に、⚠ 待機 socket に限った例外を作る**

## 文脈

⚠ **2 つの Issue は、⚠ 同じ 1 本の polling から出ている。**

```text
kagima#99  ⚠ GET /api/rooms/{roomId}/knock/{knockId}
           ⚠ knockId が path に載るので、⚠ 我々が書かなくても 経路上のログに残る
kagima#78  ⚠ その GET を 2 秒ごとに叩く
           ⚠ 1,800 requests/hour(待っている人 1 人あたり)が DO に当たる
```

⚠ **別々に直すと、⚠ #99 は「body に移す」、⚠ #78 は「間隔を延ばす」になり、**
⚠⚠ **polling そのものは残る。** ⚠ **Owner の指定(2026-09-07): ⚠ polling 自体を無くせないか、
⚠ 2 つ一緒に検討すること。**

## ⚠ 公式の料金仕様(⚠ 出所と参照日)

⚠ **出所: Cloudflare Durable Objects Pricing。⚠ 参照日 2026-09-07。**
⚠ **これは Cloudflare が公開した値であって、⚠ kagima についての測定ではない。**

```text
Duration is billed in wall-clock time as long as the Object is active and not
eligible for hibernation, ⚠ but is shared across all requests active on an Object at once.

Calling accept() on a WebSocket in an Object will incur duration charges for the
entire time the WebSocket is connected.

⚠ a 20:1 ratio is applied to incoming WebSocket messages

Free: 100,000 requests/day, 13,000 GB-s/day     ⚠ 128 MB assumed per Object
```

⚠⚠ **`shared across all requests active on an Object at once` が、⚠ この ADR の土台である。**
⚠ **duration は オブジェクト単位の wall-clock であって、⚠ 接続ごとの合算ではない** —
⚠ **[`0022`](0022-start-on-cloudflares-free-tier-with-one-durable-object-per-room.md) の
`socketOpenMs` の定義(「部屋ごと。⚠ socket の合計ではない」)と一致する。**

## ⚠ so marginal duration は 2 通りしかない

| Guest が待っているあいだ | ⚠ 待機 socket を足したときの marginal duration |
|---|---|
| ⚠ **Host の socket が同じ部屋に開いている** | ⚠⚠ **0。** ⚠ オブジェクトは既に active で、⚠ duration は共有される |
| ⚠ **その部屋に socket が 1 本も無い**(⚠ Host 不在、⚠ **または部屋が存在しない**) | ⚠ **待ち時間ぶん 丸ごと** |

⚠⚠ **正規の経路は必ず上の行である。** ⚠ **Host の socket が開いていなければ `announceToHost`
が届かず、⚠ そもそも入れられない。**

⚠ **正規の Guest 1 人あたり**(⚠ 分母は
[`0017`](0017-let-the-host-decide-who-comes-in-instead-of-a-passphrase.md) の実測
「Host が気づくまで 24 秒」、⚠ 1 回の観測):

| | ⚠ polling | ⚠ 待機 socket |
|---|---|---|
| requests | 12 | ⚠ **1**(⚠ upgrade のみ。⚠ Guest は何も送らない) |
| duration | 12 回ぶんの wake | ⚠⚠ **0(marginal)** |

## ⚠⚠ ただし、⚠ 攻撃者を入れると向きが割れる

⚠ **Free を使い切るまでの時間。** ⚠ **公式値が分母、⚠ 1 room-hour = 3600 s × 0.128 GB =
460.8 GB-s(`0022` の式)。**

| 誰が | ⚠ polling | ⚠ 待機 socket(⚠ hibernate しない場合) |
|---|---|---|
| 1 人 / 1 部屋 | 55.6 h(requests) | ⚠ **28.2 h(duration)** — ⚠ **2 倍 悪い** |
| 10 人 / ⚠ **同じ** 部屋 | 5.6 h | ⚠ **28.2 h** — ⚠ **5 倍 良い** |
| 10 人 / 10 部屋 | 5.6 h | 2.8 h — ⚠ 2 倍 悪い |

⚠ **polling は人数に比例し、⚠ 待機 socket は同じ部屋なら比例しない**(⚠ duration が共有されるため)。
⚠ **#78 が置いた脅威は「URL を持つ者」であり、⚠ 1 本の URL は 1 部屋である。**

⚠⚠ **そして push だけが持ち込むものが 1 つある。** ⚠ **いま、token を持たない者は socket を
1 本も開けない**(`src/signaling/authorize.ts` が署名を要求する)。
⚠ **待機 socket は、⚠ URL を持つだけの人が開ける最初の socket になる。**

## 決定

⚠ **1. polling をやめ、⚠ Host の判断を待機 socket で push する。**

```text
⚠ knockId は path にも query にも載せない   ⚠ sec-websocket-protocol に載せる
                                            ⚠ join token が既に使っている同じ継ぎ目である
⚠ どの場合でも 受理し、⚠ 黙る               ⚠ 存在しない部屋も、⚠ 未応答も、⚠ 定員超えも同じ
⚠ 終端メッセージを 1 通だけ push して閉じる   ⚠ {admitted, token} または {over}
```

⚠ **2. 待機 socket は `state.acceptWebSocket` で受ける。** ⚠ **通話の socket は `ws.accept()`
のままとする。**

⚠⚠ **これが「hibernate しない」に開ける穴の 全部である。**
⚠ **[`0015`](0015-put-the-service-on-cloudflare-after-three-things-are-settled.md) と
[`0023`](0023-write-the-minimum-so-a-room-outlives-its-sockets.md) が記録した
2026-09-05 の決定は、⚠ 通話の socket については 動かない。**

⚠ **3. 待機 socket の寿命は 一律・無期限とする**(⚠ Owner 決定 2026-09-07)。

⚠ **`admitted` か `over` が来るまで、⚠ どの場合でも同じように黙って開いている。**
⚠ **今日の polling で「存在しない部屋は永久に `waiting`」なのと 1 対 1 で同じ外形である。**

## ⚠ なぜ この 2 つで足りるのか

```text
⚠ Host が居るとき   → ⚠ marginal duration は 0。⚠ hibernation は関係ない
⚠ Host が居ないとき → ⚠ 待機 socket しか無い。⚠ ws.accept() の socket は 1 本も無い
                     → ⚠ hibernation が効く場面は、⚠ ちょうどこの場面だけである
```

⚠⚠ **so「待機 socket に限って hibernate」は、⚠ 妥協ではなく、⚠ 必要な場面と完全に重なっている。**

## ⚠⚠ 公式が黙っていること

⚠ **`ws.accept()` の socket と `state.acceptWebSocket()` の socket が 同じオブジェクトに
同居したとき、⚠ そのオブジェクトが hibernate できるかどうかを、⚠ Cloudflare の文書は
書いていない**(⚠ 参照日 2026-09-07)。

⚠ **書いてあるのは `Unlike ws.accept(), state.acceptWebSocket(ws) allows the Durable Object
to be hibernated` までである。**

⚠ **so 「混ぜても hibernate できる」とは言わない。** ⚠ **「できない」とも言わない。**
⚠ **黙っている、と言う**(`.claude/rules/evidence.md` § Silence is not permission)。

⚠⚠ **この決定は そこに依存していない。** ⚠ **上の表のとおり、⚠ 混在するのは Host が居るときだけで、
⚠ そのとき marginal duration は 0 だからである。**

## ⚠ hibernate すると、⚠ 扉の記憶が消える

⚠ **公式: `In-memory state is reset`。** ⚠ **そして `src/room-object.ts` は storage に
「⚠ ノックも、⚠ token も、⚠ 名前も」書かないと決めている**
([`0023`](0023-write-the-minimum-so-a-room-outlives-its-sockets.md))。

⚠ **so 待っている人が誰かは、⚠ 待機 socket 自身が持つ**(`serializeAttachment`、
⚠ 公式の上限 16,384 bytes、⚠ 参照日 2026-09-07)。⚠ **起きたときは、⚠ 繋がっている socket から
扉の状態を組み直す。**

⚠⚠ **扉に居る人 = 開いている待機 socket である。** ⚠ **2 か所に置かない**(`CLAUDE.md` § 3)。

## 却下した案

| 案 | ⚠ 却下の理由 |
|---|---|
| ⚠ **#99 と #78 を別々に直す** | ⚠ **polling が残る。** ⚠ **#99 は body へ移すだけ、⚠ #78 は間隔を延ばすだけになり、⚠ 根が残る** |
| ⚠ **待機 socket に一律の寿命(例 60 秒)を切る** | ⚠ **攻撃者は張り直せるので、⚠ 枯渇までの時間はほぼ変わらない。** ⚠ **実質「間隔の長い polling」に戻る** |
| ⚠ **部屋の idle 規則に合わせて `over` を push する** | ⚠⚠ **存在しない URL を握った人が「これは生きた部屋ではない」を N 分で知れるようになる。** ⚠ **今日は永久に `waiting` であり、⚠ `src/knock/knocks.ts` が明記している「80-bit の URL が壁である」性質を弱める** |
| ⚠ **Host が居るときだけ待機 socket を保つ** | ⚠⚠ **Host が席に居るかどうかが外から分かる。** ⚠ **`security.md` § 3 の「未応答と 存在しない部屋は 見分けられない」を壊す** |
| ⚠ **hibernation を全体に開ける** | ⚠ **`0022` の 28.21 room-hours/day が根本から変わり、⚠ ハートビート(`0020`)と evict の挙動を測り直すことになる。** ⚠ **いま要るのは待機の場面だけである** |
| ⚠ **何もしない(#78 の案 5)** | ⚠ **`0022` が既に「扉そのものが応じなくなりうる」と書いている。** ⚠ **そして #99 は費用の話ではない** |

## ⚠ 越えてはならない境界

```text
⚠ 3 つの場合(存在しない部屋 / 未応答 / 定員超え)は、⚠ 1 バイトも違わないこと
⚠ token は admitted のときにしか載らないこと
⚠ knockId は path にも query にも現れないこと    ⚠ この ADR の存在理由の半分である
⚠ 捨てた回数は数えること、⚠ 見せないこと          ⚠ evidence.md
⚠ 通話の socket は ws.accept() のままであること   ⚠ 2026-09-05 の決定はそこでは動かない
⚠ storage には ノックも token も名前も書かないこと ⚠ 0023
```

## ⚠ しないと決めた主張

- ⚠ **「これで #78 が消えた」とは言わない。** ⚠ **言えるのは、⚠ 正規の経路の requests が
  12 → 1 になり、⚠ marginal duration が 0 になる、⚠ までである。**
  ⚠ **1 人が握り続ける形が hibernate で 0 になることは、⚠ まだ測っていない。**
- ⚠ **「混ぜても hibernate する」とは言わない。** ⚠ **公式は黙っている。**
- ⚠ **費用の数字は Cloudflare の公開値であって、⚠ 我々の測定ではない。**

## 影響

- ⚠ **[kagima#99](https://github.com/hidetzu/kagima/issues/99) と
  [kagima#78](https://github.com/hidetzu/kagima/issues/78) が、⚠ 1 つの変更で閉じる。**
- ⚠ **`0022` の「窮屈だと分かったとき動かせる場所は そこ である」が、⚠ 待機の場面で動いた。**
- ⚠ **[`0017`](0017-let-the-host-decide-who-comes-in-instead-of-a-passphrase.md) の
  「Host が居るときに決める」は 動かない。** ⚠ **決め方ではなく、⚠ 伝え方だけが変わる。**
