# 0003. 外部公開は Cloudflare Tunnel で HTTP と WebSocket だけを通す

- 状態: **決定**
- 日付: 2026-09-04

## 決定

⚠ **家庭内の PC を外へ出す経路は Cloudflare Tunnel とし、そこを通すのは
HTTP(画面と API)と WebSocket(signaling)だけとする。**

⚠ **映像と音声は Tunnel を通らない。** ⚠ **通す設計を検討もしない。**

⚠ **ルーターのポート開放は要求しない。**

## 文脈

- ⚠ **`PRODUCT.md` の前提として、自宅ルーターのポート開放を利用者にも Owner にも求めない。**
- ⚠ **Tunnel を映像に使うのは、規格の選択を逆にすることである。**
  ⚠ **WebSocket は到達と順序を保証する代わりに遅延を足す。**
  ⚠ **WebRTC は逆に、パケットが落ちることを受け入れて遅延を捨てる。**
  ⚠ **前者で後者を運ぶと、遅延と輻輳が両方悪化する。**
- ⚠ **メディアが Tunnel を通らないことは、[`0001`](0001-keep-media-peer-to-peer-and-off-our-servers.md)
  の帰結でもある。** ⚠ **通れば、それは我々の経路を通ったということである。**

## 却下した案

| 案 | ⚠ 却下の理由 |
|---|---|
| **Tunnel を映像配信のパイプとしても使う** | ⚠ **上記のとおり規格が噛み合わない。** ⚠ **`PRODUCT.md` が明示的に禁じてもいる** |
| **ルーターのポートを開ける** | ⚠ **前提に反する。** ⚠ **家庭内 LAN を直接晒すことにもなる** |
| **VPS を借りて置く** | ⚠ **継続コストが発生する。Owner 判断であり、いま訊く段階でもない** |
| **Tunnel をやめて全部 Cloudflare 上に載せる** | ⚠ **[`0002`](0002-serve-web-and-signaling-from-one-typescript-process.md) と噛み合わない。継続コストの話にもなる** |

## ⚠ 越えてはならない境界

```text
Tunnel を通るのは HTTP と WebSocket だけである
Tunnel の資格情報はコミットしない(.claude/rules/security.md § 6)
Tunnel が落ちたときに、動いている通話が落ちない設計にする
  ⚠ signaling が切れても、確立済みの P2P は続く。⚠ その前提を壊さないこと
```

## ⚠ 分かっていること、分かっていないこと

- ⚠ **Cloudflare の WebSocket には、無通信が続くと切られるアイドルタイムアウトがある。**
  ⚠ **したがってアプリ側の heartbeat が必須である。**
  ⚠ **具体的な秒数を Cloudflare は公開していない**
  ([`../DISCOVERY.md`](../DISCOVERY.md) § 3 に出典と参照日)。
- ⚠ **cloudflared を止めると、張っている WebSocket は落ちる。**
  ⚠ **再接続を実装するのは我々である。**
- ⚠ **「Tunnel があれば繋がる」とは言わない。**
  ⚠ **Tunnel は signaling を届けるだけで、メディアの NAT 越えには何もしない**
  ([`../DISCOVERY.md`](../DISCOVERY.md) § 2)。

## 影響

- ⚠ **開発環境と本番環境で、WebSocket の切れ方が違う。**
  ⚠ **localhost で切れないことは、Tunnel 越しで切れないことの証拠にならない。**
  ⚠ **heartbeat と再接続は、Tunnel 越しで確認しないと確認したことにならない。**
