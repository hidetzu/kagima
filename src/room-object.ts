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
// ⚠ **Four fields, ⚠ and one number** (`docs/adr/0023`, `docs/adr/0031`).
//   ⚠ **Never a knock, ⚠ never a token, ⚠ never a name.**
import { createKnockRejectionCounter, createKnocks } from "./knock/knocks.ts";
import { openWait, roomIdFromWaitPath } from "./knock/wait.ts";
import { LEDGER_NAME } from "./ledger-object.ts";
import { logger } from "./log.ts";
import { randomToken } from "./random.ts";
import { createRoomStore, ROOM_IDLE_MS, type Room } from "./room/store.ts";
import { type Context, handle } from "./server.ts";
import { upgrade, workerSocketPair } from "./signaling/attach-worker.ts";
import { createHub } from "./signaling/hub.ts";
import { valueFromProtocols } from "./signaling/authorize.ts";
import { CLOSE_ROOM_CLOSED, KNOCK_PROTOCOL_PREFIX } from "./signaling/protocol.ts";
import { createSessions, type Sessions } from "./signaling/session.ts";

/** ⚠ **The one key.** ⚠ **One room per object, ⚠ so there is nothing to key by.** */
const KEY = "room";

/**
 * ⚠⚠ **The fifth thing this object writes** (`docs/adr/0031`; ⚠ `docs/adr/0023` wrote four).
 *
 * ⚠ **One number: ⚠ how many milliseconds this room has been held by at least one socket,
 * ⚠ in total, ⚠ across every span.** ⚠ **It is nobody's information** — ⚠ **the room does not
 * know who signed in and must not learn** (`src/quota/ledger.ts` holds the mark instead).
 * ⚠ **Its own key rather than a field on `Room`**: ⚠ **`Room` is platform-free, ⚠ and how long a
 * Durable Object was held is not something Node's room has any use for.**
 */
const USED_KEY = "usedMs";

/**
 * ⚠ **How often a room says how long it has been held** (`docs/adr/0031`).
 *
 * ⚠ **Not on every heartbeat.** ⚠ **The heartbeat is 20 s** (`src/signaling/session.ts`),
 * ⚠ **and a cap measured in hours does not need to be told three times a minute** — ⚠ **each
 * telling wakes the ledger, ⚠ and the ADR's own overhead estimate is 1,200 wakes a day.**
 * ⚠ **The last one is never throttled**: ⚠ **a span that is over is reported whatever the clock
 * says.**
 */
const TELL_THE_LEDGER_EVERY_MS = 60_000;

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
/**
 * ⚠⚠ **A socket that survives the object being put to sleep** (`docs/adr/0028`).
 *
 * ⚠ **Named here in our own words, ⚠ like everything else this object uses of the platform.**
 * ⚠ **`serializeAttachment` is what carries who this socket is across a hibernation** —
 * ⚠ **the object's memory does not survive it** (⚠ Cloudflare の公開文書、⚠ 参照日 2026-09-07),
 * ⚠ **and this project writes no knock to storage** (`docs/adr/0023`).
 */
