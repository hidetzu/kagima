// ⚠⚠ **Node's way of reading the browser's own files.**
//
// ⚠ **What may be served is [`assets.ts`](assets.ts)** — ⚠ **a closed map, ⚠ shared with the
//   ⚠ Worker.** ⚠ **This file is only "how to get the bytes on this platform".**
//
// ⚠ **The browser is served `dist/`, ⚠ not `src/`** (`docs/adr/0016`).
// ⚠ **`npm run build` strips the types once, ⚠ ahead of time.** ⚠ **Nothing is transformed while
//   ⚠ answering a request.**
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { servedFiles, servedHeaders, servedPath } from "./assets.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ⚠ **Which served files are not on disk.** ⚠ **Read at startup, ⚠ never while answering.**
 *
 * ⚠ **Grounds: a missing `dist/` is not a runtime condition ⚠ but a build that did not run**
 * (`docs/adr/0016`). ⚠ **It must break loudly, at startup, naming what to do** —
 * ⚠ **not quietly, on one request, as a stack trace a stranger reads** (`CLAUDE.md` § 4).
 */
export const missingServedFiles = (): readonly string[] =>
  servedFiles()
    .filter((file) => !existsSync(join(ROOT, file)))
    .sort();

/**
 * ⚠ **A `Response`, ⚠ or `null` when the path is not one of ours.**
 *
 * ⚠ **`async` because the Worker's answer is** — ⚠ **its Assets binding is a `fetch`.**
 * ⚠ **One signature, ⚠ two platforms** (`CLAUDE.md` § 3).
 */
export const serveStatic = async (pathname: string): Promise<Response | null> => {
  const entry = servedPath(pathname);
  if (entry === null) return null;

  const body = readFileSync(join(ROOT, entry.file), "utf8");
  return new Response(body, { headers: servedHeaders(entry.type) });
};
