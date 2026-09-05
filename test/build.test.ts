// ⚠⚠ **The walls around having a build step at all** (`docs/adr/0016`).
//
// ⚠ **kagima had no build step, ⚠ and the reason was that a source and a build output can drift**
//   (`docs/adr/0002`). ⚠ **Workers took the choice away** (`docs/adr/0015`).
// ⚠ **So the drift is now real, ⚠ and these are what stand in front of it.**
//
// ## ⚠ What these cases are, and what they are not
//
// ⚠ **Every case here reads source.** ⚠ **So every case here is a claim about the input**, and
//   ⚠ **not one about what the browser was actually served** (`docs/adr/0016`).
// ⚠ **The claim about the output is the final gate, ⚠ and it builds before it runs.**
// ⚠ **Neither replaces the other.**
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "../scripts/build.ts";
import { isServedPath } from "../src/static.ts";
import { codeOf } from "./source-text.ts";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("⚠⚠ both gates build before they run, so neither can measure a stale dist/", () => {
  for (const runner of ["scripts/e2e.ts", "scripts/external.ts"]) {
    const code = codeOf(read(runner));

    const built = code.indexOf("build()");
    const spawned = code.indexOf("spawnSync(");

    assert.notEqual(
      built,
      -1,
      `${runner} never calls build() — ⚠ it would run against a stale dist/`,
    );
    assert.notEqual(
      spawned,
      -1,
      `${runner} no longer spawns the run — ⚠ this check has gone stale`,
    );
    assert.ok(
      built < spawned,
      `${runner} builds after it runs — ⚠ the gate would measure the previous build`,
    );
  }
});

test("⚠ nothing the browser is served is read out of src/", () => {
  // ⚠ Reading `src/` at request time is the thing `docs/adr/0016` moved away from.
  //   ⚠ It cannot work in a Worker, ⚠ and one route quietly doing it would only be found there.
  const code = codeOf(read("src/static.ts"));
  const files = [...code.matchAll(/file:\s*"([^"]+)"/g)].map((m) => m[1] ?? "");

  assert.ok(files.length > 0, "no served files found — ⚠ this check has gone stale");
  for (const file of files) {
    assert.ok(
      file.startsWith("public/") || file.startsWith("dist/"),
      `"${file}" is served from neither public/ nor dist/ (docs/adr/0016)`,
    );
  }
});

test("⚠⚠ every module the pages import is one the build writes and the server serves", () => {
  // ⚠⚠ **This is the drift a build step buys.** ⚠ **The pages ask for `/client/guest.js`; ⚠ the
  //   ⚠ build writes `dist/client/guest.js`; ⚠ the route table maps one to the other.**
  // ⚠ **Three lists, ⚠ and nothing but this makes them agree.**
  // ⚠ **A page importing a name nobody writes is a blank screen, ⚠ and `tsc` cannot see it** —
  //   ⚠ **the import lives inside HTML.**
  const written = new Set(build().map((f) => f.replace(/^dist\//, "/")));

  let checked = 0;
  for (const page of ["public/index.html", "public/room.html"]) {
    const html = read(page);
    for (const match of html.matchAll(/from\s+"(\/[^"]+)"/g)) {
      const specifier = match[1] ?? "";
      checked++;
      assert.ok(
        written.has(specifier),
        `${page} imports "${specifier}", which the build never writes`,
      );
      assert.ok(
        isServedPath(specifier),
        `${page} imports "${specifier}", which the server never serves`,
      );
    }
  }
  // ⚠ Never assert zero imports and call it a pass (`.claude/rules/evidence.md`).
  assert.ok(checked > 0, "no imports found in the pages — ⚠ this check has gone stale");
  console.log(`  observed: ${checked} imports across 2 pages, all built and all served`);
});
