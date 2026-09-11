// ⚠⚠ **画面に出る言葉に、⚠ こちらの記法を混ぜない** (`CLAUDE.md` § 4)。
//
// ⚠ **`⚠` は このリポジトリが「踏むと痛い」を指すために使う印であって、⚠ 製品の言葉ではない。**
// ⚠ **実機 2026-09-12: ⚠ Host の画面に「⚠ URL を相手に渡してください。」と出ていた** —
//   ⚠ **診断パネルの説明にも 2 か所あった。**
// ⚠ **コメントの中にあるぶんには 何も漏れていない。** ⚠ **so 読むのは、⚠ コメントと script と
//   ⚠ style を落としたあとの、⚠ 人の目に入る文字だけである。**
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const PAGES = ["public/index.html", "public/room.html"];

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** ⚠ **人の目に入るところだけ。** ⚠ コメント・script・style は そこではない。 */
const shownToAPerson = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "");

test("⚠⚠ 画面に出る言葉に ⚠ が混ざっていない", () => {
  let checked = 0;
  for (const page of PAGES) {
    const shown = shownToAPerson(read(page));
    checked += 1;
    const lines = shown
      .split("\n")
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => l.includes("⚠"));
    assert.deepEqual(
      lines.map(([n, l]) => `${page}:${n}: ${l.trim()}`),
      [],
      `${page} shows this project's own mark to a person`,
    );
  }
  // ⚠ ゼロ件を「合格」と言わない (`.claude/rules/evidence.md`)。
  assert.equal(checked, PAGES.length, "no page was read — ⚠ this check has gone stale");
  console.log(`  observed: ${checked} pages carry no ⚠ where a person can read it`);
});
