// ⚠⚠ **One room, ⚠ one Durable Object** (`docs/adr/0022`).
//
// ⚠ **Everything a room knows is here** — ⚠ **the room itself, ⚠ who is at the door, ⚠ who is
//   ⚠ connected.** ⚠ **Splitting them would put state in two places, ⚠ which is what
//   ⚠ `docs/adr/0005` was written to avoid.**
//
// ## ⚠ Why the routing is not written again
//
// ⚠ **`handle(ctx, Request) -> Response` is platform-free** (`src/server.ts`).
// ⚠ **This object builds the `Context` and calls it.** ⚠ **Every rule about the door, the knock,
//   ⚠ the host key and the one answer stays in one place** (`CLAUDE.md` § 3).
//
// ## ⚠⚠ Why anything is written down at all
//
// ⚠ **Measured 2026-09-06: ⚠ when the last socket closes, ⚠ a Durable Object drops what it holds
//   ⚠ in memory within 15 s.** ⚠ **And a real Host's page is thrown away by the browser about
//   ⚠ 73 s after it goes to the background** (kagima#75).
// ⚠ **So "memory only" does not keep a room here** (`docs/adr/0023`).
//
// ⚠ **Four fields.** ⚠ **Never a knock, ⚠ never a token, ⚠ never a name.**
import { createKnockRejectionCounter, createKnocks } from "./knock/knocks.ts";
import { logger } from "./log.ts";
import { randomToken } from "./random.ts";
import { createRoomStore, ROOM_IDLE_MS, type Room } from "./room/store.ts";
import { type Context, handle } from "./server.ts";
import { upgrade, workerSocketPair } from "./signaling/attach-worker.ts";
import { createHub } from "./signaling/hub.ts";
import { CLOSE_ROOM_CLOSED } from "./signaling/protocol.ts";
import { createSessions, type Sessions } from "./signaling/session.ts";

/** ⚠ **The one key.** ⚠ **One room per object, ⚠ so there is nothing to key by.** */
const KEY = "room";

/**
 * ⚠⚠ **Which room this object is** (`docs/adr/0022`).
 *
 * ⚠ **A Durable Object cannot recover the name it was addressed by, ⚠ so the Worker says it.**
 * ⚠ **Set by `src/worker.ts` on every forward, ⚠ overwriting whatever arrived** — ⚠ **a caller
 * cannot choose which room they are talking to by sending a header.**
 */
export const ROOM_HEADER = "x-kagima-room";

/**
 * ⚠⚠ **What this object uses of the platform, ⚠ named in our own words.**
 *
 * ⚠ **Cloudflare's generated types clash with Node's on the same names** (⚠ tried 2026-09-06:
 * ⚠ `Buffer` collided), ⚠ **and this project already prefers naming what it depends on**
 * (`src/random.ts`, `src/signaling/socket.ts`).
 * ⚠ **Three calls.** ⚠ **If the shape were wrong, ⚠ `wrangler dev` would say so** — ⚠ **and it
 * ran** (⚠ a room untouched for 40 s came back, 2026-09-06).
 */
