# DISCOVERY — まだ決まっていないこと

⚠ **このファイルは「分かっていないことの一覧」である。** ⚠ **決まったものはここから消え、
[`adr/`](adr/) に移る。** ⚠ **ここに残っているものは、まだ決まっていない。**

⚠ **ここに書いてよいのは、調べた結果と、その出所と、いつ調べたかである。**
⚠ **推測を測定の顔で書かないこと**([`../.claude/rules/evidence.md`](../.claude/rules/evidence.md))。

⚠ **数字には必ず「誰が測ったか」を付ける。** ⚠ **このファイルにある数字のうち、kagima が
自分で測ったものは現時点でひとつもない。** ⚠ **すべて他所の公開値であり、kagima についての
主張ではない。**

- 調査日: **2026-09-04**
- 調査時点で kagima にコードは存在しない。⚠ **したがって実測はできていない。**

---

## 1. 不確実性の一覧

| # | 分かっていないこと | 決まらないと何が止まるか | 状態 |
|---|---|---|---|
| U1 | ⚠ **P2P だけで何割の相手とつながるか** | 中心体験そのもの。つながらなければ v0.1.0 は成立しない | ⚠ **実測待ち。** ⚠ **判断手順は Owner が決定済**(§ 2) |
| U2 | TURN を使うなら誰の TURN か | U1 の答え次第 | U1 に従属 |
| U3 | 制御プレーンの実行環境 | 実装の着手 | ⚠ **決定済** → [`adr/0002`](adr/0002-serve-web-and-signaling-from-one-typescript-process.md) |
| U4 | インターネット公開の経路 | 家庭内 PC から外に出せるか | ⚠ **決定済** → [`adr/0003`](adr/0003-expose-only-http-and-websocket-through-cloudflare-tunnel.md) |
| U5 | 合言葉の生成方式と、その強度 | Security の主張が書けない | ⚠ **未決**(§ 4) |
| U6 | ルームの寿命と、閉じ方の種類 | 「残さない」の意味が定まらない | ⚠ **一部決定** → [`adr/0005`](adr/0005-keep-room-state-in-process-memory-only.md)、残りは § 5 |
| U7 | ブラウザ間の相互運用 | 「会話できる」の denominator | ⚠ **未測定**(§ 6) |
| U8 | Raspberry Pi 等への展開 | 何も止まらない | ⚠ **v0.1.0 では測らない**(`PRODUCT.md` § 2) |

---

## 2. U1 — P2P だけで何割つながるか

### 分かっていること(⚠ すべて他所の測定)

