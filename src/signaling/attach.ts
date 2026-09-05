// Wiring the signalling socket onto the one HTTP server (`docs/adr/0002`).
//
// ⚠ **`ws` carries the frames and nothing else** (`docs/adr/0009`).
//   ⚠ **Who may join, which room they are in, and when to hang up are ours.**
//
// ## ⚠ Why the token is not in the URL
//
// ⚠ **A URL is written to history, to the referer header, and to every log in between**
//   (`.claude/rules/security.md` § 2). ⚠ **A join token in a query string is a secret in all of them.**
// ⚠ **A browser cannot set arbitrary headers on a WebSocket handshake** — ⚠ **the one field it can
//   ⚠ set is the subprotocol.** ⚠ **So the token travels there.**
//
// ## ⚠ Why a heartbeat is not optional
//
// ⚠ **Cloudflare closes a WebSocket that has been quiet, and the timeout is not published**
//   (`docs/adr/0003`, `docs/DISCOVERY.md` § 3).
// ⚠ **And a socket through a tunnel dies quietly** — ⚠ **no close frame, no error, just silence.**
// ⚠ **Without a ping, this process holds a room slot for a peer that left.**
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "../log.ts";
import { verifyJoinToken } from "../token/join-token.ts";
import { type Hub, type Peer } from "./hub.ts";
import { MAX_MESSAGE_BYTES, parseClientMessage } from "./messages.ts";

/** ⚠ **The subprotocol that carries the token.** ⚠ The only field a browser can set here. */
export const TOKEN_PROTOCOL_PREFIX = "kagima.token.";

/**
 * ⚠ **How often the server pings.**
 *
 * ⚠ **Well under any idle timeout worth worrying about**, ⚠ **because the number we would need to
 * be under is not published.** ⚠ **Guessing low is the cheap direction to be wrong in.**
 */
export const HEARTBEAT_MS = 20_000;

/** ⚠ **Missed pongs before the socket is treated as gone.** ⚠ One missed ping can be a hiccup. */
export const MISSED_PONGS_ALLOWED = 2;

export const CLOSE_UNAUTHORIZED = 4001;
export const CLOSE_ROOM_FULL = 4002;
export const CLOSE_BAD_MESSAGE = 4003;
export const CLOSE_SILENT = 4004;
/** ⚠ **The host ended the room.** ⚠ Not an error, and the wording the guest sees says so. */
export const CLOSE_ROOM_CLOSED = 4005;

const roomIdFromPath = (url: string): string | null => {
  const m = /^\/api\/rooms\/([^/?]+)\/signal(?:\?|$)/.exec(url);
  return m ? decodeURIComponent(m[1] as string) : null;
};

const tokenFromProtocols = (raw: string | undefined): string | null => {
  if (raw === undefined) return null;
  for (const p of raw.split(",").map((s) => s.trim())) {
    if (p.startsWith(TOKEN_PROTOCOL_PREFIX)) return p.slice(TOKEN_PROTOCOL_PREFIX.length);
  }
  return null;
};

export type SignalingOptions = {
  readonly hub: Hub;
  readonly secret: string;
  /**
   * ⚠ **Called while anybody is connected, so the room does not expire under a live call.**
   *
   * ⚠ **On the heartbeat, not on messages** — ⚠ **a call that has finished negotiating sends
   * nothing for minutes at a time, and a room that died then would look like the network
   * rather than like us** (kagima#11).
   */
  readonly touch?: (roomId: string) => void;
  readonly now?: () => number;
  readonly heartbeatMs?: number;
};

/**
 * ⚠ **Every outcome the handshake can produce, and the ones it cannot**
 * (`.claude/rules/evidence.md` § Outcomes are not one outcome).
 *
 * ```text
 * accepted and handled            a valid token for that room
 * ⚠ malformed                      no token, or a path that is not a room's signal endpoint
 * ⚠ well-formed but declined       a valid token for a different room, or an expired one
 * ⚠ we have not implemented it yet cannot occur — there is one endpoint and it exists
 * ⚠ nothing arrived                cannot occur — this runs on an upgrade that arrived
 * ⚠ a timer expired while waiting  ⚠ CAN occur, later: the heartbeat gives up on a silent socket
 * ```
 *
 * ⚠ **A refused handshake says only that it was refused.** ⚠ **Which of the reasons above it was
 * is not told to the caller** — ⚠ **telling them would answer "does this room exist?"**
 * (`.claude/rules/security.md` § 3).
 */
