// ⚠⚠ **One connected participant, ⚠ from the moment the handshake was accepted.**
//
// ⚠ **Nothing here knows which platform carried the frames** — ⚠ **it is handed a
//   ⚠ `SignalingSocket` and talks to that** (`docs/adr/0015`).
// ⚠ **`ws` on Node and `WebSocketPair` in a Worker both reduce to it, ⚠ and this file is the
//   ⚠ reason the port is a new adapter rather than a second copy of the rules**
//   (`CLAUDE.md` § 3).
//
// ## ⚠ Why a heartbeat is not optional
//
// ⚠ **Cloudflare closes a WebSocket that has been quiet, and the timeout is not published**
//   (`docs/adr/0003`, `docs/DISCOVERY.md` § 3).
// ⚠ **And a socket through a tunnel dies quietly** — ⚠ **no close frame, no error, just silence.**
// ⚠ **Without it, this process holds a room slot for a peer that left.**
import type { Knocks } from "../knock/knocks.ts";
import { logger } from "../log.ts";
import { issueJoinToken } from "../token/join-token.ts";
import type { Hub, Peer } from "./hub.ts";
import { MAX_MESSAGE_BYTES, parseClientMessage } from "./messages.ts";
import { CLOSE_BAD_MESSAGE, CLOSE_ROOM_FULL, CLOSE_SILENT } from "./protocol.ts";
import type { SignalingSocket } from "./socket.ts";

export { MAX_MESSAGE_BYTES };

/**
 * ⚠ **How often the server pings.**
 *
 * ⚠ **Well under any idle timeout worth worrying about**, ⚠ **because the number we would need to
 * be under is not published.** ⚠ **Guessing low is the cheap direction to be wrong in.**
 */
export const HEARTBEAT_MS = 20_000;

/** ⚠ **Missed pongs before the socket is treated as gone.** ⚠ One missed ping can be a hiccup. */
export const MISSED_PONGS_ALLOWED = 2;

export type SessionOptions = {
  readonly hub: Hub;
  readonly secret: string;
  /**
   * ⚠ **The door** (`docs/adr/0017`). ⚠ **Absent means no door** — ⚠ **used by checks that only
   * care about relaying.**
   */
  readonly knocks?: Knocks;
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
 * ⚠ **The sessions one server is running.**
 *
 * ⚠ **Per instance, ⚠ not per module.** ⚠ **A module-level map would be shared by every server in
 * the process** — ⚠ **which is one in production and several in the checks, ⚠ where it leaked one
 * room's line into another's measurement.**
 */
export const createSessions = (options: SessionOptions) => {
  const now = options.now ?? Date.now;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;

  /**
   * ⚠ **When each room first had a socket open.** ⚠ **Removed the moment it has none.**
   *
   * ⚠ **In memory, ⚠ like everything else** (`docs/adr/0005`). ⚠ **It never outlives the room,
   * ⚠ and no total is kept across rooms** — ⚠ **a running total would be a record, ⚠ and a record
   * is exactly what kagima does not keep.**
   */
  const roomOpenedAt = new Map<string, number>();
  let nextPeerId = 1;

  const open = (socket: SignalingSocket, roomId: string, sessionId: string): void => {
    const peer: Peer = {
      id: nextPeerId++,
      sessionId,
      send: (line) => socket.send(line),
      close: (code, reason) => socket.close(code, reason),
    };

    if (options.hub.join(roomId, peer) === "room-full") {
      // ⚠ v0.1.0 is two people. ⚠ A third is refused, not queued (`docs/PRODUCT.md` § 3).
      socket.close(CLOSE_ROOM_FULL, "the room already has two people in it");
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
        socket.close(CLOSE_SILENT, "no response to the heartbeat");
        return;
      }
      missed += 1;
      // ⚠ Still here. ⚠ The room's idle clock is pushed back by the same beat that proves it.
      options.touch?.(roomId);
      socket.ping();
    }, heartbeatMs);
    // ⚠ Never hold the process open for a heartbeat.
    beat.unref?.();

    socket.on({
      onPong: () => {
        missed = 0;
      },

      // ⚠ Signalling is text. ⚠ The frame's content is never looked at — ⚠ so nothing a stranger
      //   ⚠ sent as bytes is ever decoded, ⚠ let alone parsed.
      onBinary: () => socket.close(CLOSE_BAD_MESSAGE, "signalling is text"),

      onText: (data) => {
        const parsed = parseClientMessage(data);
        if (!parsed.ok) {
          // ⚠ Told to the sender: this side is not a secret, and the sender is the one who is wrong.
          socket.send(JSON.stringify({ type: "refused", why: parsed.why }));
          return;
        }
        // ⚠⚠ **The Host's decision about somebody at the door** (`docs/adr/0017`).
        //
        // ⚠ **Handled here and never relayed** — ⚠ **the other participant has no business learning
        //   ⚠ who knocked or what was decided about them.**
        // ⚠ **An id we do not know is ignored in silence: ⚠ answering would say which ids are real.**
        // ⚠ **Nothing is said back on success either** — ⚠ **the Host learns the outcome by the
        //   ⚠ knock leaving its list, ⚠ which is what it already watches.**
        if (parsed.message.type === "admit") {
          const { knockId, allow } = parsed.message;
          void (async () => {
            const token = allow ? await issueJoinToken(roomId, options.secret, now()) : null;
            options.knocks?.decide(roomId, knockId, allow, token);
          })().catch(() => {
            // ⚠ Minting failed. ⚠ The knock stays waiting, ⚠ which is what it already looked like —
            //   ⚠ so the Guest sees no difference and the Host can decide again.
          });
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
      },

      onClose: () => {
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
      },
    });
  };

  return { open };
};
