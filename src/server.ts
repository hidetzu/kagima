// ⚠⚠ **The routing, ⚠ and nothing that knows which runtime it is on.**
//
// ⚠ **`handle(ctx, Request) -> Response` is the whole of it** (`docs/adr/0015`).
// ⚠ **Node's listener lives in [`node-server.ts`](node-server.ts); ⚠ a Worker will bring its own.**
//
// ## ⚠ Why the context is handed in
//
// ⚠ **Nothing here reads the environment.** ⚠ **On Node the settings come from `process.env`;
//   ⚠ in a Worker they arrive as bindings on the request.** ⚠ **Reading either one from here
//   ⚠ would tie the routing to a runtime, ⚠ which is the thing this file exists not to do.**
//
// ⚠ **Every room dies with this process.** ⚠ **That is the specification** (`docs/adr/0005`).
import {
  createKnockRejectionCounter,
  createKnocks,
  type KnockRejectionCounter,
  type Knocks,
} from "./knock/knocks.ts";
import { logger } from "./log.ts";
import { randomToken } from "./random.ts";
import { createRoom, defaultDeps as defaultCreateRoomDeps } from "./room/create-room.ts";
import { isRoomId } from "./room/room-id.ts";
import { createRoomStore, type RoomStore } from "./room/store.ts";
import type { ExchangeCode, GoogleConfig } from "./auth/google.ts";
import { handleSignIn } from "./auth/routes.ts";
import { createHub, type Hub } from "./signaling/hub.ts";
import { parseClientMessage } from "./signaling/messages.ts";
import { CLOSE_ROOM_CLOSED } from "./signaling/protocol.ts";
import {
  constantTimeEqual,
  issueJoinToken,
  issueRejoinMark,
  verifyRejoinMark,
} from "./token/join-token.ts";

const DEFAULT_PORT = 8787;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;

/**
 * ⚠ **A join body is one short field.** ⚠ **Anything larger is not a join.**
 * ⚠ **The cap is applied while reading, not after** — ⚠ **buffering first and checking later is
 * how an unauthenticated caller decides how much memory this process uses.**
 */
const MAX_BODY_BYTES = 1024;

/**
 * ⚠ **Compared against when there is no room to compare against.**
 * ⚠ **Same trick as the join endpoint's decoy**: ⚠ **it keeps the unknown-room path costing the
 * same as the wrong-key path.** ⚠ **It is not a secret and no room ever holds it.**
 */
const DECOY_HOST_KEY = "decoy-host-key-that-no-room-holds";

export type Context = {
  /**
   * ⚠⚠ **The browser's own files, ⚠ handed in rather than reached for** (`docs/adr/0015`).
   *
   * ⚠ **On Node this reads `public/` and `dist/` off disk** (`src/static.ts`).
   * ⚠ **A Worker has no filesystem; ⚠ it brings an Assets binding instead.**
   * ⚠⚠ **`async` because the Worker's answer is** — ⚠ **an Assets binding is a `fetch`.**
   * ⚠ **Routing must not care which** — ⚠ **so it asks, ⚠ and something else answers.**
   *
   * ⚠ **`null` means "not one of ours", ⚠ not "missing"** — ⚠ **the two are different and the
   * caller carries on routing after the first.**
   */
  readonly asset: (pathname: string) => Promise<Response | null>;
  /**
   * ⚠⚠ **The id a new room must take** (`docs/adr/0022`).
   *
   * ⚠ **On Cloudflare a Durable Object is addressed by name, ⚠ so the id has to exist before the
   * room does** — ⚠ **the caller mints it, ⚠ then talks to that object.**
   * ⚠ **`undefined` means "mint one here", ⚠ which is what Node does.**
   *
   * ⚠ **The collision check does not move**: ⚠ **`store.add` still refuses rather than
   * overwrites, ⚠ so an id that is already a live room is refused and the caller retries**
   * (`src/room/create-room.ts`).
   */
  readonly newRoomId?: () => string;
  readonly store: RoomStore;
  readonly baseUrl: string;
  readonly secret: string;
  readonly hub: Hub;
  /** ⚠ **The door** (`docs/adr/0017`). ⚠ Who is waiting, and what the Host decided. */
  readonly knocks: Knocks;
  /** ⚠ **Why knocks were not taken.** ⚠ Counted apart, ⚠ answered alike. */
  readonly knockRejections: KnockRejectionCounter;
  /**
   * ⚠ **The header to read the caller's address from, when something we trust sets it.**
   *
   * ⚠ **Empty means: use the socket.** ⚠ **That is the only value that is safe by itself.**
   * ⚠ **Naming a header trusts whoever can set it** — ⚠ **and if anything can reach this process
   * without going through that proxy, the per-source limit is bypassed by typing a header.**
   * ⚠ **So it is off unless the deployment says otherwise** (`src/server.ts` § sourceOf).
   */
  readonly trustedSourceHeader: string;
  /**
   * ⚠⚠ **How the person who makes a room says who they are** (`docs/adr/0030`).
   *
   * ⚠ **`null` when nothing is configured** — ⚠ **then there is no sign-in and no gate, ⚠ which
   * is what `wrangler dev --local` and every check run as.**
   */
  readonly google?: GoogleConfig | null;
  /** ⚠ **Who may make a room.** ⚠ **Addresses in a secret; ⚠ no database** (stage 1 of `0030`). */
  readonly allowList?: string;
  /** ⚠ **Injected so a check needs no network** (`.claude/rules/verification.md`). */
  readonly exchangeCode?: ExchangeCode;
};

