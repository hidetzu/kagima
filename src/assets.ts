// ⚠⚠ **What may be served, ⚠ and nothing about how to read it.**
//
// ⚠ **This half is the wall**: ⚠ **a closed map, ⚠ not a directory walk** — ⚠ **a walk would
//   ⚠ serve whatever is put in the directory next, ⚠ including the thing somebody drops there by
//   ⚠ accident.**
// ⚠ **No path is ever built from what the caller sent**, ⚠ **which is how a path traversal starts
//   ⚠ and the caller here is anyone at all.**
//
// ⚠ **It was inside `static.ts` until 2026-09-06, ⚠ where `node:fs` lived with it.**
// ⚠⚠ **A Worker cannot import that file, ⚠ and its Assets binding serves a whole directory** —
//   ⚠ **so without this split, ⚠ moving to Cloudflare would have quietly traded a closed map for
//   ⚠ a directory walk** (`docs/adr/0015`).
//
// ⚠ **Nothing here reaches for a platform.** ⚠ **Both sides read the same table.**

export type Served = { readonly file: string; readonly type: string };

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
  ["/call/notice.js", { file: "dist/call/notice.js", type: "text/javascript; charset=utf-8" }],
  ["/call/restart.js", { file: "dist/call/restart.js", type: "text/javascript; charset=utf-8" }],
  ["/client/share.js", { file: "dist/client/share.js", type: "text/javascript; charset=utf-8" }],
  [
    "/client/discarded.js",
    { file: "dist/client/discarded.js", type: "text/javascript; charset=utf-8" },
  ],
  [
    "/diagnostics/discards.js",
    { file: "dist/diagnostics/discards.js", type: "text/javascript; charset=utf-8" },
  ],
  [
    "/client/remember.js",
    { file: "dist/client/remember.js", type: "text/javascript; charset=utf-8" },
  ],
  [
    "/client/lifecycle.js",
    { file: "dist/client/lifecycle.js", type: "text/javascript; charset=utf-8" },
  ],
  [
    "/client/reconnect.js",
    { file: "dist/client/reconnect.js", type: "text/javascript; charset=utf-8" },
  ],
  [
    "/signaling/protocol.js",
    { file: "dist/signaling/protocol.js", type: "text/javascript; charset=utf-8" },
  ],
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

/** ⚠ **Every file that may be served, once each.** ⚠ For a caller that has to check they exist. */
export const servedFiles = (): readonly string[] =>
  [...new Set([...SERVED.values(), ROOM_PAGE_FILE].map((e) => e.file))].sort();

/**
 * ⚠ **What to serve for a path, ⚠ or `null` when it is not one of ours.**
 *
 * ⚠ **`null` means "not ours", ⚠ never "missing"** — ⚠ **the two are different and the caller
 * carries on routing after the first.**
 */
export const servedPath = (pathname: string): Served | null =>
  SERVED.get(pathname) ?? (ROOM_PAGE.test(pathname) ? ROOM_PAGE_FILE : null);

export const isServedPath = (pathname: string): boolean => servedPath(pathname) !== null;

/**
 * ⚠ **The headers every served file gets.**
 *
 * ⚠ **One place, ⚠ so a second way of serving cannot quietly drop one of them.**
 */
export const servedHeaders = (type: string): Record<string, string> => ({
  "content-type": type,
  // ⚠ Nothing here is a secret, but nothing here is stable either while v0.1.0 moves.
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});
