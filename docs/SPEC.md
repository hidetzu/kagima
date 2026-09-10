# SPEC — 今日なにを主張してよいか

⚠ **このファイルは「kagima が自分について主張してよいこと」だけを持つ。** ⚠ **他は何も持たない。**
「どう働くか」は [`../CLAUDE.md`](../CLAUDE.md)、「どう書くか」は
[`../.claude/rules/`](../.claude/rules/)、「何を作るか」は [`PRODUCT.md`](PRODUCT.md)、
「なぜそう決めたか」は [`adr/`](adr/)。

⚠ **現時点で実装は存在しない。** ⚠ **したがって表は空である。** ⚠ **これは正しい状態である。**

⚠ **件数をここに書かないこと**([`../.claude/rules/evidence.md`](../.claude/rules/evidence.md))。
⚠ **件数は、それを数えたものが実行時に自分で言う。**
⚠ **書き込まれた件数は書いた瞬間から古く、並行する変更をすべて衝突させる。**

---

## 1. 実装しているもの

⚠ **行が入るのは、その振る舞いが存在し、かつそれを裏付ける検査が存在してからである。**
⚠ **予定は実装ではない。**

⚠ **「何が裏付けるか」の欄には、ファイル名ではなく検査ケースの名前を書く。**
⚠ **ファイル名は「どこを見ればいいか」しか言わない。**
⚠ **そこに主張を裏付けるものが入っているとは言っていない** — ⚠ **なのに読む側は言われたと受け取る。**
⚠ **行を書く前にそのケースを実行し、主張のどの節まで覆っているかを読むこと。**

⚠ **これはテンプレート元のプロジェクトで実際に壊れた箇所である**
(⚠ **行が 2 つのファイルを裏付けとして挙げ、⚠ どちらも裏付けていなかった。**
⚠ **その欠落は完了報告に書かれていたのに、行はそのまま残った**)。
⚠ **一方で欠落を言うことは、他方でそれを主張してよい理由にならない。**

