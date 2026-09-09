# Cloudflare に出す

- 日付: **2026-09-06**
- ⚠ **出すかどうかは Owner の判断である**([`PRODUCT.md`](PRODUCT.md) § 6 — ⚠ **継続的な
  running cost が発生する構成**)。⚠ **この文書は 手順 であって、⚠ 決定ではない。**

> ⚠⚠ **アカウント ID も、⚠ token も、⚠ ここには書かない。**
> ⚠ **このリポジトリは public である**([`../.claude/rules/git.md`](../.claude/rules/git.md))。
> ⚠ **`docs-check` の `no-cloudflare-account-in-the-repo` が、⚠ 書かれていないことを押さえる。**

---

## ⚠ 出さなくてもできること

```bash
npm run worker     # ⚠ wrangler dev --local + ブラウザ 2 つ。⚠ アカウント不要、⚠ 費用ゼロ
```

⚠ **`npm run check` / `e2e` / `external` / `worker` の 4 層は、⚠ 全部 アカウント無しで走る。**
⚠ **CI もそうである。**

## ⚠ 出すときに要るもの

| | ⚠ どこから来るか |
|---|---|
| ⚠ Cloudflare アカウント | ⚠ **Free でよい**([`adr/0022`](adr/0022-start-on-cloudflares-free-tier-with-one-durable-object-per-room.md)) |
| ⚠ **アカウント ID** | ⚠⚠ **環境変数 `CLOUDFLARE_ACCOUNT_ID`。** ⚠ **リポジトリには入れない** |
| ⚠ API token、⚠ もしくは `wrangler login` | ⚠ **同じく 環境から。** ⚠ **書かない** |
| ⚠ `JOIN_TOKEN_SECRET` | ⚠ **`wrangler secret put`。** ⚠ **`.env` にも書かない** |
| ⚠⚠ `GOOGLE_CLIENT_ID` | ⚠ **Google Cloud console の OAuth クライアント。** ⚠ **`wrangler secret put`** |
| ⚠⚠ `GOOGLE_CLIENT_SECRET` | ⚠ **同じ。** ⚠ **これが門を on にする** — ⚠ **入れなければ 誰でもルームを作れる**([`adr/0030`](adr/0030-let-the-host-sign-in-with-google-and-keep-the-guest-anonymous.md)) |
| ⚠⚠ `ALLOWED_EMAILS` | ⚠ **ルームを作ってよい人のアドレス、⚠ カンマ区切り。** ⚠ **空は 誰も通さない**(⚠ fail closed) |
| ⚠ `PUBLIC_BASE_URL` | ⚠ **`wrangler.toml` の `[vars]`、⚠ もしくは deploy 時に** |

## 手順

```bash
# 1. ⚠ アカウントを環境に置く(⚠ シェルの履歴に残らないやり方で)
export CLOUDFLARE_ACCOUNT_ID=…

# 2. ⚠ ログイン(⚠ ブラウザが開く)
npx wrangler login

# 3. ⚠⚠ 署名鍵を入れる。⚠ 既定値は無く、⚠ これからも作らない
#    (`../.claude/rules/security.md` § 6)
npx wrangler secret put JOIN_TOKEN_SECRET

# 3-2. ⚠⚠ ルームを作る人が名乗る先(`adr/0030`)
#      ⚠ 入れなければ 門は無い — ⚠ 誰でもルームを作れる
#      ⚠⚠ Google 側に redirect URI を登録すること: https://<出した先>/auth/google/callback
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# 3-3. ⚠⚠ ルームを作ってよい人(`adr/0030` 段階 1)。⚠ カンマ区切り
#      ⚠ 空は 誰も通さない。⚠ 「入れ忘れ = 誰でも」にはならない
npx wrangler secret put ALLOWED_EMAILS

# 4. ⚠ 出す
npx wrangler deploy
```

⚠ **`JOIN_TOKEN_SECRET` を入れないと、⚠ Durable Object は自分用の乱数を作る。**
⚠ **そのとき「object が置き換わるたびに、⚠ それが出した token は全部使えなくなる」**
(`src/room-object.ts` にそう書いてある)。

## ⚠ 出したあとに見るもの

⚠ **[`adr/0022`](adr/0022-start-on-cloudflares-free-tier-with-one-durable-object-per-room.md)
の境界は ⚠ **28.21 room-hours/day** である。**

```text
⚠ socketOpenMs が room-hours の分母である(⚠ ログに出ている)
⚠ 上限を超えると、⚠ 課金ではなく その種類の operation が失敗する(⚠ Owner、2026-09-06)
⚠ Paid 化は 実測が上限へ近づいてから
```

### ⚠⚠ 2 つめの Durable Object が増えた(⚠ 2026-09-09)