| 値 | 誰の測定か | いつの値か |
|---|---|---|
| 消費者向け WebRTC セッションのおよそ 15〜20% が TURN を必要とする | [bloggeek.me](https://bloggeek.me/webrtcglossary/turn/) / [metered.ca](https://www.metered.ca/blog/what-is-a-turn-server-3/) の公開記事 | ⚠ **記事側が測定日を明示していない** |
| 会議のおよそ 22% が TURN relay を必要とした | 同上(数十億セッション分の集計として紹介されている) | ⚠ **同上** |
| 内訳は TURN/UDP 12.1%、TURN/TCP 5%、TURN/TLS 0.5% 未満 | 同上 | ⚠ **同上** |

- ⚠ **これらは kagima の数字ではない。** ⚠ **母集団も、ネットワーク環境も、我々のものではない。**
- ⚠ **測定日が示されていない値である。** ⚠ **引用するときは必ずそう書くこと。**
- ⚠ **「だいたい 2 割つながらない」と要約しないこと。** ⚠ **要約した瞬間に、他所の母集団の値が
  kagima についての測定に化ける。**

### 何が問題か

⚠ **kagima の中心体験は「Guest が Host と会話できること」である。**
⚠ **STUN だけの構成では、一定の割合の Guest がその体験に到達しない。**
⚠ **その割合が何%かは、我々は知らない。**

⚠ **そして TURN は継続的なランニングコストを発生させる。**
⚠ **これは `PRODUCT.md` § 6 で Owner 判断と明記されている項目である。**
⚠ **AI が勝手に決めてよい「明らかな Security 対策」ではない。**

### 選択肢

| 案 | つながらない Guest | コスト | 約束への影響 |
|---|---|---|---|
| A. STUN のみ | ⚠ **一定割合が到達しない。割合は未測定** | 0 | なし |
| B. Cloudflare Realtime TURN | ⚠ **relay で救われる** | $0.05/GB、⚠ **1,000 GB の無料枠**(SFU と TURN の合算、独立枠ではない) | ⚠ **relay は復号しない。約束は保たれる** |
| C. 自前 coturn | 同上 | ⚠ **サーバ費 + 運用。家庭内 PC では帯域も自分持ち** | 同上 |
| D. Cloudflare Realtime SFU | 同上 | ⚠ **SFU 経由になり、映像がサーバを通る** | ⚠ **約束に触れる。`PRODUCT.md` § 5** |

- ⚠ **D は却下済み。** ⚠ **理由は [`adr/0001`](adr/0001-keep-media-peer-to-peer-and-off-our-servers.md) にある。**
- ⚠ **A と B/C の差はコストであって、技術ではない。** ⚠ **だから Owner が決める。**

### ⚠ Owner が決めたこと(2026-09-04)

⚠ **以下は Owner の言葉であり、書き換えない。**

> メディアをKagimaのApplication Serverには中継させない。通常はWebRTCのdirect P2Pを優先する。
> NAT越えのために必要な場合はTURN relayを許容するか、実測後に別ADRで判断する。

⚠ **これで決まったのは「何を選ぶか」ではなく「どう決めるか」である。**

| 決まったこと | まだ決まっていないこと |
|---|---|
| ⚠ **Application Server にメディアを中継させない**(`adr/0001`。⚠ **動かない**) | ⚠ **TURN relay を許容するか** |
| ⚠ **通常は direct P2P を優先する** | ⚠ **許容する場合、誰の TURN か**(§ U2) |
| ⚠ **判断は実測後、別の ADR で行う** | — |

- ⚠ **TURN relay は Application Server ではない。** ⚠ **別の構成要素であり、別に判断される**
  ([`adr/0001`](adr/0001-keep-media-peer-to-peer-and-off-our-servers.md) § Owner による確認)。
- ⚠ **D(SFU)はこの判断の対象ではない。** ⚠ **却下済である。**

### ⚠ 決める前にやるべきこと

```text
1. hidetzu/kagima#9 で direct P2P (STUN のみ) を実装する
2. ⚠ 我々自身の環境で、実際に何割つながらないかを測る
3. ⚠ 測定条件を書く — どのネットワークから、何回、いつ
4. その数字を持って、別 ADR で判断する (hidetzu/kagima#16)
```

- MUST: ⚠ **順番を飛ばさない。** ⚠ **他所の 15〜20% を根拠に B を選ぶのは、
  推測を測定の顔で使うことである。**
- ⚠ **したがって U1 は「今すぐ Owner に訊く」ではない**
  ([`../.claude/rules/owner-decisions.md`](../.claude/rules/owner-decisions.md) —
  ⚠ **測れば決まることを訊かない**)。
- ⚠ **測定は「つながった/つながらない」の二値では足りない。**
  ⚠ **母集団(どのネットワークから何回)を書かない割合は、割合ではない。**

### Cloudflare TURN について調べたこと(B を選んだ場合に必要になる)

```text
接続先        turn.cloudflare.com
              UDP 3478(代替 53) / TCP 3478(代替 80) / TLS 5349(代替 443)
資格情報      POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers
              Authorization: Bearer $TURN_KEY_API_TOKEN
              body: {"ttl": <秒>}
              201 応答が iceServers(urls / username / credential)を返す
制限          allocation 単位:5〜10 kpps、50〜100 Mbps、>5 new IP/sec
```

- ⚠ **短命な資格情報をサーバ側で発行してブラウザに渡す形になる。**
  ⚠ **`TURN_KEY_API_TOKEN` がブラウザに出てはならない**
  ([`../.claude/rules/security.md`](../.claude/rules/security.md) § 6)。
- 出典: [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/)、
  [資格情報の生成](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
  (⚠ **2026-09-04 に参照**)。

---

## 3. U3 / U4 — 決定済みのものと、その比較

⚠ **結論は ADR にある。** ⚠ **ここに残すのは、比較そのものである**(⚠ **却下した案が
どこにも残らないと、同じ議論がもう一度起きる**)。

### 制御プレーンの実行環境

| 案 | 利点 | ⚠ 欠点 |
|---|---|---|
| ⚠ **TypeScript / Node 単一プロセス** | ブラウザ側と同じ言語。型を共有できる。Linux PC でも Pi でも動く | ⚠ **CPU 効率は最良ではない**(v0.1.0 の負荷では効かない) |
| Go 単一バイナリ | 配布が楽。Pi への展開が軽い | ⚠ **ブラウザ側と言語が割れる。** ⚠ **signaling のメッセージ型を二重に書くことになる** |
| Web と Signaling を分離 | それぞれ独立に動かせる | ⚠ **v0.1.0 の規模で分ける理由がない。** ⚠ **ルーム状態が二か所に出る** |

→ [`adr/0002`](adr/0002-serve-web-and-signaling-from-one-typescript-process.md)

### インターネット公開

| 案 | ⚠ 判断 |
|---|---|
| ⚠ **Cloudflare Tunnel(HTTP + WebSocket のみ)** | ⚠ **採用。** ルーター開放が要らない |
| Tunnel を映像にも使う | ⚠ **却下。** WebSocket は順序と到達を保証する代わりに遅延を足す。⚠ **WebRTC は逆を選ぶ規格である** |
| ポート開放 | ⚠ **却下。** `PRODUCT.md` の前提に反する |

⚠ **Tunnel 経由の WebSocket には、無通信が続くと切られるアイドルタイムアウトがある。**
⚠ **したがってアプリ側の heartbeat が必須である。** ⚠ **「たぶん切れない」で済ませないこと。**
出典: [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/)
(⚠ **2026-09-04 に参照。具体的な秒数は Cloudflare 側が明示していない**)。

→ [`adr/0003`](adr/0003-expose-only-http-and-websocket-through-cloudflare-tunnel.md)

---

## 4. U5 — 合言葉の強度(⚠ 未決)

⚠ **合言葉は人間が口で伝える。** ⚠ **だから短い。** ⚠ **だから合言葉自体は強くない。**
⚠ **強度を作っているのは合言葉ではなく、レート制限である**
([`../.claude/rules/security.md`](../.claude/rules/security.md) § 1, § 3)。

決まっていないこと:

```text
語彙をどこから取るか        日本語の語か、英単語か、数字混じりか
何語つなげるか              ⚠ 語数がそのままビット数を決める
正規化をどこまでやるか      ⚠ 大文字小文字・空白・Unicode 正規化は entropy を下げる
レート制限の値              ⚠ 何回で、どのくらい待たせるか
```

- MUST: ⚠ **決めたら「語彙数^語数 = 何ビット」を書くこと。** ⚠ **「推測困難」とだけ書かないこと。**
- ⚠ **正規化を入れるなら、入れたあとのビット数を書くこと。** ⚠ **入れる前の数字を残さないこと。**
- ⚠ **これは Owner 判断ではない。** ⚠ **調べて決めてよい。**
  ⚠ **ただし決めた根拠を [`adr/`](adr/) に残すこと。**

## 5. U6 — ルームの寿命(⚠ 一部未決)

⚠ **「永続化しない」は [`adr/0005`](adr/0005-keep-room-state-in-process-memory-only.md) で決まった。**
⚠ **残っているのはこれである。**

```text
誰も入らないまま放置されたルームは、いつ消えるか
Host が閉じずにタブを閉じたら、どうなるか
プロセスが再起動したら、動いているルームはどうなるか(⚠ 全部消える。それでよいか)
Guest が入ったあとに Host が落ちたら、Guest には何と表示されるか
```

- ⚠ **最後の一つは `CLAUDE.md` § 4-1 の問題でもある。**
  ⚠ **「接続できません」と「相手がまだ来ていません」と「合言葉が違います」を混ぜないこと。**
- ⚠ **これらは調べて決めてよい。** ⚠ **ただし「残さない」の意味を弱める答えは Owner 判断である。**

## 6. U7 — ブラウザ間の相互運用(⚠ 未測定)

⚠ **「会話できる」と言うためには、どのブラウザとどのブラウザで測ったのかを言う必要がある。**
⚠ **現時点で測っていないので、どのブラウザについても言えない。**

- ⚠ **これは [`../.claude/skills/verify/SKILL.md`](../.claude/skills/verify/SKILL.md) の
  External tier がやることである。** ⚠ **相手側は我々が書いていないものでなければならない。**
- ⚠ **Chromium だけで測って「ブラウザで動く」と書かないこと。**

## 7. U8 — Raspberry Pi(⚠ v0.1.0 では測らない)

⚠ **`PRODUCT.md` § 2 が「将来の方向であって計画ではない」と言っている。**
⚠ **v0.1.0 では測らないし、そのための抽象化も入れない。**

⚠ **ただし、後から不可能になる決定は避ける** — ⚠ **これが
[`adr/0002`](adr/0002-serve-web-and-signaling-from-one-typescript-process.md) が
「1プロセスで動くこと」を条件に含めている理由である。**
