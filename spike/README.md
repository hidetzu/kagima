# spike — ⚠ 測るためだけに在る

⚠ **これは移植先の Worker ではない。** ⚠ **問いに答え、⚠ 答え終わったら消える。**

⚠ **`docs/adr/0005` と [kagima#47](https://github.com/hidetzu/kagima/issues/47) は未決であり、
⚠ spike が黙って本番になるのは、⚠ 未決の問いが事故で答えられる形である。**

## 動かし方

```bash
cd spike && ../node_modules/.bin/wrangler dev --local --port 8799
```

⚠ **`--local` だけ。** ⚠ **アカウントは要らず、⚠ deploy はせず、⚠ 費用は発生しない。**

| 経路 | 何を聞くか |
|---|---|
| `/q/token` | join token(Web Crypto HMAC)が無改変で動くか |
| `/q/random` | `src/random.ts` の CSPRNG が動くか |
| `/q/authorize` | ハンドシェイクの規則が無改変で動くか |
| `/q/timers` | `setInterval` が request handler の中で使えるか |
| `/api/echo` | ⚠ **サーバ側 WebSocket に何ができるか**(⚠ `what-can-you-do` を送る) |

⚠ **測った結果は
[`docs/adr/0015`](../docs/adr/0015-put-the-service-on-cloudflare-after-three-things-are-settled.md)
§ 測った にある。** ⚠ **数はここに書かない**([`.claude/rules/evidence.md`](../.claude/rules/evidence.md))。
