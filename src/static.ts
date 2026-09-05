// Serving the browser's side of kagima.
//
// ⚠ **There is no build step** (`docs/adr/0002`). ⚠ **Node strips the types on the way out**
//   (`module.stripTypeScriptTypes`), ⚠ **so `src/client/*.ts` is what the browser loads and what
//   ⚠ `tsc` checks.** ⚠ **One file, not a source and a build output that can drift.**
//
// ⚠ **That API is experimental.** ⚠ **Saying so is not the same as it being fine** — ⚠ **if it
//   ⚠ changes, this breaks loudly at startup rather than quietly at runtime, and the alternative
//   ⚠ (a bundler) is a second build system and needs an ADR.**
//
// ## ⚠ What may be served, and why the list is closed
//
// ⚠ **Only files under `public/` and `src/client/`, and only by an exact name from a fixed map.**
// ⚠ **No path is ever built from what the caller sent** — ⚠ **that is how a path traversal starts,
//   ⚠ and the caller here is anyone at all.**
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
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
  ["/client/host.ts", { file: "src/client/host.ts", type: "text/javascript; charset=utf-8" }],
  ["/client/guest.ts", { file: "src/client/guest.ts", type: "text/javascript; charset=utf-8" }],
  [
    "/client/diagnostics.ts",
    { file: "src/client/diagnostics.ts", type: "text/javascript; charset=utf-8" },
  ],
  ["/status/status.ts", { file: "src/status/status.ts", type: "text/javascript; charset=utf-8" }],
  [
    "/diagnostics/report.ts",
    { file: "src/diagnostics/report.ts", type: "text/javascript; charset=utf-8" },
  ],
  ["/client/call.ts", { file: "src/client/call.ts", type: "text/javascript; charset=utf-8" }],
  [
    "/client/transport.ts",
    { file: "src/client/transport.ts", type: "text/javascript; charset=utf-8" },
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

export const isServedPath = (pathname: string): boolean =>
  SERVED.has(pathname) || ROOM_PAGE.test(pathname);

export const serveStatic = (pathname: string, res: ServerResponse): boolean => {
  const entry = SERVED.get(pathname) ?? (ROOM_PAGE.test(pathname) ? ROOM_PAGE_FILE : undefined);
  if (entry === undefined) return false;

  const raw = readFileSync(join(ROOT, entry.file), "utf8");
  // ⚠ TypeScript out, JavaScript in. ⚠ The browser never sees a type annotation, and there is
  //   ⚠ no build output to go stale against the source.
  const body = entry.file.endsWith(".ts") ? stripTypeScriptTypes(raw, { mode: "strip" }) : raw;

  res.writeHead(200, {
    "content-type": entry.type,
    // ⚠ Nothing here is a secret, but nothing here is stable either while v0.1.0 moves.
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
  return true;
};
