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
import { handleSignIn } from "./auth/routes.ts";
import { cookieFrom, readSession, SESSION_COOKIE } from "./auth/session.ts";
import { logger } from "./log.ts";
import { isGated, isSignIn, mayPass } from "./gate.ts";
import { LEDGER_NAME } from "./ledger-object.ts";
import { hostMark } from "./quota/host-mark.ts";
import { type Refusal, refusalFrom } from "./quota/ledger.ts";
import { MAX_ID_ATTEMPTS } from "./room/create-room.ts";
import { generateRoomId } from "./room/room-id.ts";
import { ROOM_HEADER } from "./room-object.ts";

export { LedgerObject as Ledger } from "./ledger-object.ts";
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
  /**
   * ⚠⚠ **One object for the whole service** (`docs/adr/0031`). ⚠ Declared in `wrangler.toml`.
   *
   * ⚠ **The day's budget.** ⚠ **A Durable Object because it runs one call at a time, ⚠ and a
   * budget that is not atomic is not a budget** (`src/ledger-object.ts` says the rest).
   */
  readonly LEDGER: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
  /** ⚠ **The signing secret** (`.claude/rules/security.md` § 6). ⚠ **Never a default.** */
  readonly JOIN_TOKEN_SECRET?: string;
  /**
   * ⚠⚠ **A door before the door** (`docs/adr/0024`). ⚠ **`user:secret`, as Basic sends it.**
   *
   * ⚠ **Absent means there is no gate.** ⚠ **Anyone can make a room** — ⚠ **which is what
   * `wrangler dev --local` and the checks want, ⚠ and what a deploy must not.**
   * ⚠ **It is time-limited; ⚠ `docs/adr/0024` says how it ends.**
   */
  readonly ROOM_GATE?: string;
  /**
   * ⚠⚠ **How the person who makes a room says who they are** (`docs/adr/0030`).
   *
   * ⚠ **All three, or none.** ⚠ **Half a configuration is a gate that does not gate.**
   * ⚠ **`GOOGLE_CLIENT_SECRET` and `ALLOWED_EMAILS` go in with `wrangler secret put`**
   * (`docs/DEPLOY.md`). ⚠ **Nothing of this is written into the repository.**
   */
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  /** ⚠ **Who may make a room.** ⚠ Comma separated. ⚠ **Empty allows nobody** — ⚠ fail closed. */
  readonly ALLOWED_EMAILS?: string;
};

/**
 * ⚠ **Which room a path is about**, ⚠ or `null`.
 *
 * ⚠ **The id is read out of the path and used to address one object.** ⚠ **Nothing is built from
 * it** — ⚠ **a name is a name, ⚠ and `docs/adr/0022` says one room is one object.**
 */
/**
 * ⚠⚠ **The gate exists exactly when signing in does** (`docs/adr/0030`).
 *
 * ⚠ **`undefined` means no gate** — ⚠ **which is what `wrangler dev --local` and every check run
 * as, ⚠ and it is the same posture `ROOM_GATE` had.**
 * ⚠ **The secret it returns is the signing secret, ⚠ not a password** — ⚠ **there is no shared
 * secret to hand round any more.**
 */
const gateSecret = (env: Env): string | undefined =>
  env.GOOGLE_CLIENT_ID !== undefined &&
  env.GOOGLE_CLIENT_ID !== "" &&
  env.JOIN_TOKEN_SECRET !== undefined &&
  env.JOIN_TOKEN_SECRET !== ""
    ? env.JOIN_TOKEN_SECRET
    : undefined;

/**
 * ⚠ **The mark for whoever is signed in here**, ⚠ or `null` when nobody is.
 *
 * ⚠ **Read from the session this deployment already issued** (`docs/adr/0030`) — ⚠ **the same
 * cookie the gate read a moment ago, ⚠ and the same secret.**
 */
const markOf = async (
  cookie: string | null,
  secret: string,
  at: number,
): Promise<string | null> => {
  const session = await readSession(cookieFrom(cookie, SESSION_COOKIE), secret, at);
  return session === null ? null : await hostMark(session.email, secret);
};

/**
 * ⚠⚠ **Why a room could not be made.** ⚠ **A code, ⚠ not a sentence.**
 *
 * ⚠ **The words live in one place and the page renders them** (`src/quota/ledger.ts`) — ⚠ **the
 * same shape the door already uses** (`src/client/guest.ts`).
 * ⚠ **Never shown to a Guest**: ⚠ **only making a room is stopped** (`docs/adr/0031`).
 */