export type RoomState = {
  readonly storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    /**
     * ⚠⚠ **When to wake this object up and let it go** (`docs/adr/0025`).
     *
     * ⚠ **Node has a sweeper** (`src/node-server.ts`). ⚠ **A Durable Object has no process to
     * run one in** — ⚠ **so the room is what remembers when it is over.**
     */
    setAlarm(at: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
};

export type RoomEnv = {
  readonly JOIN_TOKEN_SECRET?: string;
  readonly PUBLIC_BASE_URL?: string;
};

export class RoomObject {
  state: RoomState;
  env: RoomEnv;

  private ctx: Context | null = null;
  private sessions: Sessions | null = null;
  /** ⚠ **The id this object is holding.** ⚠ Learned from the Worker, ⚠ never from a caller. */
  private roomId: string | null = null;

  constructor(state: RoomState, env: RoomEnv) {
    this.state = state;
    this.env = env;
  }

  /**
   * ⚠ **Built once per wake, ⚠ and seeded from what survived.**
   *
   * ⚠ **The store, the door and the hub are the same ones Node uses** — ⚠ **the difference is
   * that this one holds a single room, ⚠ and reads it back after an eviction.**
   */
  private async context(roomId: string): Promise<Context> {
    if (this.ctx !== null) return this.ctx;

    const store = createRoomStore();
    const ctx: Context = {
      store,
      // ⚠ Assets never reach this object: ⚠ the Worker answers those before us
      //   (`src/worker.ts`). ⚠ Saying "not ours" is honest; ⚠ a reader we do not have is not.
      asset: async () => null,
      baseUrl: this.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:8787",
      secret: this.secret(),
      hub: createHub(),
      knockRejections: createKnockRejectionCounter(),
      knocks: createKnocks({
        newId: () => randomToken(16),
        roomExists: (id) => store.get(id) !== undefined,
      }),
      // ⚠⚠ **The id was minted before this object was addressed** (`docs/adr/0022`).
      //   ⚠ **`store.add` still refuses rather than overwrites, ⚠ so an id that is already a
      //   ⚠ live room is refused and the Worker tries another** (`src/room/create-room.ts`).
      newRoomId: () => roomId,
      // ⚠ Cloudflare puts the caller's address in `cf-connecting-ip`. ⚠ It is not read yet;
      //   ⚠ naming it here would claim we do (`.claude/rules/evidence.md`).
      trustedSourceHeader: "",
    };

    // ⚠⚠ **What survived the last eviction** (`docs/adr/0023`).
    const held = await this.state.storage.get<Room>(KEY);
    if (held !== undefined) store.add(held);

    // ⚠⚠ **The heartbeat moves `lastSeenAt`, ⚠ and that is what keeps the room alive**
    //   (`docs/adr/0010`, `docs/adr/0023`).
    // ⚠ **It happens on a timer, ⚠ outside any request** — ⚠ **so writing only after `fetch`
    //   ⚠ would leave the moved value in memory and lose it at the next eviction.**
    this.sessions = createSessions({
      hub: ctx.hub,
      secret: ctx.secret,
      knocks: ctx.knocks,
      touch: (id) => {
        ctx.store.touch(id);
        // ⚠ Not awaited: ⚠ a heartbeat must not wait on storage, ⚠ and a failed write only
        //   ⚠ means the room ages from the last one that landed.
        void this.persist(null, ctx.store.get(id) ?? null);
      },
    });

    this.ctx = ctx;
    return ctx;
  }

  /**
   * ⚠ **The signing secret** (`.claude/rules/security.md` § 6).
   *
   * ⚠ **There is no default value, and there never will be** — ⚠ **a constant fallback in a
   * public repository is the same as no signature at all.**
   * ⚠ **Without one, a random secret is made for this object.** ⚠ **The consequence is that every
   * token it issued stops working when the object is replaced** — ⚠ **which is the same thing
   * Node says at startup.**
   */
  private secret(): string {
    const fromEnv = this.env.JOIN_TOKEN_SECRET;
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
    return randomToken(32);
  }

  async fetch(request: Request): Promise<Response> {
    const roomId = request.headers.get(ROOM_HEADER);
    if (roomId === null || roomId === "") {
      // ⚠ Nobody outside can reach this object; ⚠ only `src/worker.ts` can. ⚠ So this is our own
      //   ⚠ mistake, ⚠ and it says so rather than inventing an answer for a caller.
      return new Response(JSON.stringify({ error: "this room was addressed without a name" }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    this.roomId = roomId;

    const ctx = await this.context(roomId);

    // ⚠⚠ **The signalling socket** (`src/signaling/attach-worker.ts`).
    //
    // ⚠ **`handle` does not do WebSocket on either platform** — ⚠ **Node has `attachSignaling`,
    //   ⚠ and this is the same seam here.** ⚠ **Both go through `authorizeUpgrade`, ⚠ so the one
    //   ⚠ refusal is the one refusal** (`.claude/rules/security.md` § 3).
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const sessions = this.sessions;
      if (sessions === null) return new Response(null, { status: 401 });
      return upgrade(request, {
        sessions,
        secret: ctx.secret,
        pair: workerSocketPair,
      });
    }

    const before = ctx.store.get(roomId) ?? null;

    const answer = await handle(ctx, request);

    // ⚠⚠ **Written after the routing decided, ⚠ never before.**
    //
    // ⚠ **`handle` is the one that knows whether a room was made, touched or closed.**
    // ⚠ **Reading the store afterwards is how this object stays out of those decisions**
    //   (`CLAUDE.md` § 3).
    await this.persist(before, ctx.store.get(roomId) ?? null);
    return answer;
  }

  /**
   * ⚠ **Write when it changed, ⚠ and delete when it went.**
   *
   * ⚠ **A write on every request would be a write on every knock read.** ⚠ **What moves is
   * `lastSeenAt`, ⚠ and that is the field the room's life hangs on** (`docs/adr/0010`) — ⚠ **so
   * it is written when it moves, and not otherwise.**
   */
  private async persist(before: Room | null, after: Room | null): Promise<void> {
    if (after === null) {
      // ⚠⚠ The room is over. ⚠ Holding what it was is how a record starts (`docs/adr/0023`).
      if (before !== null) await this.state.storage.delete(KEY);
      return;
    }
    if (before !== null && before.lastSeenAt === after.lastSeenAt) return;

    // ⚠⚠ **Four fields, ⚠ named one by one** (`docs/adr/0023`).
    //
    // ⚠ **Writing `after` whole would write whatever `Room` grows next.** ⚠ **Naming them is what
    //   ⚠ makes "we write four fields" a fact rather than a hope.**
    await this.state.storage.put(KEY, {
      id: after.id,
      hostKey: after.hostKey,
      createdAt: after.createdAt,
      lastSeenAt: after.lastSeenAt,
    });

    // ⚠⚠ **When this room is over** (`docs/adr/0025`).
    //
    // ⚠ **Moved with `lastSeenAt`, ⚠ because that is what the life hangs on**
    //   (`docs/adr/0010`). ⚠ **A room that is being used keeps pushing its own end away.**
    await this.state.storage.setAlarm(after.lastSeenAt + ROOM_IDLE_MS);
  }

  /**
   * ⚠⚠ **The room is over, ⚠ and lets go of itself** (`docs/adr/0025`).
   *
   * ⚠ **`docs/adr/0010` already said an expired room answers exactly like one that never
   * existed, ⚠ and that it does not wait to be collected** — ⚠ **`store.get` refuses it the
   * moment it expires.** ⚠ **This is the other half: ⚠ not keeping what nobody can reach.**
   *
   * ⚠ **`docs/adr/0023` said writing brings an obligation to delete.** ⚠ **This is it.**
   */
  async alarm(): Promise<void> {
    const held = await this.state.storage.get<Room>(KEY);
    if (held === undefined) {
      // ⚠ Already gone. ⚠ Nothing to do, ⚠ and nothing to say.
      await this.state.storage.deleteAlarm();
      return;
    }

    // ⚠ Still in use. ⚠ A heartbeat moved it after the alarm was set, ⚠ so this is early
    //   ⚠ rather than wrong — ⚠ come back when it is actually over.
    const over = held.lastSeenAt + ROOM_IDLE_MS;
    if (Date.now() < over) {
      await this.state.storage.setAlarm(over);
      return;
    }

    // ⚠ The sockets first, so nobody is left holding a room that no longer exists —
    //   ⚠ the same order `src/node-server.ts` uses when its sweeper finds one.
    this.ctx?.hub.closeRoom(held.id, CLOSE_ROOM_CLOSED, "this room was left open and has expired");
    this.ctx?.store.close(held.id);
    await this.state.storage.delete(KEY);
    await this.state.storage.deleteAlarm();

    // ⚠ Says the room is over, ⚠ and says nothing about who was in it
    //   (`.claude/rules/security.md` § 2).
    logger.info("a room expired", { roomId: held.id });
  }

  /** ⚠ **Which room this object is holding.** ⚠ For checks; ⚠ never served. */
  which(): string | null {
    return this.roomId;
  }
}