export type HibernatableSocket = {
  send(line: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

/** ⚠ **What a waiting socket remembers about itself.** ⚠ **Never a token, ⚠ never a host key.** */
type Waiting = {
  readonly roomId: string;
  readonly knockId: string;
  readonly nickname: string;
  readonly at: number;
};

export type RoomState = {
  /**
   * ⚠⚠ **Accepted so the object may hibernate while somebody waits** (`docs/adr/0028`).
   *
   * ⚠ **`ws.accept()` would keep this object active for the whole time the socket is connected**
   * (⚠ Cloudflare の公開料金仕様、⚠ 参照日 2026-09-07). ⚠ **The signalling socket still uses
   * that; ⚠ this one must not**, ⚠ **because the case it exists for is exactly the case where
   * nothing else is holding the object open.**
   */
  acceptWebSocket(ws: unknown): void;
  /** ⚠ **Every socket accepted the hibernatable way.** ⚠ **How the door is rebuilt after a sleep.** */
  getWebSockets(): readonly HibernatableSocket[];
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
  /**
   * ⚠⚠ **The day's budget** (`docs/adr/0031`). ⚠ **Optional here on purpose.**
   *
   * ⚠ **A room reports how long it has been held; ⚠ it never asks whether it may exist.**
   * ⚠ **That decision was made before this object was addressed** (`src/worker.ts`).
   * ⚠ **Absent means nobody is counting** — ⚠ **which is the configuration with no sign-in, ⚠ and
   * `docs/SPEC.md` says which claim holds where.**
   */
  readonly LEDGER?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};

export class RoomObject {
  state: RoomState;
  env: RoomEnv;

  private ctx: Context | null = null;
  private sessions: Sessions | null = null;
  /**
   * ⚠ **How to stop watching, ⚠ per waiting socket.**
   *
   * ⚠ **Only valid for this wake.** ⚠ **After a hibernation the object is new and this is empty**
   * — ⚠ **which is correct, ⚠ because the watchers are gone too and `context` rebuilds both from
   * the sockets themselves.**
   */
  private waiters = new Map<unknown, () => void>();
  /** ⚠ **The id this object is holding.** ⚠ Learned from the Worker, ⚠ never from a caller. */
  private roomId: string | null = null;
  /** ⚠ **Spans that are finished.** ⚠ Read back from storage on every wake (`docs/adr/0031`). */
  private usedMs = 0;
  /** ⚠ **When the ledger was last told.** ⚠ This wake only; ⚠ a fresh object simply tells again. */
  private toldAt = 0;

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
      // ⚠⚠ **How long this room has been held** (`docs/adr/0031`).
      //   ⚠ **A total, ⚠ never a difference** — ⚠ **the ledger adds `total − last`, ⚠ so a
      //   ⚠ repeat adds nothing and a room that came back does not start again from zero.**
      usedSoFar: (id, spanMs, stillHolding) => {
        if (stillHolding) {
          void this.tellTheLedger(id, this.usedMs + spanMs, false, true);
          return;
        }
        // ⚠ The span is over. ⚠ Added in memory first, ⚠ so anything that reads it next —
        //   ⚠ including the room ending a moment later — ⚠ sees the finished total.
        this.usedMs += spanMs;
        void this.state.storage.put(USED_KEY, this.usedMs);
        void this.tellTheLedger(id, this.usedMs, false, false);
      },
    });

    this.usedMs = (await this.state.storage.get<number>(USED_KEY)) ?? 0;

    // ⚠⚠ **Rebuild the door from the sockets standing at it** (`docs/adr/0028`).
    //
    // ⚠ **A hibernating object loses what it held in memory, ⚠ and knocks are never written to
    //   ⚠ storage** (`docs/adr/0023`: ⚠ **four fields, ⚠ never a knock, ⚠ never a name**).
    // ⚠ **So the people at the door ARE the open waiting sockets** — ⚠ **there is no second copy
    //   ⚠ to drift** (`CLAUDE.md` § 3).
    for (const ws of this.state.getWebSockets()) this.watchOn(ctx, ws);

    this.ctx = ctx;
    return ctx;
  }

  /**
   * ⚠⚠ **Say how long this room has been held, ⚠ and whether it is over** (`docs/adr/0031`).
   *
   * ⚠ **Never awaited by anything a person is waiting on.** ⚠ **A ledger that is slow must not
   * make a call slow** — ⚠ **and a report that does not land is not a room that stops.**
   * ⚠ **The decision this room may exist was made before it was addressed** (`src/worker.ts`);
   * ⚠ **this is only counting, ⚠ and counting late is not counting twice.**
   */
  private async tellTheLedger(
    roomId: string,
    totalMs: number,
    isOver: boolean,
    throttled: boolean,
  ): Promise<void> {
    const ledger = this.env.LEDGER;
    if (ledger === undefined) return;
    const at = Date.now();
    if (throttled && at - this.toldAt < TELL_THE_LEDGER_EVERY_MS) return;
    this.toldAt = at;
    try {
      await ledger.get(ledger.idFromName(LEDGER_NAME)).fetch(
        new Request("https://kagima.invalid/ledger", {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ ask: "used", roomId, totalMs, over: isOver }),
        }),
      );
    } catch (error) {
      // ⚠ Counted, ⚠ so a report that never landed is not indistinguishable from one that was
      //   ⚠ never sent (`.claude/rules/evidence.md`). ⚠ Says the room, ⚠ and nothing about anyone.
      logger.info("a room could not tell the day's budget", { roomId, why: String(error) });
    }
  }

  /**
   * ⚠ **Put one waiting socket back on its knock.**
   *
   * ⚠ **A socket with nothing attached is one we never registered** — ⚠ **it waits in silence,
   * ⚠ exactly as it did before, ⚠ and exactly as an unknown room does**
   * (`.claude/rules/security.md` § 3).
   */
  private watchOn(ctx: Context, ws: HibernatableSocket): void {
    const held = ws.deserializeAttachment() as Waiting | null;
    if (held === null || held === undefined) return;
    const restored = ctx.knocks.restore(held.roomId, held.knockId, held.nickname, held.at);
    if (restored.refused !== null) ctx.knockRejections.record(restored.refused);
    const { stop, refused } = openWait(ctx.knocks, held.roomId, held.knockId, ws);
    if (refused !== null) ctx.knockRejections.record(refused);
    this.waiters.set(ws, stop);
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
      // ⚠⚠ **The waiting socket, ⚠ which is not a way in** (`docs/adr/0028`, `src/knock/wait.ts`).
      //
      // ⚠ **It is accepted before anything is known about the room** — ⚠ **a room that does not
      //   ⚠ exist, ⚠ a Host who has not answered, ⚠ a knock dropped at the cap and a watcher
      //   ⚠ dropped at the cap are one behaviour: ⚠ accepted, ⚠ silent**
      //   (`.claude/rules/security.md` § 3).
      const waitingFor = roomIdFromWaitPath(new URL(request.url).pathname);
      if (waitingFor !== null) return this.acceptWait(ctx, request, waitingFor);

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
      if (before !== null) {
        await this.state.storage.delete(KEY);
        await this.state.storage.delete(USED_KEY);
        // ⚠⚠ **The last word** (`docs/adr/0031`). ⚠ **Its row goes, ⚠ so the cap on how many are
        //   ⚠ open comes back down.** ⚠ **The sockets were closed first, ⚠ so their span is
        //   ⚠ already in `usedMs`** (`src/server.ts` closes the hub before the store).
        await this.tellTheLedger(before.id, this.usedMs, true, false);
        this.usedMs = 0;
      }
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
    // ⚠⚠ **The backstop** (`docs/adr/0031`). ⚠ **A room whose object went away without a last
    //   ⚠ word still ends here** — ⚠ **so its row cannot hold a slot until the day turns.**
    // ⚠ **The larger of the two.** ⚠ **`alarm()` can run on a wake where nothing else did, ⚠ so
    //   ⚠ memory may hold 0 while storage holds the total** — ⚠ **and a span that closed a moment
    //   ⚠ ago is in memory before its write has landed.**
    const usedMs = Math.max(this.usedMs, (await this.state.storage.get<number>(USED_KEY)) ?? 0);
    await this.state.storage.delete(USED_KEY);
    await this.tellTheLedger(held.id, usedMs, true, false);
    this.usedMs = 0;
    await this.state.storage.deleteAlarm();

    // ⚠ Says the room is over, ⚠ and says nothing about who was in it
    //   (`.claude/rules/security.md` § 2).
    logger.info("a room expired", { roomId: held.id });
  }

  /**
   * ⚠⚠ **Accept a waiting socket, ⚠ whatever it turns out to be about.**
   *
   * ⚠ **Nothing about the room is read before the handshake is accepted.** ⚠ **Refusing a
   * handshake for a room that does not exist would answer "does this room exist?" for free**
   * (`.claude/rules/security.md` § 3).
   *
   * ⚠ **The nickname comes from the knock that is already at the door, ⚠ not from the caller** —
   * ⚠ **a socket cannot name itself into somebody else's room.** ⚠ **When the knock is not there
   * (⚠ this object was evicted between the knock and the socket), ⚠ nothing is attached and the
   * socket waits in silence**, ⚠ **which is what that Guest saw before this change too.**
   */
  private acceptWait(ctx: Context, request: Request, roomId: string): Response {
    const offered = request.headers.get("sec-websocket-protocol");
    const knockId = valueFromProtocols(offered, KNOCK_PROTOCOL_PREFIX);
    if (knockId === null) return new Response(null, { status: 401 });

    const pair = workerSocketPair();
    const server = pair[1] as unknown as HibernatableSocket;
    // ⚠⚠ **Not `server.accept()`.** ⚠ **That is the whole point** (`docs/adr/0028`).
    this.state.acceptWebSocket(server);

    const standing = ctx.knocks.waiting(roomId).find((k) => k.id === knockId);
    if (standing !== undefined) {
      const held: Waiting = {
        roomId,
        knockId,
        nickname: standing.nickname,
        at: standing.at,
      };
      server.serializeAttachment(held);
    }
    this.watchOn(ctx, server);

    const headers = new Headers();
    const ours = (offered ?? "")
      .split(",")
      .map((p) => p.trim())
      .find((p) => p.startsWith(KNOCK_PROTOCOL_PREFIX));
    if (ours !== undefined) headers.set("sec-websocket-protocol", ours);
    return new Response(null, { status: 101, webSocket: pair[0], headers } as ResponseInit);
  }

  /**
   * ⚠ **Nothing is ever read off a waiting socket.**
   *
   * ⚠ **A Guest that sends something is not doing anything this door has a use for**, ⚠ **and
   * answering would be a second channel to keep identical** (`docs/adr/0028`).
   * ⚠ **So it is dropped without a word** — ⚠ **and it is not counted as a rejection either,
   * ⚠ because nothing was rejected: ⚠ the socket is still open and still waiting.**
   */
  webSocketMessage(): void {}

  /** ⚠ **Stop watching.** ⚠ **A socket that has gone is not somebody at the door.** */
  webSocketClose(ws: unknown): void {
    this.waiters.get(ws)?.();
    this.waiters.delete(ws);
  }

  /** ⚠ **Same as a close.** ⚠ **From here the two are one event: ⚠ they are not standing there.** */
  webSocketError(ws: unknown): void {
    this.webSocketClose(ws);
  }

  /** ⚠ **Which room this object is holding.** ⚠ For checks; ⚠ never served. */
  which(): string | null {
    return this.roomId;
  }
}