⚠ **[`adr/0031`](adr/0031-give-the-issuer-a-daily-budget-because-the-issuer-is-a-continuing-subject.md)
の台帳である。** ⚠ **`wrangler.toml` の binding は `LEDGER`、⚠ migration の tag は `v2`。**
⚠ **`npx wrangler deploy` が そのまま適用する** — ⚠ **手で流すものは無い。**

⚠ **ログに出る 2 行が、⚠ 枠が効いたことを言う:**

```text
a room was not opened   { why: "spent" | "busy" }   ⚠ 断った。⚠ 誰も、⚠ どの部屋かも言わない
the day's budget could not be reached               ⚠⚠ 台帳に届かず 断った(fail closed)
```

⚠⚠ **2 行目が続けて出るなら、⚠ 誰もルームを作れていない。**
⚠ **上限に達したのではなく、⚠ 台帳に届いていない** — ⚠ **`why` を見る。**

## ⚠⚠ 出すと、⚠ 通話中の socket が全部切れる

⚠ **実測 2026-09-06**([kagima#98](https://github.com/hidetzu/kagima/issues/98)):
⚠ **`npx wrangler deploy` の直後、⚠ Worker のログにこう出た。**

```text
✘ [ERROR] Error: This script has been upgraded.
          Please send a new request to connect to the new version.
```

⚠ **Durable Object が入れ替わり、⚠ 開いていた WebSocket が全部切れた。**

⚠ **落ちるのは socket であって、⚠ ルームでも通話でもない:**

```text
⚠ ルーム    ⚠ 残る。⚠ storage に書いてある(adr/0023、0025)
⚠ 通話      ⚠ 続く。⚠ メディアはブラウザ間で、⚠ 我々を通らない(adr/0010)
⚠⚠ socket  ⚠⚠ 切れる
```

### ⚠ いまは 両側が張り直す

⚠ **Host は [kagima#70](https://github.com/hidetzu/kagima/issues/70) から、
⚠ Guest は [kagima#98](https://github.com/hidetzu/kagima/issues/98) から。**
⚠ **直っているあいだ、⚠ 画面には何も出ない**(⚠ Owner 決定 2026-09-06)。
⚠ **パネルには `socket -> closed` と `socket -> open` が両方 残る** — ⚠ **黙って直すことと、
⚠ 何も起きなかったことにするのは別である。**

⚠ **張り直しには上限がある**(`src/client/reconnect.ts` の `RETRY_DELAYS_MS`)。
⚠ **入れ替えがそれより長くかかれば、⚠ 両側とも諦める。**

⚠⚠ **Owner 決定 2026-09-08: ⚠ これで足りるとする。**
⚠ **上限は伸ばさない**(⚠ `reconnect.ts` が「無限の再試行は我々と誰かの電池への攻撃である」と
自分で書いている)。⚠ **出す時刻の規則も置かない** — ⚠ **v0.1.0 には「いま通話があるか」を知る
手段が無く**(⚠ 部屋の数を持たない)、⚠ **守れているか確かめられない規則になるためである。**

⚠ **測っていないこと: ⚠ 本番の入れ替えに何秒かかるか。**
⚠ **`wrangler dev --local` で測れるのは このマシンの workerd であって、⚠ Cloudflare ではない。**
⚠ **実機で 1 回 出したとき、⚠ パネルの `socket -> closed` と `socket -> open` の差が その秒数である。**

### ⚠⚠ 落ちる前に知らせることは できない

⚠ **Cloudflare の公開文書は、⚠ deploy が既存の Durable Object と その WebSocket に何をするかを
書いていない**(⚠ 参照日 2026-09-08)。⚠ **予告する仕組みも書かれていない。**
⚠ **黙っている、ということである**(`../.claude/rules/evidence.md` § Silence is not permission)。

⚠ **我々が持っているのは、⚠ 起きたあとに出たエラー 1 行だけである。**
⚠ **so 「出す前に知らせる」は、⚠ いまのところ 実装できない。**

### ⚠ 出す前に訊く

⚠ **2026-09-06、⚠ AI が検証中に断りなく deploy し、⚠ 実測を 1 回ぶん壊した**
([kagima#96](https://github.com/hidetzu/kagima/issues/96) の観測が失われた)。
⚠ **deploy は毎回 Owner に訊く。** ⚠ **自動 deploy を入れるなら、⚠ この節が先に決まっている必要がある。**

## ⚠ 出す前に決まっていないこと

- ⚠ **Node 版をどうするか。** ⚠ **2 つの実装をいつまで並べるかは決めていない**
  (`CLAUDE.md` § 3)。

## ⚠ しないと決めた主張

- ⚠ **「Free で足りる」とは言わない。** ⚠ **言えるのは境界だけである。**
- ⚠ **「本番で動く」とも言わない。** ⚠ **`npm run worker` が確かめているのは
  ⚠ このマシンの workerd であって、⚠ Cloudflare のネットワークではない。**