export const attachSignaling = (server: Server, options: SignalingOptions): WebSocketServer => {
  const now = options.now ?? Date.now;

  /**
   * ⚠ **When each room first had a socket open.** ⚠ **Removed the moment it has none.**
   *
   * ⚠ **Per server, ⚠ not per module.** ⚠ **A module-level map would be shared by every
   * `attachSignaling` in the process** — ⚠ **which is one in production and several in the
   * checks, ⚠ where it leaked one room's line into another's measurement.**
   *
   * ⚠ **In memory, ⚠ like everything else** (`docs/adr/0005`). ⚠ **It never outlives the room,
   * ⚠ and no total is kept across rooms** — ⚠ **a running total would be a record, ⚠ and a record
   * is exactly what kagima does not keep.**
   */
  const roomOpenedAt = new Map<string, number>();
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;

  // ⚠ `noServer`, so the upgrade is ours to accept or refuse before `ws` sees it.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    // ⚠ The subprotocol must be echoed back or a browser closes the connection itself.
    //   ⚠ Echoed verbatim, which means the token appears in the response header too — ⚠ only to
    //   ⚠ the client that just sent it, over the same TLS connection.
    handleProtocols: (protocols) =>
      [...protocols].find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX)) ?? false,
  });
  let nextPeerId = 1;

  server.on("upgrade", (req, socket, head) => {
    const roomId = roomIdFromPath(req.url ?? "");
    const token = tokenFromProtocols(req.headers["sec-websocket-protocol"]);

    // ⚠ One answer for every refusal, exactly as the join endpoint does.
    const refuse = (): void => {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    };

    if (roomId === null || token === null) return refuse();
    const checked = verifyJoinToken(token, roomId, options.secret, now());
    if (!checked.ok) return refuse();

    wss.handleUpgrade(req, socket, head, (ws) => accept(ws, roomId, checked.sessionId));
  });

  const accept = (ws: WebSocket, roomId: string, sessionId: string): void => {
    const peer: Peer = {
      id: nextPeerId++,
      sessionId,
      send: (line) => ws.send(line),
      close: (code, reason) => ws.close(code, reason),
    };

    if (options.hub.join(roomId, peer) === "room-full") {
      // ⚠ v0.1.0 is two people. ⚠ A third is refused, not queued (`docs/PRODUCT.md` § 3).
      ws.close(CLOSE_ROOM_FULL, "the room already has two people in it");
      return;
    }

    // ⚠ The room id is not a secret to someone already inside it; ⚠ the passphrase is never
    //   ⚠ mentioned again from here on (`docs/adr/0004`).
    logger.info("a peer joined", { roomId, peers: options.hub.peerCount(roomId) });

    // ⚠⚠ **How long a WebSocket kept this room's object awake** (`docs/adr/0015`, kagima#47).
    //
    // ⚠ **On Durable Objects, ⚠ an accepted WebSocket keeps the object active for the whole time
    //   ⚠ it is connected** (⚠ Cloudflare の公開文書、⚠ 参照日 2026-09-05)。
    // ⚠ **Under kagima's current shape** — ⚠ **a host holding a socket open while the URL is
    //   ⚠ handed over, ⚠ then a call** — ⚠ **this is expected to be the main part of duration.**
    //
    // ⚠⚠ **It is NOT the same as Cloudflare's total billable duration.**
    //   ⚠ **Handling requests, ⚠ running event handlers and ⚠ idle time that does not qualify for
    //   ⚠ hibernation all add duration too.** ⚠ **This measures one part** — ⚠ **the part this
    //   ⚠ design controls** — ⚠ **and it must not be quoted as a bill.**
    //
    // ⚠⚠ **And it is per ROOM, ⚠ not per socket.** ⚠ **Two people for thirty minutes is thirty
    //   ⚠ minutes of an awake object, ⚠ not sixty.** ⚠ **Summing sockets would double it, ⚠ and we
    //   ⚠ would plan against a number twice the truth.**
    //
    // ⚠ **Held in this process's memory for the life of the room and nowhere else**
    //   (`docs/adr/0005`). ⚠ **Nothing is written, ⚠ nothing is served, ⚠ no total accumulates
    //   ⚠ across rooms** — ⚠ **this project has already paid once for collecting things "just to
    //   ⚠ measure"** (`docs/adr/0011`, `docs/adr/0014`).
    const openedAt = now();
    if (!roomOpenedAt.has(roomId)) roomOpenedAt.set(roomId, openedAt);

    let missed = 0;
    const beat = setInterval(() => {
      if (missed >= MISSED_PONGS_ALLOWED) {
        // ⚠ A timer expiring is not an answer; it is the absence of one
        //   (`.claude/rules/evidence.md`). ⚠ So this says "silent", not "left".
        clearInterval(beat);
        ws.close(CLOSE_SILENT, "no response to the heartbeat");
        return;
      }
      missed += 1;
      // ⚠ Still here. ⚠ The room's idle clock is pushed back by the same beat that proves it.
      options.touch?.(roomId);
      ws.ping();
    }, heartbeatMs);
    // ⚠ Never hold the process open for a heartbeat.
    beat.unref?.();
    ws.on("pong", () => {
      missed = 0;
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        ws.close(CLOSE_BAD_MESSAGE, "signalling is text");
        return;
      }
      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) {
        // ⚠ Told to the sender: this side is not a secret, and the sender is the one who is wrong.
        ws.send(JSON.stringify({ type: "refused", why: parsed.why }));
        return;
      }
      // ⚠ Relayed opaque, with `from` filled in here rather than taken from the client.
      const line = JSON.stringify({ ...parsed.message, from: peer.id });
      const result = options.hub.relay(roomId, peer.id, line);
      if (result === "stale") {
        // ⚠ This peer has been replaced by a reconnect. ⚠ Its message is from a connection that
        //   ⚠ no longer represents anybody, and delivering it would apply an old answer to a
        //   ⚠ negotiation that has moved on.
        logger.info("a message from a replaced connection was dropped", { roomId });
      }
    });

    ws.on("close", () => {
      clearInterval(beat);
      const remaining = options.hub.leave(roomId, peer.id);
      // ⚠ Tell whoever is still there. ⚠ "The other side left" is recoverable and is NOT
      //   ⚠ "the room ended" — ⚠ the two get different words, and the client keeps them apart.
      for (const other of remaining) other.send(JSON.stringify({ type: "peer-left" }));
      // ⚠ The room is NOT closed here. ⚠ A signalling socket dropping is not a room ending —
      //   ⚠ an established peer-to-peer call carries on without us (`docs/adr/0003`).
      //   ⚠ Closing a room is kagima#10, and it is the host's decision.
      const stillThere = options.hub.peerCount(roomId);
      logger.info("a peer left", {
        roomId,
        peers: stillThere,
        // ⚠ This socket's own time. ⚠ Useful for reading one session; ⚠ NOT the room's figure.
        heldMs: Math.round(now() - openedAt),
      });

      // ⚠⚠ The room's own span, ⚠ announced the moment it is known and then forgotten.
      //   ⚠ A room with nobody in it is no longer held awake by a socket.
      if (stillThere === 0) {
        const from = roomOpenedAt.get(roomId);
        roomOpenedAt.delete(roomId);
        if (from !== undefined) {
          logger.info("a room stopped holding sockets", {
            roomId,
            // ⚠ Named for exactly what it is: ⚠ wall-clock with at least one socket open.
            //   ⚠ ⚠ Not "the duration charged" — ⚠ see the note where this starts.
            socketOpenMs: Math.round(now() - from),
          });
        }
      }
    });
  };

  return wss;
};
