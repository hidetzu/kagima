// ⚠⚠ **The Worker's entry, ⚠ read as source** (`docs/adr/0015`).
//
// ⚠ **What it does in workerd is not something a unit check can see.** ⚠ **What it must not
//   ⚠ lose is** — ⚠ **and one of those was lost and found on 2026-09-06.**
//
// ## ⚠ What was nearly traded away
//
// ⚠ **`src/assets.ts` is a closed map, ⚠ not a directory walk** — ⚠ **a walk serves whatever is
//   ⚠ put in the directory next.**
// ⚠ **A Worker's Assets binding IS a directory walk, ⚠ and by default it answers before the
//   ⚠ Worker does.** ⚠ **Measured: ⚠ `/room.html` redirected to `/room` and was served, ⚠ and
//   ⚠ neither path is in the map.**
// ⚠ **`run_worker_first` is what puts our code back in front.**
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isServedPath } from "../src/assets.ts";
import { codeOf } from "./source-text.ts";

test("⚠⚠ the Worker answers before the assets directory does", async () => {
  // ⚠ **Without this line the closed map is decoration.** ⚠ **The binding walks the directory,
  //   ⚠ and nothing kagima wrote gets a say.**
  const toml = await readFile("wrangler.toml", "utf8");
  const config = toml.replace(/^\s*#.*$/gm, "");

  assert.match(config, /run_worker_first\s*=\s*true/, "the assets binding would answer first");
  assert.match(config, /\[assets\]/, "there is no assets binding — this check has gone stale");
});

test("⚠⚠ a path the map does not name is not served", () => {
  // ⚠ **These are all real files in `dist/`.** ⚠ **Being a file is not being served.**
  for (const pathname of [
    "/room.html",
    "/room",
    "/client",
    "/client/",
    "/../wrangler.toml",
    "/status",
  ]) {
    assert.equal(
      isServedPath(pathname),
      false,
      `${pathname} is served and the map does not name it`,
    );
  }

  // ⚠ And the ones that are. ⚠ Never assert only the negative: ⚠ a map that serves nothing
  //   ⚠ would pass the half above.
  for (const pathname of ["/", "/index.html", "/client/host.js", "/r/abcdefghij123456"]) {
    assert.equal(isServedPath(pathname), true, `${pathname} is named and not served`);
  }
});

test("⚠ the Worker never reads a path the caller sent", async () => {
  // ⚠⚠ **How a path traversal starts** (`src/assets.ts`). ⚠ **The map names a file; ⚠ the binding
  //   ⚠ is asked for THAT file, ⚠ never for what arrived.**
  const code = codeOf(await readFile("src/worker.ts", "utf8"));

  assert.match(code, /servedPath\(/, "the Worker does not go through the map");
  // ⚠ The one thing handed to the binding is built from the map's own entry.
  assert.match(code, /entry\.file\.replace/, "the Worker builds the asset name some other way");
  assert.doesNotMatch(
    code,
    /ASSETS\.fetch\(request\)/,
    "the Worker hands the caller's own request to the assets binding",
  );
});

test("⚠ the Worker says what is not built yet, ⚠ rather than what is unavailable", async () => {
  // ⚠ `CLAUDE.md` § 4-1. ⚠ "not implemented yet" leaves a reason to come back; ⚠ "unavailable"
  //   ⚠ reads as something broken on the reader's side.
  const code = codeOf(await readFile("src/worker.ts", "utf8"));
  assert.match(code, /501/, "the API routes do not say they are not built yet");
  assert.match(code, /まだ動いていません/, "the wording does not say what it is");
});

test("⚠⚠ the Worker is platform-free about everything except its bindings", async () => {
  // ⚠ **It may reach for Cloudflare.** ⚠ **It may not reach for Node** — ⚠ **and it may not grow
  //   ⚠ its own copy of anything the core already answers** (`CLAUDE.md` § 3).
  const code = codeOf(await readFile("src/worker.ts", "utf8"));
  for (const [what, pattern] of [
    ["a node: module", /from\s+"node:/],
    ["the ws library", /from\s+"ws"/],
    ["process", /\bprocess\s*\./],
    ["the Node listener", /node-server/],
  ] as const) {
    assert.doesNotMatch(code, pattern, `the Worker reaches for ${what}`);
  }
});