const refusedToOpen = (refused: Refusal): Response =>
  new Response(JSON.stringify({ refused }), {
    status: 429,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const roomOf = (pathname: string): string | null =>
  /^\/api\/rooms\/([^/]+)(\/|$)/.exec(pathname)?.[1] ?? null;

/**
 * ⚠⚠ **Ask the day's budget** (`docs/adr/0031`).
 *
 * ⚠ **The URL is a name this object reads and nothing else routes on** — ⚠ **nobody outside can
 * reach it.**
 */
const askTheLedger = (env: Env, body: unknown): Promise<Response> =>
  env.LEDGER.get(env.LEDGER.idFromName(LEDGER_NAME)).fetch(
    new Request("https://kagima.invalid/ledger", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    }),
  );

/**
 * ⚠⚠ **Take a room out of the budget, ⚠ atomically** (`docs/adr/0031`).
 *
 * ⚠ **Checking and recording are one call.** ⚠ **Two calls would let two creates both pass the
 * check** — ⚠ **and the cap on how many are open is what bounds the overshoot.**
 * ⚠⚠ **Unreachable is a refusal** (Owner 決定 2026-09-08: ⚠ **fail closed**). ⚠ **A window where
 * the cap does not apply is a window in which the whole day can be spent.**
 */
const claimARoom = async (env: Env, host: string, roomId: string): Promise<Refusal | null> => {
  let heard: { ok: boolean; said: unknown } | null = null;
  try {
    const answer = await askTheLedger(env, { ask: "open", host, roomId });
    heard = { ok: answer.ok, said: await answer.json() };
  } catch (error) {
    // ⚠ Counted, ⚠ so "the ledger could not be reached" is not indistinguishable from a request
    //   ⚠ that never arrived (`.claude/rules/evidence.md`). ⚠ Names nothing about who or where.
    logger.info("the day's budget could not be reached", { why: String(error) });
  }
  // ⚠ What that means is one function, ⚠ and it fails closed (`src/quota/ledger.ts`).
  return refusalFrom(heard);
};

/** ⚠ **The id was already a live room.** ⚠ **Nothing was spent on this claim; ⚠ hand it back.** */
const giveBackARoom = async (env: Env, roomId: string): Promise<void> => {
  try {
    await askTheLedger(env, { ask: "give-back", roomId });
  } catch (error) {
    // ⚠ Not fatal: ⚠ the row holds one room's worth of the cap until the day turns, ⚠ and the
    //   ⚠ caller is about to try another id. ⚠ Said so it can be counted.
    logger.info("a room claim could not be handed back", { why: String(error) });
  }
};

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

    // ⚠⚠ **Before anything else** (`docs/adr/0024`).
    //
    // ⚠ **Two paths only** — ⚠ **the Host's page and making a room.** ⚠ **A Guest never meets
    //   ⚠ this: ⚠ `/r/{id}`, ⚠ the knock, ⚠ the waiting socket and the signalling socket are all
    //   ⚠ outside it**
    //   (`docs/adr/0017` took the passphrase off the door, ⚠ and this does not put it back).
    // ⚠⚠ **Signing in is outside the gate** (`src/gate.ts`) — ⚠ **a gate in front of its own door
    //   ⚠ lets nobody through, ⚠ ever.**
    if (!isSignIn(url.pathname) && isGated(request.method, url.pathname)) {
      // ⚠ The session is signed with the same secret everything else is (`docs/adr/0030`).
      //   ⚠ ⚠ The gate exists only when signing in does.
      const refused = await mayPass(request, gateSecret(env));
      if (refused !== null) return refused;
    }

    // ⚠⚠ **Signing in, ⚠ before anything is routed to a room** (`docs/adr/0030`).
    //
    // ⚠ **`/auth/...` belongs to nobody's room** — ⚠ **sending it to a Durable Object would put
    //   ⚠ one person's sign-in inside somebody else's room.** ⚠ **It is answered here.**
    const signIn = await handleSignIn(
      {
        google:
          env.GOOGLE_CLIENT_ID !== undefined &&
          env.GOOGLE_CLIENT_ID !== "" &&
          env.GOOGLE_CLIENT_SECRET !== undefined &&
          env.GOOGLE_CLIENT_SECRET !== ""
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET,
                // ⚠⚠ **Must match what is registered at Google, ⚠ exactly.**
                //   ⚠ **Built from the origin this request arrived on, ⚠ not from a variable** —
                //   ⚠ **a stale one would send people somewhere Google refuses, ⚠ and that is a
                //   ⚠ mistake `docs/FIELD-TEST.md` has already recorded once for the share URL.**
                redirectUri: `${url.origin}/auth/google/callback`,
              }
            : null,
        secret: env.JOIN_TOKEN_SECRET ?? "",
        allowList: env.ALLOWED_EMAILS,
        secure: url.protocol === "https:",
      },
      request,
      url,
    );
    if (signIn !== null) return signIn;

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
      // ⚠⚠ **Whose day this comes out of** (`docs/adr/0031`).
      //
      // ⚠ **The budget exists because the side that issues a room is a continuing subject**
      //   (`docs/adr/0030`, `docs/DISCOVERY.md` § 9 の 仮説 D). ⚠⚠ **So where there is no
      //   ⚠ sign-in there is no subject, ⚠ and nothing to give a budget to** — ⚠ **and there is
      //   ⚠ no gate either, ⚠ which is the same configuration** (`gateSecret`).
      // ⚠ **That configuration is `wrangler dev --local` with nothing set.** ⚠ **A deploy always
      //   ⚠ has both** (`docs/DEPLOY.md`), ⚠ **and `docs/SPEC.md` says which claim holds where.**
      const secret = gateSecret(env);
      const mark =
        secret === undefined
          ? null
          : await markOf(request.headers.get("cookie"), secret, Date.now());
      if (secret !== undefined && mark === null) {
        // ⚠ The gate is on, ⚠ so a session was read a moment ago and this cannot happen.
        //   ⚠ It is ours if it does — ⚠ and it fails closed rather than making a free room.
        logger.info("a room was asked for with no subject to charge it to");
        return refusedToOpen("busy");
      }

      for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
        const roomId = generateRoomId();
        if (mark !== null) {
          const refused = await claimARoom(env, mark, roomId);
          // ⚠ Not retried. ⚠ Another id would meet the same budget, ⚠ and a loop against a cap
          //   ⚠ is just the cap being asked eight times.
          if (refused !== null) return refusedToOpen(refused);
        }
        const answer = await askTheRoom(env, roomId, request);
        // ⚠ 503 is what `handle` answers when the id was taken (`src/server.ts`).
        //   ⚠ It says nothing about which id, ⚠ and there is nothing here to leak.
        if (answer.status !== 503) return answer;
        if (mark !== null) await giveBackARoom(env, roomId);
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
