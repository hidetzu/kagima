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

test("⚠⚠ the Worker never decides anything a room decides", async () => {
  // ⚠⚠ **The whole point of the seam** (`CLAUDE.md` § 3).
  // ⚠ **`handle` knows about the door, the host key, the knock and the one answer.**
  // ⚠ **This file knows about bindings.** ⚠ **A rule that appeared here would be a second copy,
  //   ⚠ and the second copy is the one that drifts.**
  const code = codeOf(await readFile("src/worker.ts", "utf8"));

  for (const [what, pattern] of [
    ["the host key", /hostKey/],
    ["the door", /knock/i],
    ["tokens", /issueJoinToken|verifyJoinToken/],
    ["the room store", /createRoomStore/],
  ] as const) {
    assert.doesNotMatch(code, pattern, `the Worker decides something about ${what}`);
  }
});

test("⚠⚠ the room's name is minted before the room, and the collision check did not move", async () => {
  // ⚠ **A Durable Object is addressed by name** (`docs/adr/0022`), ⚠ **so the name comes first.**
  // ⚠ **That is the one thing this file does that Node does not** — ⚠ **and it must not become
  //   ⚠ a second id generator, ⚠ nor a second retry rule.**
  const code = codeOf(await readFile("src/worker.ts", "utf8"));

  assert.match(code, /generateRoomId\(\)/, "the Worker mints ids some other way");
  assert.match(code, /MAX_ID_ATTEMPTS/, "the Worker has its own retry count");
  assert.doesNotMatch(code, /randomToken\(/, "the Worker draws ids past the one seam");
  // ⚠ And the refusal it retries on is the one `handle` gives, ⚠ not a shape of its own.
  assert.match(code, /status !== 503/, "the Worker reads a refusal some other way");
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

test("⚠⚠ a caller cannot choose which room it is talking to", async () => {
  // ⚠⚠ **The room's name is set here, ⚠ overwriting whatever arrived** (`src/room-object.ts`).
  // ⚠ **Without that, ⚠ anyone could send a header and be handed another room's object** —
  //   ⚠ **and the object would believe it, ⚠ because only this file can reach it.**
  // ⚠ **A mutation that respected an incoming header passed every other check.**
  const { default: worker } = await import("../src/worker.ts");
  const { ROOM_HEADER } = await import("../src/room-object.ts");

  const asked: string[] = [];
  const env = {
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    ROOM: {
      idFromName: (name: string) => {
        asked.push(name);
        return name;
      },
      get: () => ({
        fetch: async (request: Request) =>
          new Response(JSON.stringify({ sawHeader: request.headers.get(ROOM_HEADER) }), {
            headers: { "content-type": "application/json; charset=utf-8" },
          }),
      }),
    },
  } as never;

  const forged = new Request("http://127.0.0.1:9096/api/rooms/aaaaaaaaaaaaaaaa/knock", {
    method: "POST",
    body: JSON.stringify({ nickname: "アン" }),
  });
  forged.headers.set(ROOM_HEADER, "bbbbbbbbbbbbbbbb");

  const answer = await worker.fetch(forged, env);
  const { sawHeader } = (await answer.json()) as { sawHeader: string };

  console.log(`  observed: the caller asked for bbbb…, the object was told ${sawHeader}`);
  assert.equal(sawHeader, "aaaaaaaaaaaaaaaa", "a caller chose the room by sending a header");
  assert.deepEqual(asked, ["aaaaaaaaaaaaaaaa"], "the object addressed was not the one in the path");
});
