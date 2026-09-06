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
import { MAX_ID_ATTEMPTS } from "./room/create-room.ts";
import { generateRoomId } from "./room/room-id.ts";
import { ROOM_HEADER } from "./room-object.ts";

export { RoomObject as Room } from "./room-object.ts";

export type Env = {
  /** ⚠ **The browser's own files** (`docs/adr/0016`). ⚠ Declared in `wrangler.toml`. */
  readonly ASSETS: { fetch: (request: Request) => Promise<Response> };
  /**
   * ⚠ **One object per room** (`docs/adr/0022`). ⚠ Declared in `wrangler.toml`.
   *
   * ⚠ **Named in our own words, ⚠ like `RoomState`** (`src/room-object.ts` says why).
   * ⚠ **Two calls.**
   */
  readonly ROOM: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
  /** ⚠ **The signing secret** (`.claude/rules/security.md` § 6). ⚠ **Never a default.** */
  readonly JOIN_TOKEN_SECRET?: string;
};

/**
 * ⚠ **Which room a path is about**, ⚠ or `null`.
 *
 * ⚠ **The id is read out of the path and used to address one object.** ⚠ **Nothing is built from
 * it** — ⚠ **a name is a name, ⚠ and `docs/adr/0022` says one room is one object.**
 */
const roomOf = (pathname: string): string | null =>
  /^\/api\/rooms\/([^/]+)(\/|$)/.exec(pathname)?.[1] ?? null;

/**
 * ⚠⚠ **Hand a request to one room's object.**
 *
 * ⚠ **The room's name goes in a header the caller cannot choose** — ⚠ **it is set here,
 * ⚠ overwriting whatever arrived** (`src/room-object.ts`).
 */
const askTheRoom = (env: Env, roomId: string, request: Request): Promise<Response> => {
  const forwarded = new Request(request);
  forwarded.headers.set(ROOM_HEADER, roomId);
  return env.ROOM.get(env.ROOM.idFromName(roomId)).fetch(forwarded);
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

    // ⚠⚠ **Making a room: ⚠ the id comes first** (`docs/adr/0022`).
    //
    // ⚠ **A Durable Object is addressed by name, ⚠ so the name has to exist before the room
    //   ⚠ does.** ⚠ **It is drawn here, ⚠ from the same CSPRNG seam Node uses**
    //   (`.claude/rules/security.md` § 1).
    // ⚠ **The collision check has not moved**: ⚠ **`store.add` inside the object refuses rather
    //   ⚠ than overwrites, ⚠ so a name that is already a live room comes back refused and we try
    //   ⚠ another** (`src/room/create-room.ts`).
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
        const answer = await askTheRoom(env, generateRoomId(), request);
        // ⚠ 503 is what `handle` answers when the id was taken (`src/server.ts`).
        //   ⚠ It says nothing about which id, ⚠ and there is nothing here to leak.
        if (answer.status !== 503) return answer;
      }
      // ⚠ Says what happened, ⚠ and names nothing that was tried.
      return new Response(
        JSON.stringify({ error: "could not create a room just now, please try again" }),
        { status: 503, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    const roomId = roomOf(url.pathname);
    if (roomId !== null) return askTheRoom(env, roomId, request);

    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "no such endpoint" }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({ error: "no such endpoint" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
};
