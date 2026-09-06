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
| ⚠⚠ `ROOM_GATE` | ⚠ **同じく `wrangler secret put`。** ⚠ **`user:secret`。** ⚠ **入れなければ 誰でもルームを作れる**([`adr/0024`](adr/0024-put-a-temporary-gate-in-front-of-making-a-room.md)) |
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

# 3-2. ⚠⚠ ルームを作るところの門(`adr/0024`)。⚠ `user:secret` の形で入れる
#      ⚠ 入れなければ 門は無い — ⚠ 誰でもルームを作れる
npx wrangler secret put ROOM_GATE

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

## ⚠ 出す前に決まっていないこと

- ⚠ **[kagima#78](https://github.com/hidetzu/kagima/issues/78)** — ⚠ **ノック待ちの polling が
  Free の requests を枯らしうる。** ⚠ **枯れると扉が応じなくなる。**
- ⚠ **Node 版をどうするか。** ⚠ **2 つの実装をいつまで並べるかは決めていない**
  (`CLAUDE.md` § 3)。

## ⚠ しないと決めた主張

- ⚠ **「Free で足りる」とは言わない。** ⚠ **言えるのは境界だけである。**
- ⚠ **「本番で動く」とも言わない。** ⚠ **`npm run worker` が確かめているのは
  ⚠ このマシンの workerd であって、⚠ Cloudflare のネットワークではない。**
