// Serving the browser's side of kagima.
//
// ⚠ **The browser is served `dist/`, ⚠ not `src/`** (`docs/adr/0016`).
// ⚠ **`npm run build` strips the types once, ⚠ ahead of time.** ⚠ **Nothing is transformed while
//   ⚠ answering a request** — ⚠ **`node:module` does not exist in a Worker, ⚠ and that is what
//   ⚠ took the choice away** (`docs/adr/0015`).
//
// ⚠ **What this cost: ⚠ the source and what the browser runs are two files now, ⚠ and two files
//   ⚠ can drift.** ⚠ **`docs/adr/0016` names the wall — ⚠ the final gate runs against the built
//   ⚠ output, ⚠ and both gate runners build before they run.**
// ⚠ **A source-reading check is a claim about the input, ⚠ never about the output.**
//
// ## ⚠ What may be served, and why the list is closed
//
// ⚠ **Only files under `public/` and `dist/`, and only by an exact name from a fixed map.**
// ⚠ **No path is ever built from what the caller sent** — ⚠ **that is how a path traversal starts,
//   ⚠ and the caller here is anyone at all.**
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ⚠ **The whole of what is public.** ⚠ **A closed map, not a directory walk.**
 *
 * ⚠ **A directory walk would serve whatever is put in the directory next**, ⚠ **including the
 * thing somebody drops there by accident.**
 */
const SERVED: ReadonlyMap<string, { readonly file: string; readonly type: string }> = new Map([
  ["/", { file: "public/index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "public/index.html", type: "text/html; charset=utf-8" }],
  ["/client/host.js", { file: "dist/client/host.js", type: "text/javascript; charset=utf-8" }],
  ["/client/guest.js", { file: "dist/client/guest.js", type: "text/javascript; charset=utf-8" }],
  [
    "/client/diagnostics.js",
    { file: "dist/client/diagnostics.js", type: "text/javascript; charset=utf-8" },
  ],
  ["/status/status.js", { file: "dist/status/status.js", type: "text/javascript; charset=utf-8" }],
  [
    "/diagnostics/report.js",
    { file: "dist/diagnostics/report.js", type: "text/javascript; charset=utf-8" },
  ],
  ["/client/call.js", { file: "dist/client/call.js", type: "text/javascript; charset=utf-8" }],
  [
    "/client/transport.js",
    { file: "dist/client/transport.js", type: "text/javascript; charset=utf-8" },
  ],
]);

/**
 * ⚠ **The one path that is not a fixed name: a room's page.**
 *
 * ⚠ **It still builds nothing from what the caller sent.** ⚠ **The pattern is matched, and one
 * fixed file is served** — ⚠ **the room id is never touched again on this side.**
 * ⚠ **The page reads the id out of its own URL; ⚠ the server does not need to know it here.**
 */
const ROOM_PAGE = /^\/r\/[0-9a-z]{16}$/;
const ROOM_PAGE_FILE = { file: "public/room.html", type: "text/html; charset=utf-8" } as const;

/**
 * ⚠ **Which served files are not on disk.** ⚠ **Read at startup, ⚠ never while answering.**
 *
 * ⚠ **Grounds: a missing `dist/` is not a runtime condition ⚠ but a build that did not run**
 * (`docs/adr/0016`). ⚠ **It must break loudly, at startup, naming what to do** —
 * ⚠ **not quietly, on one request, as a stack trace a stranger reads** (`CLAUDE.md` § 4).
 */
export const missingServedFiles = (): readonly string[] =>
  [...new Set([...SERVED.values(), ROOM_PAGE_FILE].map((e) => e.file))]
    .filter((file) => !existsSync(join(ROOT, file)))
    .sort();

export const isServedPath = (pathname: string): boolean =>
  SERVED.has(pathname) || ROOM_PAGE.test(pathname);

/**
 * ⚠ **A `Response`, ⚠ or `null` when the path is not one of ours** (`docs/adr/0015`).
 *
 * ⚠ **Returning a `Response` rather than writing to a Node object is what lets the same routing
 * run in a Worker** — ⚠ **and it keeps one implementation rather than two** (`CLAUDE.md` § 3).
 */
export const serveStatic = (pathname: string): Response | null => {
  const entry = SERVED.get(pathname) ?? (ROOM_PAGE.test(pathname) ? ROOM_PAGE_FILE : undefined);
  if (entry === undefined) return null;

  // ⚠⚠ **Read as it is.** ⚠ **Nothing is transformed while answering a request** (`docs/adr/0016`).
  //
  // ⚠ **`dist/` is written by `npm run build`, ⚠ and `npm run e2e` builds first** — ⚠ **so a
  //   ⚠ stale one cannot pass the final gate.**
  // ⚠ **The pages still come straight from `public/`: ⚠ they are HTML and need no transform.**
  const body = readFileSync(join(ROOT, entry.file), "utf8");

  return new Response(body, {
    headers: {
      "content-type": entry.type,
      // ⚠ Nothing here is a secret, but nothing here is stable either while v0.1.0 moves.
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
};
