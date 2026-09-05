# 0015. サービスは Cloudflare に載せる。⚠ ただし先に 3 つ片付ける

- 状態: **決定**
- 日付: 2026-09-05
- 決めた人: **Owner**
- ⚠ **まだ移していない。** ⚠ **`main` は Node 版のままである。**

## 決定

⚠ **サービス提供の形態は Cloudflare(Worker + Durable Objects)とする。**
⚠ **先に片付けるべき課題を片付けてから移植する。**

⚠ **方向の決定であって、⚠ 移植の完了ではない。**
⚠ **これが決まったことで、⚠ Node 版は「本番の形」ではなく「いま動いている形」になった。**

## ⚠ 先に片付ける 3 つ

⚠ **どれも「移れない理由」ではなく、⚠ 「移る前に答えが要ること」である。**

| # | Issue | 何を片付けるか | ⚠ なぜ先か | 誰が |
|---|---|---|---|---|
| **1** | [#47](https://github.com/hidetzu/kagima/issues/47) | ⚠⚠ **ルーム状態をどこに置くか決める**(⚠ **課金条件を調べた結果、⚠ 問いが変わった**) | ⚠ **DO は 10 秒で in-memory state を捨てる。** ⚠ **「メモリだけ」は Node と等価ではない** | ⚠ **Owner + AI** |
| **2** | [#48](https://github.com/hidetzu/kagima/issues/48) | ⚠ **決定済** → [`0016`](0016-write-the-client-in-typescript-and-ship-built-javascript.md) | ⚠ **TypeScript で書き、⚠ ビルドした JS を配る。** ⚠ **境界は「最終ゲートはビルド成果物に対して走る」** | ⚠ **済** |
| **3** | [#49](https://github.com/hidetzu/kagima/issues/49) | ⚠ **`signalling-drops` 相当をどう検査するか決める** | ⚠ **いまは同一プロセスの内側から `stopAnswering()` を呼んでいる。** ⚠ **Worker では内側に手が入らない。** ⚠ **検証可能性を落として移らない** | AI |

⚠ **1 は当初「課金条件を確かめる」だった。** ⚠ **調べたら、⚠ 問いが変わった**
([`../DISCOVERY.md`](../DISCOVERY.md) § 10、⚠ 出所と参照日つき):

- ⚠ **Free plan でも DO は使える。** ⚠ **so 「必ず継続コストが発生する」ではない。**
- ⚠⚠ **しかし DO は 10 秒のアイドルで in-memory state を捨て、⚠ 70〜140 秒で完全に evict される。**
- ⚠ **kagima はルームを作ってから合言葉が入るまで数分かかる**(⚠ 実測 4〜5 分)。
  ⚠ **その間にルームが消える。**
- ⚠⚠ **これは推論ではない。** ⚠ **`wrangler dev --local` で踏んだ:**
  ⚠ **作成から 8 秒後は合言葉が通り、⚠ 15 秒後は通らない**([`../DISCOVERY.md`](../DISCOVERY.md) § 10)。
  ⚠ **`storage` は 0 キーのまま** — ⚠ **書いたものが消えたのではなく、⚠ 書いていないものが退避された。**

⚠⚠ **so 1 は金額の問題ではなくなった。** ⚠ **「duration を払うか、⚠ 何かを書くか」である。**
⚠ **そして払っても、⚠ 待ち時間の evict は防げない** — ⚠ **WebSocket がまだ無いからである。**

⚠ **[`0005`](0005-keep-room-state-in-process-memory-only.md) に触れる。**
⚠ **触れる以上、⚠ Owner 判断である**([`../PRODUCT.md`](../PRODUCT.md) § 6)。

## ⚠ 調べたこと(2026-09-05、⚠ 実際に動かした)

⚠ **`wrangler dev --local`、⚠ アカウント無し・課金無し、⚠ 捨てるコード。**
⚠ **kagima のリポジトリには 1 ファイルも入れていない。**

| 確かめたこと | ⚠ 観測 |
|---|---|
| アカウント無しでローカル実行 | ⚠ **できた** |
| `crypto.subtle.timingSafeEqual` | ⚠ **ある**(`typeof` が `function`) |
| 定数時間比較 | ⚠ **通った**(正 → `true` / 誤 → `false`) |
| DO 越しの signalling 中継 | ⚠ **できた** |
| 3 人目を断る | ⚠ **できた** |
| ⚠⚠ **DO の storage** | ⚠⚠ **signalling 後も 0 キー。** ⚠ **何も書いていない** |

⚠ **so 製品契約は障害ではない。** ⚠ **「残さない」は、⚠ 主張ではなく観測として確かめた。**

## ⚠ 追記(2026-09-05)— ⚠ 測ったら、⚠ 書かずに済みそうだと分かった

⚠ **前の追記で「10 秒で in-memory state が捨てられる」と測った。**
⚠ **しかし、その測定は kagima の形ではなかった** — ⚠ **何も接続せずに放置していた。**

⚠ **実際の kagima は、⚠ Host が `createRoom()` の直後に signalling を開き、
⚠ URL を配っているあいだ socket を開いたままにする**(`public/index.html`)。

⚠ **so 測り直した**(`wrangler dev --local`):

| Host の socket | 経過 | ⚠ ルームは生きているか |
|---|---|---|
| ⚠ **無し** | 8 秒 / ⚠ **15 秒** | 生きる / ⚠ **消える** |
| ⚠ **開いたまま** | 15 / 60 / 120 / 240 / ⚠ **360 秒** | ⚠ **すべて生きる** |

⚠ **so「何も書かない」構成で成立しうる。** ⚠ **`0005` を守ったまま移れる可能性がある。**

### ⚠ 無料枠(⚠ Cloudflare の公開値に対する算術。⚠ 我々の測定ではない)

⚠ **`accept()` した WebSocket は、⚠ 繋がっているあいだ duration が課金される。**
⚠ **duration は「実時間 × 128MB」で、⚠ 無料枠は 13,000 GB-s/day。**

```text
13,000 GB-s ÷ 128MB = ⚠ 1 日あたり 104,000 秒 (28.9 時間) の DO 実時間
```

| 1 ルームの長さ | ⚠ 1 日あたり |
|---|---|
| 待ち 5 分 + 通話 10 分 | ⚠ **115 ルーム** |
| 待ち 5 分 + 通話 30 分 | ⚠ **49 ルーム** |
| 待ち 5 分 + 通話 60 分 | ⚠ **26 ルーム** |

⚠ **この利用想定では、⚠ 無料枠で最初に制約になりそうなのは duration である。**
⚠ **requests は同条件で 2,500〜4,000 ルーム相当なので、⚠ 先に尽きるのは duration の側に見える。**
⚠ **「duration だけが効く」とは言わない** — ⚠ **他の要素を測っていない。**

### ⚠ Owner の決定(2026-09-05)

⚠ **hibernate しない。** ⚠ **まず「何も書かない」構成で移植する。**
⚠ **下の 3 つで実際に困ったときに、⚠ 必要最低限を書くことを改めて決める。**

```text
Host がタブを閉じる / 再読込   ⚠ socket が切れ、ルームが消えうる
deployment                     ⚠ 文書に「may shut down at any time due to deployments」
本番の挙動                     ⚠ ローカルの workerd でしか測っていない
```

⚠ **書くことにした場合、⚠ `PRODUCT.md` § 5 の「合言葉そのものを記録に残さない」に触れる。**
⚠ **ハッシュにしても、⚠ 28 bit のダイジェストが storage に残る** — ⚠ **レート制限が守っている
前提が、⚠ 漏洩時に外れる。** ⚠ **so そのときは Owner 判断である。**

### ⚠ so 接続時間を測る

⚠ **`accept()` した WebSocket は、⚠ 繋がっているあいだ DO を確実に active にする。**
⚠ **so 測るのは「ルームに socket が 1 本でも開いていた実時間」である。**
⚠⚠ **socket の合計ではない。** ⚠ **2 人 30 分は 30 分であって 60 分ではない。**

⚠⚠ **これは Cloudflare の総 billable duration と同じではない。**
⚠ **request の処理、⚠ event handler の実行、⚠ hibernation の条件を満たさない idle 時間にも
duration は発生する。** ⚠ **測っているのは、⚠ この設計が左右できる部分であり、
⚠ 現構成では duration の主要部分になる見込みである** — ⚠ **「見込み」は本当に見込みである。**

⚠ **`src/signaling/attach.ts` がそれを announce する:**

```text
a peer left                    ⚠ その socket 自身の時間 (heldMs) — 参考。⚠ ルームの数字ではない
a room stopped holding sockets ⚠ ルームの実時間 (socketOpenMs)
                               ⚠ WebSocket が DO を確実に active にした時間であって、
                               ⚠ 請求額そのものではない
```

⚠ **メモリに持つのはルームが生きているあいだだけで、⚠ 合計は取らない。**
⚠ **合計を持てばそれは記録であり、⚠ 記録こそ kagima が持たないものである**(`0005`)。
⚠ **serve もしない** — ⚠ **`0011` / `0014` で一度払った道である。**

## ⚠ 測った(2026-09-06、⚠ `wrangler dev --local` 4.129.0、⚠ アカウント無し)

⚠ **`spike/` を置いて、⚠ workerd の中で実際に走らせて聞いた。**
⚠ **公開文書からの引き写しではない。** ⚠ **どれも `spike/worker.ts` を叩けば再現する。**

| 問い | ⚠ 測った結果 |
|---|---|
| ⚠ **join token(Web Crypto HMAC)は無改変で動くか** | ⚠ **動く。** ⚠ 自室のトークンを通し、⚠ 別室のを拒む |
| ⚠ **`src/random.ts` の CSPRNG は動くか** | ⚠ **動く。** ⚠ 1000 本引いて distinct 1000 |
| ⚠ **ハンドシェイクの規則は無改変で動くか** | ⚠ **動く。** ⚠ `Headers.get` の `null` もそのまま扱えた |
| ⚠ **`setInterval` は request handler の中で使えるか** | ⚠ **使える。** ⚠ 120ms で 11 回発火。⚠ `unref` も在る |
| ⚠⚠ **サーバ側 WebSocket は protocol ping を出せるか** | ⚠⚠ **出せない** |

### ⚠⚠ 見つかった移植ブロッカー — ⚠ 1 行で全部止まっていた

⚠ **`src/token/join-token.ts` が、比較用の鍵をモジュール読み込み時に引いていた。**

```text
Uncaught Error: Disallowed operation called within global scope.
Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and generating
random values are not allowed within global scope.
```

⚠ **このモジュールを読み込むだけで isolate が死ぬ。** ⚠ **つまり kagima の現物は、⚠ Worker では
1 リクエストも処理せずに起動に失敗していた。**
⚠ **初回使用時に引くよう直した。** ⚠ **性質は変わらない** — ⚠ プロセスに 1 つ、⚠ 乱数、⚠ 書き残さない。

⚠ **壁は `test/room.test.ts`** の
「⚠ nothing under `src/` draws randomness while the module is loading」。
⚠ **これは代理指標である** — ⚠ **インデントで「関数の中かどうか」を代用しており、⚠ 木が整形
されていることに依っている。** ⚠ **実行時についての主張は、⚠ Worker が実際に起動することであり、
⚠ いまは `spike/` がそれである。**

### ⚠⚠ ping が無い、ということの意味

⚠ **`server.ping` は関数ではなく、⚠ prototype の名前一覧にも無い。**
⚠ **クライアント側で待っても ping フレームは来なかった。**

```text
accept  binaryType  close  deserializeAttachment  extensions  protocol
readyState  send  serializeAttachment  url
```

⚠ **`SignalingSocket.ping` は、⚠ Worker のアダプタでは別の答えを要する**
(`src/signaling/socket.ts` が、⚠ 測る前からその継ぎ目を用意してあった)。
⚠ **黙って何もしないことだけは許されない** — ⚠ **静かに死んだソケットが誰にも気づかれず、
⚠ ルームが、去った人のために席を持ち続ける。**

⚠ **どう答えるかは、この ADR ではまだ決めない。** ⚠ **kagima#62。**

## ⚠ 移植の切り方(2026-09-06、⚠ 実施しながら分かったこと)

⚠ **「Node 版と Worker 版を並べて書く」ことはしない。** ⚠ **`CLAUDE.md` § 3 が禁じている
「同じ問いに答える実装を 2 つ持つ」に、⚠ 移植は最も嵌りやすい。**

⚠ **so 各段で、⚠ 先に *継ぎ目* を Node 版のまま作り、⚠ いまの検査で押さえる。**
⚠ **Worker が来たときに書くのはアダプタ 1 枚だけになる。**

```text
3/n  ルーティング   handle(ctx, Request) -> Response      ⚠ Node は アダプタ に痩せた
4/n  静的配信       ビルド成果物を配る                     ⚠ node:module が要らなくなった
5/n  signalling     authorize / session / socket に割った  ⚠ ws を触るのは attach.ts だけ
```

### ⚠ 5/n で割った線

| ファイル | 何を持つ | ⚠ Worker で |
|---|---|---|
| `signaling/protocol.ts` | ⚠ **両端が合意する定数** — subprotocol、close コード | ⚠ そのまま |
| `signaling/socket.ts` | ⚠ **kagima が話す唯一のソケットの形** | ⚠ そのまま |
| `signaling/authorize.ts` | ⚠ **ハンドシェイクを通すかどうか** | ⚠ そのまま |
| `signaling/session.ts` | ⚠ **繋がった 1 人が何をするか** | ⚠ そのまま |
| `signaling/attach.ts` | ⚠ **`ws` と `node:http`。⚠ 何も決めない** | ⚠ **これだけ書き換える** |

⚠ **`protocol.ts` はブラウザからも読む。** ⚠ **subprotocol の前置きが、⚠ サーバとクライアントに
1 つずつ書かれていた** — ⚠ **食い違っても静かに壊れる形だった**(⚠ ブラウザが知らない
subprotocol を出し、⚠ サーバが拒否し、⚠ その拒否は不正トークンと見分けがつかない)。

### ⚠ ping — ⚠ 2026-09-06 に測った

⚠ **この節は「まだ測っていない」と書いてあった。** ⚠ **測った。** ⚠ **上の節にある。**
⚠ **答えは「出せない」であり、⚠ 継ぎ目が `SignalingSocket.ping` であったことは変わらない。**

## ⚠ 移植のときに越えてはならない境界

```text
D1 / R2 / KV を入れない            ⚠ 必要性が証明されるまで。⚠ DO だけで足りた
ルーム状態をディスクに書かない      ⚠ 0005 は生き続ける。⚠ DO の storage も使わない
メディアを Cloudflare に通さない    ⚠ 0001。⚠ Worker になっても変わらない
合言葉の比較を === にしない        ⚠ 非同期になっても定数時間のまま
Node 版と Worker 版を両方持たない   ⚠ CLAUDE.md § 3。⚠ 必ず片方が古くなる
```

⚠ **最後の 1 行が移植の形を決める。** ⚠ **並行運用しない。** ⚠ **移すときは移す。**

## ⚠ 移植が完了したときに置き換わる ADR

⚠ **いまはまだ効いている。** ⚠ **移植の PR で、⚠ その時点の状態に書き換える。**

| ADR | ⚠ どうなるか |
|---|---|
| [`0002`](0002-serve-web-and-signaling-from-one-typescript-process.md) | ⚠ **「1 つの Node プロセス」が成り立たなくなる。** ⚠ **ビルドステップが無いという中身も** |
| [`0003`](0003-expose-only-http-and-websocket-through-cloudflare-tunnel.md) | ⚠ **本番では Tunnel を使わない。** ⚠ **実測の手順としては残る**([`../FIELD-TEST.md`](../FIELD-TEST.md)) |
| [`0009`](0009-use-ws-for-the-websocket-server-rather-than-writing-rfc6455.md) | ⚠ **`ws` が不要になる。** ⚠ **唯一の実行時依存が消える** |
| [`0010`](0010-a-room-lives-while-somebody-is-in-it-and-not-longer.md) | ⚠ **「プロセスが終われば消える」の主語が変わる。** ⚠ **再検討が要る** |

⚠ **[`0005`](0005-keep-room-state-in-process-memory-only.md) は置き換わらない。**
⚠ **「書かない」は移っても守れることを、⚠ 実測で確かめた。**

## 却下した案

| 案 | ⚠ 却下の理由 |
|---|---|
| ⚠ **家庭内 PC + Tunnel を本番の形として続ける** | ⚠ **PC を動かし続けることが可用性そのものになる。** ⚠ **実測で Tunnel の罠を 2 つ踏んだ** |
| ⚠ **課金条件を確かめてから方針を決める** | ⚠ **Owner が方針を決めた。** ⚠ **順序が逆になっただけで、⚠ 確かめること自体は残る** |
| **Node 版と Worker 版を並行運用する** | ⚠ **`CLAUDE.md` § 3。** ⚠ **同じ問いに答える実装を 2 つ持たない** |
| **KV や D1 でルーム状態を持つ** | ⚠ **[`0005`](0005-keep-room-state-in-process-memory-only.md) に反する。** ⚠ **そして DO だけで足りた** |
| ⚠ **3 つを片付けずに移植を始める** | ⚠ **2 と 3 は「移植の途中で決める」と必ず後回しになる。** ⚠ **特に 3 は、⚠ 検証可能性が落ちたことに気づかないまま進む** |

## ⚠ しないと決めた主張

- ⚠ **「Cloudflare のほうが安い」とは言わない。** ⚠ **金額を見ていない。**
- ⚠ **「Node 版より単純になる」とも言わない。**
  ⚠ **ビルドは複雑になる。** ⚠ **単純になるのは運用である。**
- ⚠ **「本番で動く」とはまだ言わない。**
  ⚠ **確かめたのはローカルの `workerd` であって、⚠ Cloudflare の上ではない。**
- ⚠ **この ADR は移植計画ではない。** ⚠ **何をどの順で置き換えるかは、⚠ 3 つが片付いてから書く。**