| 層 | 何ができるか | どの規格の、どの節か | 何が裏付けるか |
|---|---|---|---|
| ⚠ **ルームを作るところ** | ⚠ **ルームを作れるのは、⚠ Google で名乗り、⚠ 許可されたアドレスの人だけである。** ⚠ **入る人はこれに一度も触れない** | — | ⚠ **ケース `worker` の門の判定と `test/gate.test.ts` / `test/sign-in.test.ts`**。⚠ **ID token の claim(iss / aud / exp / nonce / email_verified)を 1 つずつ壊して、⚠ どれも単独で拒まれることを見る**([`adr/0030`](adr/0030-let-the-host-sign-in-with-google-and-keep-the-guest-anonymous.md))。⚠ **実サービス 2026-09-08: ⚠ 本物の Google との往復が通り、⚠ 許可されたアドレスでルームを作れた**(⚠ Owner の報告であって、⚠ 取得した記録ではない)。⚠ **同日、⚠ redirect URI 不一致と 許可リスト外も 実サービスで踏み、⚠ どちらもルームは作れなかった**(⚠ 同じく Owner の報告。⚠ **画面に出た文言そのものは記録していない**) |
| 入口 | ⚠ **URL を持つ人がノックでき、⚠ Host が入れると決めた人だけが入れる** | — | ⚠ **ケース `frames`**(`npm run e2e`)。⚠ **Host が承認するまで通話は始まらない** |
| 入口 | ⚠ **存在しないルームと、⚠ Host が応じていないルームは、⚠ 外から区別できない** | — | ⚠ **ケース `guest-refusals`**(`npm run e2e`)。⚠ **2 つの待機画面を文字列として比較する** |
| 入口 | ⚠ **入れなかった人のカメラは、⚠ 一度も求められない** | W3C Media Capture(`getUserMedia`) | ⚠ **ケース `third-person`**(`npm run e2e`)。⚠ **待っている側に `kagimaCall` が存在しないことを見る** |
| ブラウザ間 | ⚠ **2 人が、⚠ 我々が書いていない 2 つのエンジンのあいだで、映像と音声を双方向にやりとりできる** | W3C WebRTC(`RTCPeerConnection`)、Media Capture(`getUserMedia`) | ⚠ **ケース `chromium-to-firefox`**(`npm run external`)。⚠ **`framesDecoded` を両側で読む。⚠ `connectionState` では判定しない** |
| 接続の死活 | ⚠ **サーバが送ったハートビートに、⚠ 所定回数 有効な pong が返らなければ、⚠ その socket を `CLOSE_SILENT` で切る** | — | ⚠ **ケース `heartbeat`(`npm run check`)。⚠ 実測 2026-09-06: ⚠ 背面のタブが 453 秒のあいだ 26/26 答えた**([`adr/0020`](adr/0020-measure-the-message-heartbeat-in-shadow-before-trusting-it.md)) |
| ⚠ **Host の復帰** | ⚠ **ページが破棄されても、⚠ Host は同じルームに戻れる** | — | ⚠ **ケース `host-comes-back-to-a-thrown-away-page`**(`npm run e2e`)。⚠ **実測 2026-09-06: ⚠ 実機で 2 回とも戻った**([`adr/0021`](adr/0021-keep-one-room-key-on-the-device-and-nothing-else.md)) |
| ⚠ **Guest の復帰(socket)** | ⚠ **signalling の socket が落ちても、⚠ Guest のページは自分で張り直す。⚠ 直っているあいだ、⚠ 画面には何も出ない** | — | ⚠ **ケース `the-guest-comes-back`**(`npm run e2e`)。⚠ **パネルに `socket -> open` が出ること、⚠ そのあとルームを閉じると Guest に届くことを見る**([`adr/0029`](adr/0029-let-a-guest-come-back-with-a-mark-that-works-on-one-room.md)、[kagima#98](https://github.com/hidetzu/kagima/issues/98)) |
| ⚠ **同じものを見る** | ⚠ **画面を出せる端末では、⚠ 出した画面が 顔とは別の映像として 相手に届く。⚠ 顔は消えない。⚠ やめると 相手の画面からも消える** | W3C Media Capture(`getDisplayMedia`)、WebRTC(`RTCRtpSender.replaceTrack`、`RTCDataChannel`)、[RFC 8829](https://www.rfc-editor.org/rfc/rfc8829) § 5.10 | ⚠ **ケース `same-screen`**(`npm run e2e`)。⚠ **受け側の 共有用の `<video>` の `videoWidth` が 0 でないことを見る**(⚠ **`connectionState` でも track の有無でもない**)。⚠ **同じケースで、⚠ 顔の `videoWidth` が 0 にならないこと、⚠ 共有をやめると 受け側から消えることも見る**([`adr/0033`](adr/0033-share-a-screen-where-it-can-be-shared-and-point-over-a-data-channel.md))。⚠ **Chromium のみ。** ⚠⚠ **実サービス、⚠ 2026-09-10 の deploy 以降: ⚠ 実機で一度動かした。** ⚠ **Owner の報告は「⚠ 画面共有は出来そうだった」であり、⚠ その言葉のままである** — ⚠ **断定ではなく、⚠ パネルも記録も取っていない。** ⚠ **共有をやめたときに 相手側から消えるかは 報告に無い**(⚠ **報告に無いことは、⚠ 起きなかったことではない**) |
| ⚠⚠ **1 日の枠** | ⚠ **同時に開けるルームには上限があり、⚠ 達すると 新規作成だけが断られる。⚠ 開いているルームは切られない。⚠ 断られた人は 何をすればよいかを読む** | — | ⚠ **ケース `the-day`**(`npm run worker`)。⚠ **本物の Durable Object に対して、⚠ 上限ぶん作ってから断られること、⚠ 1 つ閉じると また作れること、⚠ 画面に出る文が どちらの文かを見る**([`adr/0031`](adr/0031-give-the-issuer-a-daily-budget-because-the-issuer-is-a-continuing-subject.md))。⚠⚠ **60 room-minutes / 20 room-hours は 検査が届いていない** — ⚠ **算術としてのみ(`test/ledger.test.ts`)であり、⚠ 実際に時間を使って確かめてはいない。** ⚠ **台帳が答えないときに断ることも 算術としてのみである。** ⚠⚠ **これは Cloudflare 上の配置についての主張であって、⚠ サインインが設定されていない配置には枠は無い** |
| ⚠⚠ **「ここ」と指す** | ⚠ **共有画面の上でも、⚠ 相手のカメラ映像の上でも 指せる。⚠ 指した先は 相手の同じ絵の 同じ場所に出る。⚠ 指を離すと 消える** | W3C WebRTC(`RTCDataChannel`) | ⚠ **ケース `over-here`**(`npm run e2e`)。⚠ **点が「出た」ではなく、⚠ 割合で 同じ場所に落ちたことを見る**(⚠ **両側の要素の大きさは違う**)。⚠ **面を取り違えていないこと、⚠ 離すと消えることも 同じケースで見る**([`adr/0033`](adr/0033-share-a-screen-where-it-can-be-shared-and-point-over-a-data-channel.md))。⚠ **座標は kagima のサーバを通らない ― ⚠ `RTCDataChannel` である**(⚠ **`test/no-media-on-the-server.test.ts` はこれを見ていない。⚠ 見ているのは 型と import である**)。⚠ **Chromium のみ。⚠ 実機では まだ一度も走らせていない** |
| ⚠ **手を離す** | ⚠ **カメラを切ると track が止まる(⚠ ランプが消える)。⚠ mute は track を止めず、⚠ `enabled = false` にする。⚠ どちらも 相手の画面に そう出る** | W3C Media Capture(`MediaStreamTrack.stop` / `enabled`)、WebRTC(`RTCDataChannel`) | ⚠ **ケース `hands-off`**(`npm run e2e`)。⚠ **切る前に掴んだ track の `readyState` が `ended` になること、⚠ mute では `live` のまま `enabled` だけが落ちることを見る**(⚠ **2 つを取り違えると どちらかが必ず落ちる**)。⚠ **相手側では、⚠ 顔の要素が隠れ、⚠ 文が出て、⚠ 戻すと frames がまた増えることを見る**([`adr/0033`](adr/0033-share-a-screen-where-it-can-be-shared-and-point-over-a-data-channel.md))。⚠ **Chromium のみ。** ⚠⚠ **実サービス、⚠ 2026-09-10 の deploy 以降: ⚠ camera の on / off は「⚠ 機能していた」**(⚠ Owner の報告であって、⚠ 取得した記録ではない)。⚠⚠ **ランプが消えたかどうかは 報告に無い** — ⚠ **「隠すのではなく track を止めた」を実機で裏づけるのは、⚠ その一点だけである。** ⚠ **mute の側も 報告に無い** |
| ⚠ **Guest の復帰(ページ)** | ⚠ **ページが破棄されても、⚠ 一度入れてもらった Guest は、⚠ Host がもう一度決めることなく同じルームに戻れる** | — | ⚠ **ケース `guest-comes-back-to-a-thrown-away-page`**(`npm run e2e`)。⚠ **扉が二度目に開かないこと、⚠ Host の画面が名前を出し続けることを見る**([`adr/0029`](adr/0029-let-a-guest-come-back-with-a-mark-that-works-on-one-room.md))。⚠ **実機 2026-09-08: ⚠ スマホを背面に置いてブラウザがページを捨て、⚠ 前面に戻すと自分で戻った。⚠ 短い 1 回と、⚠ 5 分の 1 回。⚠ どちらも Host 側の操作は要らなかった**(⚠ Owner の報告であって、⚠ パネルの取得ではない) |

## 2. 意図的に実装していないもの

⚠ **ここに名前を挙げた不在は決定である。** ⚠ **挙げていない不在は、ただの未着手である。**
⚠ **この二つは別物であり、その差は明示するものであって、におわせるものではない。**

⚠ **`PRODUCT.md` § 4 の非目標を写さないこと。** ⚠ **あそこは「作らないと決めた機能」、
ここは「実装が現に持っていない振る舞い」であり、主題が違う。**

| 実装していないもの | 意図的か | 理由 |
|---|---|---|
| ⚠ **合言葉による入室** | ⚠ **はい** | ⚠ **入口は Host の招待に変わった**([`adr/0017`](adr/0017-let-the-host-decide-who-comes-in-instead-of-a-passphrase.md))。⚠ **推測される秘密は存在しない** |
| TURN relay 経由の接続 | ⚠ **はい** | ⚠ **v0.1.0 は STUN のみで出す**([`adr/0013`](adr/0013-ship-v0-1-0-with-stun-only-and-say-so-when-it-does-not-reach.md))。⚠ **繋がらない組み合わせが存在することを受け入れた決定であって、⚠ 「STUN で足りる」という測定結果ではない。** ⚠ **割合は測っていない** |
| WebKit での動作 | ⚠ **いいえ** | ⚠ **拒否ではない。** ⚠ **一度も走らせていないだけである** |

## 3. 測った数字

⚠ **ここの数字はすべて、主張の母集団・測定日・条件を伴う**
([`../.claude/rules/evidence.md`](../.claude/rules/evidence.md))。
⚠ **効いてくるバージョン、環境の作り方、何回走らせたか、どのパーセンタイルか。**

⚠ **それらを伴わない数字は、直すのではなく消す。**

⚠ **他所が測った数字をここに書かないこと。** ⚠ **それは kagima についての測定ではない。**
⚠ **外部の公開値は [`DISCOVERY.md`](DISCOVERY.md) が、出所と参照日つきで持っている。**

> ⚠ **最初の行が入るとき、すべての行が共有する条件をここに一度だけ書くこと。**

| 何を測ったか | 値 | いつ | どの条件で |
|---|---|---|---|
| — | — | — | — |
