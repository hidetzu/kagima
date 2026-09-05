# kagima

> 合言葉で、ひとときだけ開くプライベート空間

アカウントを作らず、一時的なルームを作る。URL と合言葉の両方を知っている人だけが入れる。
最初のユースケースは、2人がカメラとマイクで会話することである。

⚠ **プロダクトの正本は [`docs/PRODUCT.md`](docs/PRODUCT.md) である。**
⚠ **v0.1.0 で何を作り、何を作らず、何を約束するかは、そこにしか書かれていない。**
⚠ **この README にも `CLAUDE.md` にも写していない。**

## いまの状態

⚠ **アプリケーションのコードはまだ存在しない。**
現時点でこのリポジトリにあるのは、AI 開発基盤と、ドキュメントと、決定の記録だけである。

⚠ **このリポジトリは public である。** ⚠ **その前提ですべてが書かれている**
([`.claude/rules/security.md`](.claude/rules/security.md))。

## 中身

```text
CLAUDE.md                    どう働くか(English)
package.json                 ⚠ npm run check の入口。⚠ ビルドステップは無い
scripts/                     check runner(⚠ Node が .ts をそのまま実行する)
test/                        unit
docs/
  PRODUCT.md                 ⚠ プロダクトの正本。何を作り、何を作らないか
  SPEC.md                    今日なにを主張してよいか(⚠ 実装がないので空)
  DISCOVERY.md               ⚠ まだ決まっていない技術的不確実性と、候補の比較
  FIELD-TEST.md              ⚠ 実機・別ネットワークで何が起きるかを観測する手順(kagima#16)
  adr/                       なぜそう決めたか。⚠ 却下した案と、越えてはならない境界
.claude/                     どう書くか、どう検証するか(English)
  rules/                     エンジニアリング上の拘束。⚠ 最初の1行目から効く
  skills/                    issue-ready / issue-work / verify / change-review / loop-controller
  hooks/telemetry.mjs        ⚠ 作業がどう渡され、どう終わったかの記録。⚠ git には入らない
  tools/                     docs-check(ドキュメントを自分の言い分に縛る) / telemetry-eval
```

## 検査

```bash
npm run check                                  # 型 / lint / format / unit
npm run check -- --list                        # ⚠ 名前を並べるだけ。何も実行しない
npm run check -- --only=types                  # 1 ケースだけ

node .claude/tools/docs-check.mjs              # ドキュメントを自分の言い分に縛る
node .claude/tools/docs-check.mjs --list       # ⚠ 同上
node .claude/tools/docs-check.mjs --only=links # 1 ケースだけ
```

⚠ **`.claude/` は `lint` と `types` の対象外である。** ⚠ **上流と diff が取れる状態を保つため**
(⚠ **`docs-check` が代わりに縛っている**)。

CI(`.github/workflows/ci.yml`)は fast tier を走らせ、⚠ **走らせなかった tier を毎回の
run summary に書く。** ⚠ **緑のチェックは、走った行についての証拠でしかない。**

観測(⚠ **採点ではない**):

```bash
node .claude/tools/telemetry-eval.mjs   # 作業がどう渡され、どう終わったか
node .claude/tools/label-eval.mjs       # ⚠ 誰が ready-for-ai を貼ったか
```

⚠ **件数はこれ自身が実行時に言う。** ⚠ **ドキュメントには書かない**
([`.claude/rules/evidence.md`](.claude/rules/evidence.md))。

⚠ **これはこのプロジェクトの検証ではない。**
⚠ **検証は [`.claude/skills/verify/SKILL.md`](.claude/skills/verify/SKILL.md) が持つ。**
⚠ **その § 1 に、いま存在する検査と存在しない検査が書いてある。**

## 開発の進め方

```text
issue-ready  ->  ⚠ AI が根拠を残して ready-for-ai を貼る  ->  loop-controller
                                                                 |
                       inner verify -> final verify -> mutation check
                                                                 |
                           change-review  ->  PR  ->  CI  ->  ⚠ Owner が merge を承認 -> merge
```

- ⚠ **`ready-for-ai` は AI が貼る。** ⚠ **ただし条件つきであり、外すことはしない**
  ([`docs/adr/0006`](docs/adr/0006-let-the-ai-apply-ready-for-ai-and-gate-on-merge-instead.md))。
- ⚠ **人間のゲートは merge の 1 つだけである。** ⚠ **0 にはしない。**
- ⚠ **Owner 判断が要るものは `needs-decision` として整理し、それ以外を先に進める**
  ([`docs/PRODUCT.md`](docs/PRODUCT.md) § 6)。

---

## テンプレートからの移植