/**
 * ⚠ **Who is asking.**
 *
 * ⚠ **Behind Cloudflare Tunnel the socket address is the tunnel's, so every caller looks like one
 * source and the per-source limit collapses into the room limit.**
 * ⚠ **A header fixes that, and introduces a worse problem if it is trusted without a proxy in
 * front that always overwrites it.**
 *
 * ⚠ **kagima refuses to guess.** ⚠ **The header is used only when it is named explicitly.**
 */
/**
 * ⚠ **Where the Node adapter puts the socket's address.**
 *
 * ⚠ **A `Request` does not carry a socket.** ⚠ **So when no proxy header is trusted, the adapter
 * writes the address here and `sourceOf` reads it** — ⚠ **one name, ⚠ in one place, ⚠ rather than
 * two ways of finding out who called.**
 */
export const NODE_SOURCE_HEADER = "x-kagima-node-source";

const sourceOf = (request: Request, trustedHeader: string): string => {
  if (trustedHeader !== "") {
    const value = request.headers.get(trustedHeader);
    // ⚠ `x-forwarded-for` is a list; the client-controlled part is on the left, so take the first
    //   ⚠ only because a trusted proxy is assumed to have rewritten the whole header.
    if (value) return value.split(",")[0]?.trim() ?? "unknown";
  }
  // ⚠ Otherwise whatever the adapter knew. ⚠ In a Worker there is no adapter and no socket,
  //   ⚠ so this is "unknown" — ⚠ which is honest. ⚠ Inventing one would be worse than having none.
  return request.headers.get(NODE_SOURCE_HEADER) ?? "unknown";
};

/**
 * ⚠ **One JSON answer.**
 *
 * ⚠ **A `Response`, ⚠ not a write to a Node object** (`docs/adr/0015`) — ⚠ **so the same routing
 * runs in a Worker and in Node, ⚠ and there is one implementation of it rather than two**
 * (`CLAUDE.md` § 3).
 */
const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // ⚠ Never let a room-creation response sit in a cache. ⚠ It carries the host key.
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });

/**
 * ⚠ **The one answer to every refused close.**
 *
 * ⚠ **A wrong host key and a room that is not there must not be distinguishable**, ⚠ **or this endpoint answers "does this room exist?" as well.**
 */
const CLOSE_REFUSED = {
  status: 401,
  body: { error: "that room could not be closed" },
} as const;

/**
 * ⚠ **The one answer to every refused host session** (`docs/adr/0018`).
 *
 * ⚠ **A wrong host key and a room that is not there must not be distinguishable**, ⚠ **or this
 * endpoint answers "does this room exist?" as well** (`.claude/rules/security.md` § 3).
 */
const HOST_SESSION_REFUSED = {
  status: 401,
  body: { error: "that room could not be opened as its host" },
} as const;

/**
 * ⚠ **One answer for every way a rejoin can fail** (`docs/adr/0029`).
 *
 * ⚠ **Expired, ⚠ forged, ⚠ for another room, ⚠ and "that room is over" are one refusal.**
 * ⚠ **Telling them apart would say whether a room exists** (`.claude/rules/security.md` § 3).
 */
const GUEST_SESSION_REFUSED = {
  status: 401,
  body: { error: "that room could not be rejoined" },
} as const;

/**
 * ⚠ **The body, ⚠ or `null` when it is too large to be one of ours.**
 *
 * ⚠ **`content-length` is checked first so an oversized body is refused before it is held.**
 * ⚠ **A body with no length is still read, ⚠ and measured as it arrives.**
 */
