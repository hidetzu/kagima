// ⚠⚠ **The build** (`docs/adr/0016`).
//
// ⚠ **kagima had no build step, ⚠ and that was the middle of `docs/adr/0002`.**
// ⚠ **The move to Workers takes it away** (`docs/adr/0015`) — ⚠ **`node:module` does not exist
//   ⚠ there, ⚠ so the transform cannot happen while answering a request.**
//
// ## ⚠ Why this brings in nothing new
//
// ⚠ **The transform is the one already used** — ⚠ **Node's own `stripTypeScriptTypes`.**
// ⚠ **It has moved from request-time to build-time and nothing else changed.**
// ⚠ **No bundler, ⚠ no new dependency, ⚠ no configuration.** ⚠ **`docs/adr/0016` allows a second
//   ⚠ build system; ⚠ it does not require one.**
//
// ## ⚠ What is now a claim rather than a fact
//
// ⚠ **Source and what the browser runs are two files now.** ⚠ **`docs/adr/0016` names the wall:
//   ⚠ the final gate runs against the built output, ⚠ not against the source.**
// ⚠ **`npm run e2e` builds first.** ⚠ **A stale `dist/` cannot pass it.**
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");

/** ⚠ **What the browser is allowed to load.** ⚠ A closed list, ⚠ like `src/static.ts`'s. */
const SOURCES = [
  "src/client/host.ts",
  "src/client/guest.ts",
  "src/client/call.ts",
  "src/client/reconnect.ts",
  "src/client/lifecycle.ts",
  "src/client/remember.ts",
  "src/client/transport.ts",
  "src/client/diagnostics.ts",
  "src/status/status.ts",
  "src/diagnostics/report.ts",
  "src/call/restart.ts",
  "src/signaling/protocol.ts",
];

/**
 * ⚠ **Rewrites `./x.ts` to `./x.js`.**
 *
 * ⚠ **The browser is given a file whose name ends in `.js`, ⚠ so its imports must too.**
 * ⚠ **Only relative specifiers are touched** — ⚠ **there is nothing else to touch, ⚠ and the
 * check `no-bare-imports-in-the-browser` says so.**
 */
const rewriteImports = (code: string): string =>
  code.replace(/(from\s+")(\.[^"]*?)\.ts(")/g, "$1$2.js$3");

/**
 * ⚠⚠ **The pages, ⚠ copied rather than transformed** (`docs/adr/0016`).
 *
 * ⚠ **They are HTML; ⚠ there is nothing to strip.** ⚠ **They are copied because a Worker's
 * Assets binding serves one directory, ⚠ and everything the browser loads has to be in it.**
 * ⚠ **Node still reads `public/` directly** — ⚠ **the route map says so** (`src/assets.ts`).
 */
const PAGES = ["public/index.html", "public/room.html"];

export const build = (): readonly string[] => {
  rmSync(OUT, { recursive: true, force: true });
  const written: string[] = [];

  for (const page of PAGES) {
    const target = join(OUT, page.replace(/^public\//, ""));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(ROOT, page), "utf8"));
    written.push(relative(ROOT, target));
  }
  for (const source of SOURCES) {
    const raw = readFileSync(join(ROOT, source), "utf8");
    const js = rewriteImports(stripTypeScriptTypes(raw, { mode: "strip" }));
    const target = join(OUT, source.replace(/^src\//, "").replace(/\.ts$/, ".js"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, js);
    written.push(relative(ROOT, target));
  }
  return written;
};

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const written = build();
  // ⚠ The count is announced here, at the moment it runs (`.claude/rules/evidence.md`).
  console.log(`build: ${written.length} files into dist/`);
  for (const f of written) console.log(`  ${f}`);
  void readdirSync;
}
