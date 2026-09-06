// ⚠⚠ **kagima's entry on Cloudflare** (`docs/adr/0015`).
//
// ```text
// server.ts       ⚠ handle(ctx, Request) -> Response      ⚠ platform-free
// worker.ts       ⚠ the bindings, and an adapter          ← ⚠ this file
// node-server.ts  ⚠ the same job, for Node
// ```
//
// ⚠ **Nothing here decides anything.** ⚠ **It supplies what `handle` asks for and gets out of
//   ⚠ the way** — ⚠ **which is the whole point of the seam** (`CLAUDE.md` § 3).
//
// ## ⚠ What is not here yet
//
// ⚠⚠ **The room.** ⚠ **`docs/adr/0022` and `docs/adr/0023` decided its shape — ⚠ one Durable
//   ⚠ Object per room, ⚠ writing four fields — ⚠ and it is the next step.**
// ⚠ **Until then the API routes say so, ⚠ in as many words** — ⚠ **"not implemented yet" is a
//   ⚠ different thing from "unavailable", ⚠ and the reader's next move depends on which**
//   (`CLAUDE.md` § 4-1).
import { servedHeaders, servedPath } from "./assets.ts";

export type Env = {
  /** ⚠ **The browser's own files** (`docs/adr/0016`). ⚠ Declared in `wrangler.toml`. */
  readonly ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** ⚠ **The signing secret** (`.claude/rules/security.md` § 6). ⚠ **Never a default.** */
  readonly JOIN_TOKEN_SECRET?: string;
};

/**
 * ⚠⚠ **The browser's own files, ⚠ through the closed map** (`src/assets.ts`).
 *
 * ⚠ **The Assets binding serves a whole directory.** ⚠ **kagima does not** — ⚠ **`docs/adr/0015`
 * kept a closed map on purpose, ⚠ and moving platforms must not quietly trade it for a walk.**
 * ⚠ **So the path is checked against the map first, ⚠ and only then asked for.**
 *
 * ⚠ **The map names a file; ⚠ the binding is asked for that file** — ⚠ **not for whatever the
 * caller sent.**
 */
const asset = async (env: Env, origin: string, pathname: string): Promise<Response | null> => {
  const entry = servedPath(pathname);
  if (entry === null) return null;

  // ⚠ `public/x` and `dist/x` are both served from the assets directory's root at deploy time.
  //   ⚠ The map's own name is what is asked for, ⚠ never the caller's path.
  const name = entry.file.replace(/^(public|dist)\//, "");
  const found = await env.ASSETS.fetch(new Request(new URL(`/${name}`, origin)));
  if (!found.ok) return null;

  // ⚠ Our headers, not the binding's. ⚠ One place decides them (`src/assets.ts`).
  return new Response(found.body, { headers: servedHeaders(entry.type) });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET") {
      const found = await asset(env, url.origin, url.pathname);
      if (found !== null) return found;
    }

    // ⚠⚠ **The room is not here yet** (`docs/adr/0022`, `docs/adr/0023`).
    //
    // ⚠ **Said as what it is: ⚠ we have not built it.** ⚠ **Never as the caller's mistake, ⚠ and
    //   ⚠ never as "unavailable"** — ⚠ **a reader who is told "not yet" has a reason to come back**
    //   (`CLAUDE.md` § 4-1).
    if (url.pathname.startsWith("/api/")) {
      return new Response(
        JSON.stringify({ error: "この機能は Cloudflare 版ではまだ動いていません。" }),
        { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    return new Response(JSON.stringify({ error: "no such endpoint" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
};