const readBody = async (request: Request): Promise<string | null> => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  // ⚠ Measured after decoding: ⚠ the cap is about what we hold, not about bytes on the wire.
  return text.length > MAX_BODY_BYTES ? null : text;
};

/**
 * ⚠ **Every outcome the room endpoints can produce, and the ones they cannot**
 * (`.claude/rules/evidence.md` § Outcomes are not one outcome).
 *
 * ```text
 * accepted and handled            a room was created, or a join was accepted
 * ⚠ malformed                      a join body that is not JSON, or has no passphrase
 * ⚠ well-formed but declined       a join that did not match       -> ⚠ one answer, always
 * ⚠ not implemented yet            any other path or method
 * ⚠ could not be satisfied         no free room id                 -> 503
 * ⚠ nothing arrived                cannot occur — the server is answering a request it received
 * ⚠ a timer expired while waiting  cannot occur — nothing here waits on anything
 * ```
 */
export const handle = async (ctx: Context, request: Request): Promise<Response> => {
  const url = new URL(request.url, ctx.baseUrl);

  // ⚠ Only GET reaches the static map, and only by an exact name from a closed list.
  if (request.method === "GET") {
    const asset = await ctx.asset(url.pathname);
    if (asset !== null) return asset;
  }

  // ⚠⚠ **Signing in** (`docs/adr/0030`). ⚠ **It is not a room's business, ⚠ so it does not live
  //   ⚠ here** — ⚠ **on Cloudflare the room routes go to a Durable Object and this must not**
  //   (`src/auth/routes.ts`). ⚠ **Both platforms call the same function.**
  const signIn = await handleSignIn(
    {
      google: ctx.google ?? null,
      secret: ctx.secret,
      allowList: ctx.allowList,
      secure: ctx.baseUrl.startsWith("https:"),
      ...(ctx.exchangeCode === undefined ? {} : { exchangeCode: ctx.exchangeCode }),
    },
    request,
    url,
  );
  if (signIn !== null) return signIn;

  if (url.pathname === "/api/rooms") {
    if (request.method !== "POST") {
      return json(405, { error: "rooms are created with POST" }, { allow: "POST" });
    }
    try {
      const { room, shareUrl } = createRoom(
        ctx.store,
        ctx.baseUrl,
        ctx.newRoomId === undefined
          ? undefined
          : { ...defaultCreateRoomDeps, newId: ctx.newRoomId },
      );
      // ⚠⚠ **The host key and the host's own token are handed over here and never again.**
      // ⚠ **There is no passphrase** (`docs/adr/0017`) — ⚠ **who comes in is the Host's decision,
      //   ⚠ and the Host is the one asking.**
      return json(201, {
        roomId: room.id,
        shareUrl,
        token: await issueJoinToken(room.id, ctx.secret, Date.now()),
        hostKey: room.hostKey,
      });
    } catch {
      // ⚠ Nothing from the error reaches the response or a log line (`.claude/rules/security.md` § 2).
      return json(503, { error: "could not create a room just now, please try again" });
    }
  }

  // ⚠⚠ **The door** (`docs/adr/0017`).
  //
  // ⚠ **Every answer here looks the same whatever happened** — ⚠ **an unknown room, a Host who
  //   ⚠ has not answered, and a door with too many people at it are one shape.**
  // ⚠ **Anything else answers "does this room exist?" for free** (`.claude/rules/security.md` § 3).
  const knockPath = /^\/api\/rooms\/([^/]+)\/knock$/.exec(url.pathname);
  if (knockPath) {
    if (request.method !== "POST") {
      return json(405, { error: "knocking is a POST" }, { allow: "POST" });
    }
    const raw = await readBody(request);
    if (raw === null) {
      return json(413, { error: "that request body is too large to be a knock" });
    }
    let nickname: unknown;
    try {
      nickname = (JSON.parse(raw) as { nickname?: unknown }).nickname;
    } catch {
      return json(400, { error: "the body is not JSON" });
    }
    // ⚠ The same rule the signalling side uses. ⚠ One place, ⚠ not two (`CLAUDE.md` § 3).
    const checked = parseClientMessage(JSON.stringify({ type: "hello", nickname }));
    if (!checked.ok || checked.message.type !== "hello") {
      // ⚠ Malformed is the caller's own mistake and says nothing about any room.
      return json(400, { error: "that name cannot be used" });
    }
    const roomId = decodeURIComponent(knockPath[1] as string);
    const { id, refused } = ctx.knocks.knock(roomId, checked.message.nickname, Date.now());
    if (refused === null) {
      // ⚠ The Host is already here, waiting, with a socket open (`docs/adr/0017`).
      ctx.hub.announceToHost(
        roomId,
        JSON.stringify({ type: "knock", knockId: id, nickname: checked.message.nickname }),
      );
    } else {
      // ⚠ Counted, ⚠ never answered. ⚠ An uncounted rejection is indistinguishable from a
      //   ⚠ request that never arrived (`.claude/rules/evidence.md`).
      ctx.knockRejections.record(refused);
    }
    // ⚠⚠ The same body either way.
    return json(200, { knockId: id });
  }

  // ⚠⚠ **There is no endpoint here that takes a knock id** (`docs/adr/0028`, kagima#99).
  //
  // ⚠ **`GET /api/rooms/{roomId}/knock/{knockId}` used to live here, ⚠ and it was read every two
  //   ⚠ seconds.** ⚠ **Measured 2026-09-06: ⚠ Cloudflare's own log carried that path with the id
  //   ⚠ in it** — ⚠ **kagima never wrote the line; ⚠ the id was in the URL, ⚠ so the URL is what
  //   ⚠ was recorded.**
  // ⚠ **The Host's decision is pushed over the waiting socket now** (`src/knock/wait.ts`),
  //   ⚠ **and the id travels in `sec-websocket-protocol` where the join token already travels.**
  // ⚠ **`test/knock-id-never-in-a-path.test.ts` is what keeps it gone.**

  // ⚠⚠ **The Host exchanges its key for a short-lived role, once** (`docs/adr/0018`).
  //
  // ⚠ **`hostKey` lives in the Host's page and is handed over here and nowhere else.**
  // ⚠ **What comes back is a token that opens that room's door for as long as it lives** —
  //   ⚠ **and nothing after this point reads `hostKey` again**
  //   (`.claude/rules/security.md` § 4, ⚠ the same shape `docs/adr/0017` already uses).
  const hostSession = /^\/api\/rooms\/([^/]+)\/host-session$/.exec(url.pathname);
  if (hostSession) {
    if (request.method !== "POST") {
      return json(405, { error: "a host session is taken with POST" }, { allow: "POST" });
    }
    const raw = await readBody(request);
    if (raw === null) {
      return json(413, { error: "that request body is too large to be a host key" });
    }
    let hostKey: unknown;
    try {
      hostKey = (JSON.parse(raw) as { hostKey?: unknown }).hostKey;
    } catch {
      return json(400, { error: "the body is not JSON" });
    }
    if (typeof hostKey !== "string") {
      return json(400, { error: "the body needs a hostKey, as a string" });
    }

    const roomId = decodeURIComponent(hostSession[1] as string);
    const room = isRoomId(roomId) ? ctx.store.get(roomId) : undefined;
    // ⚠ Exactly one comparison whatever the path, ⚠ for the same reason the close endpoint has
    //   ⚠ one: ⚠ returning early for an unknown room makes the time saved the answer.
    const matched = await constantTimeEqual(hostKey, room?.hostKey ?? DECOY_HOST_KEY);
    if (room === undefined || !matched) {
      // ⚠ One answer. ⚠ A wrong key and a room that is not there are the same from outside.
      return json(HOST_SESSION_REFUSED.status, HOST_SESSION_REFUSED.body);
    }

    // ⚠ Nothing about the key reaches the token (`.claude/rules/security.md` § 4).
    return json(200, {
      token: await issueJoinToken(room.id, ctx.secret, Date.now(), undefined, "host"),
    });
  }

  // ⚠⚠ **A Guest comes back to a room it was already let into** (`docs/adr/0029`, kagima#90).
  //
  // ⚠ **The same shape as `/host-session` above, ⚠ and deliberately so** — ⚠ **a mark kept on the
  //   ⚠ device is exchanged for a short-lived token, ⚠ and nothing else ever uses the mark.**
  // ⚠ **Measured 2026-09-06: ⚠ a phone's page was thrown away after about six minutes in the
  //   ⚠ background and rebuilt from the document.** ⚠ **Without this the person knocks again and
  //   ⚠ the Host presses the button again, ⚠ every time.**
  //
  // ⚠⚠ **What this endpoint must never become: ⚠ a way in for somebody the Host did not admit.**
  //   ⚠ **The mark is signed, ⚠ bound to this room, ⚠ and carries its own expiry**
  //   (`src/token/join-token.ts`).
  const guestSession = /^\/api\/rooms\/([^/]+)\/guest-session$/.exec(url.pathname);
  if (guestSession) {
    if (request.method !== "POST") {
      return json(405, { error: "a guest session is taken with POST" }, { allow: "POST" });
    }
    const raw = await readBody(request);
    if (raw === null) {
      return json(413, { error: "that request body is too large to be a mark" });
    }
    let rejoin: unknown;
    try {
      rejoin = (JSON.parse(raw) as { rejoin?: unknown }).rejoin;
    } catch {
      return json(400, { error: "the body is not JSON" });
    }
    if (typeof rejoin !== "string") {
      return json(400, { error: "the body needs a rejoin, as a string" });
    }

    const roomId = decodeURIComponent(guestSession[1] as string);
    // ⚠⚠ **The signature is checked before the room is looked up**, ⚠ **so a mark for a room that
    //   ⚠ does not exist and a mark that was never signed by us cost the same HMAC**
    //   (`.claude/rules/security.md` § 3).
    const checked = await verifyRejoinMark(rejoin, roomId, ctx.secret, Date.now());
    const room = isRoomId(roomId) ? ctx.store.get(roomId) : undefined;
    // ⚠⚠ **The room is what revokes a mark** (`docs/adr/0029`). ⚠ **There is nothing else that can.**
    if (!checked.ok || room === undefined) {
      // ⚠ One answer. ⚠ Expired, ⚠ forged, ⚠ for another room, ⚠ and "that room is over" are one
      //   ⚠ refusal — ⚠ telling them apart would say whether the room exists.
      return json(GUEST_SESSION_REFUSED.status, GUEST_SESSION_REFUSED.body);
    }

    // ⚠⚠ **The same `sessionId`** (`src/signaling/hub.ts`). ⚠ **A new one would make this person a
    //   ⚠ third participant, ⚠ and their own half-open socket could refuse them as `room-full`.**
    return json(200, {
      token: await issueJoinToken(room.id, ctx.secret, Date.now(), checked.sessionId),
      // ⚠ Refreshed on every way in (`docs/adr/0029`). ⚠ The mark lives while it is being used
      //   ⚠ and dies when it is not.
      rejoin: await issueRejoinMark(room.id, ctx.secret, Date.now(), checked.sessionId),
    });
  }

  const roomPath = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
  if (roomPath && request.method === "DELETE") {
    const raw = await readBody(request);
    if (raw === null) {
      return json(413, { error: "that request body is too large to be a close" });
    }
    let hostKey: unknown;
    try {
      hostKey = (JSON.parse(raw) as { hostKey?: unknown }).hostKey;
    } catch {
      return json(400, { error: "the body is not JSON" });
    }
    if (typeof hostKey !== "string") {
      return json(400, { error: "the body needs a hostKey, as a string" });
    }

    const roomId = decodeURIComponent(roomPath[1] as string);
    const room = isRoomId(roomId) ? ctx.store.get(roomId) : undefined;
    // ⚠ Exactly one comparison whatever the path, for the same reason the join endpoint has one:
    //   ⚠ returning early for an unknown room makes the time saved the answer.
    const matched = await constantTimeEqual(hostKey, room?.hostKey ?? DECOY_HOST_KEY);
    if (room === undefined || !matched) {
      return json(CLOSE_REFUSED.status, CLOSE_REFUSED.body);
    }

    // ⚠ The sockets first, so nobody is left holding a room that no longer exists.
    ctx.hub.closeRoom(roomId, CLOSE_ROOM_CLOSED, "the host ended this room");
    // ⚠ Then the room, and with it the host key and the participant list.
    //   ⚠ `docs/adr/0005`: what is not held cannot leak.
    ctx.store.close(roomId);
    // ⚠ And everyone still at the door hears the same one word as everyone who was refused
    //   (`docs/adr/0017`). ⚠ Leaving them on "waiting" would leave them waiting for a room
    //   ⚠ that is gone.
    ctx.knocks.endRoom(roomId);
    // ⚠ Says the room is over, and says nothing about who was in it.
    logger.info("a room was closed by its host", { roomId });
    return json(200, { closed: true });
  }

  return json(404, {
    error: "no such endpoint",
    endpoints: [
      "GET /auth/google",
      "POST /api/rooms",
      "POST /api/rooms/{roomId}/host-session",
      "POST /api/rooms/{roomId}/guest-session",
      "POST /api/rooms/{roomId}/knock",
      "DELETE /api/rooms/{roomId}",
      "GET /r/{roomId}",
    ],
  });
};