`.claude/` は [`hidetzu/claude-dev-template`](https://github.com/hidetzu/claude-dev-template)
の移植である(⚠ **2026-09-04 時点の内容を調査**)。

⚠ **全部は持ってきていない。** ⚠ **そして、持ってこなかったものには理由を書いてある。**
⚠ **理由の書いてある不在は決定であり、書いていない不在はただの未着手である。**

### 移植したもの

| 何 | どう扱ったか |
|---|---|
| `rules/evidence.md` | ⚠ **原文のまま + kagima の 2 行を追加**(⚠ 追加のみ。⚠ **削除は禁じられている**) |
| `rules/verification.md` | 原文のまま |
| `rules/git.md` | ⚠ **乖離あり。** Loop Controller の例外から merge を外した([`docs/adr/0006`](docs/adr/0006-let-the-ai-apply-ready-for-ai-and-gate-on-merge-instead.md)) |
| `rules/owner-decisions.md` | ⚠ **乖離あり。** 移植しなかった仕組みへの参照を外し、⚠ **`ready-for-ai` 節を書き直し**([`docs/adr/0006`](docs/adr/0006-let-the-ai-apply-ready-for-ai-and-gate-on-merge-instead.md))、⚠ **優先順位の例外を 1 組だけ足した**([`docs/adr/0008`](docs/adr/0008-let-product-md-outrank-an-issues-acceptance-criteria.md)) |
| `rules/README.md` | kagima 用に書き直し(索引なので) |
| `skills/issue-work` | 原文のまま |
| `skills/change-review` | 原文のまま。⚠ FILL IN を埋めた |
| `skills/issue-ready` / `skills/loop-controller` | ⚠ **乖離あり。** ラベル付与の自律化と、人間ゲートの merge への移動([`docs/adr/0006`](docs/adr/0006-let-the-ai-apply-ready-for-ai-and-gate-on-merge-instead.md))。⚠ `issue-ready` は第 8 項の例外も([`docs/adr/0008`](docs/adr/0008-let-product-md-outrank-an-issues-acceptance-criteria.md)) |
| `hooks/telemetry.mjs` / `tools/telemetry-eval.mjs` / `telemetry-dir.mjs` | 原文のまま |
| `tools/docs-check.mjs` | ⚠ **kagima 用のケースを足した**(`env-example-has-no-values` / `ready-for-ai-label-line`) |
| `docs/SPEC.md` / `docs/adr/README.md` | 骨組みを引き継ぎ、日本語で書き直した |

⚠ **`.claude/` を英語のままにしているのは意図である。**
⚠ **上流と diff が取れる状態を保ち、改善を送り返せるようにするため**
([`.claude/rules/README.md`](.claude/rules/README.md) § Language に根拠がある)。

⚠ **「乖離あり」の 4 ファイルは、上流へ送り返す候補である**
(⚠ **ただし、この形が実際に回ってから。一般的に聞こえることではなく、動いたことが根拠になる**)。

### kagima が自分で書いたもの

| 何 | なぜ |
|---|---|
| [`.claude/rules/security.md`](.claude/rules/security.md) | ⚠ **守る対象がプロダクトそのものだから。** ⚠ **根拠はコードが 1 行も無い時点で成立している** |
| [`.claude/skills/verify/SKILL.md`](.claude/skills/verify/SKILL.md) | ⚠ **テンプレートは意図的に同梱していない。** ⚠ **契約は移植でき、コマンドは移植できない** |
| `.claude/ready-for-ai-label.mjs` / `tools/ready-for-ai.mjs` | ⚠ **ラベル付与と記録を 1 ステップにする。** ⚠ **毎回思い出す規則は規則ではなく願望だから** |
| `tools/label-eval.mjs` | ⚠ **「誰が `ready-for-ai` を貼ったか」を観測する。** ⚠ **Owner 分は引き算であり、推定だと出力に毎回書く** |

### ⚠ 移植しなかったもの

| 何 | 意図的か | 理由 |
|---|---|---|
| **`hooks/ask-slack.mjs` / `slack-doctor.mjs` / `.envrc.example`** | ⚠ **はい** | ⚠ **Owner は同じ端末にいる。`AskUserQuestion` はそのまま届く。** ⚠ **いま Slack を挟んでも、増えるのは管理すべき資格情報だけである** |
| **`skills/visual-decision`** | ⚠ **はい、ただし当面** | ⚠ **v0.1.0 の画面は 3 つしかなく、見て決める判断がまだ発生していない。** ⚠ **テンプレート側も「2 ドメインで再現していない」と自分で記録している唯一の項目である。** ⚠ **見て決める判断が実際に出たら持ってくる** |
| **`skills/context-maintainer`** | ⚠ **いいえ** | ⚠ **拒否ではない。** ⚠ **テンプレート側にも入っていない**(上流 README § 3 が v0.2 候補として記録している) |
| **CI workflow** | ⚠ **はい、いまは** | ⚠ **走らせるものがまだ無い。** ⚠ **`npm run check` が生まれた時点で入れる** |
| **Issue / PR テンプレート** | ⚠ **はい** | ⚠ **`issue-ready` § 6 が、外部からの報告に 9 節を要求するなと言っている** |

⚠ **テンプレートと戦う羽目になったら、間違っているのはテンプレートのほうである。**
⚠ **そのときは上流を直し、どのプロジェクトで壊れたかを書くこと。**

## License

[MIT](LICENSE)
