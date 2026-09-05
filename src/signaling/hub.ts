// Who is in which room, and what may be relayed to whom.
//
// ⚠ **This holds no negotiation state.** ⚠ **It does not know what an offer is.**
//   ⚠ **It knows which two sockets belong to one room, and it refuses everything else.**
//
// ## ⚠ The stale-message problem, and why reading the code will not find it
//
// ⚠ **A guest reconnects.** ⚠ **The old socket has a message already in flight.**
// ⚠ **It arrives after the new socket has joined.**
// ⚠ **Relaying it would apply an old peer's answer to a negotiation that has moved on**
//   (`.claude/skills/change-review/SKILL.md` § 4 — ⚠ **arrival order is not send order**).
//
// ⚠ **The way to check that is not to read.** ⚠ **It is to reorder** — ⚠ **and `test/hub.test.ts`
//   ⚠ does exactly that: it joins, replaces, and then delivers from the old peer.**

/** ⚠ **v0.1.0 is two people** (`docs/PRODUCT.md` § 3). ⚠ **A third is refused, not queued.** */
export const ROOM_CAPACITY = 2;

export type Peer = {
  /** ⚠ **Assigned here, never taken from the client.** ⚠ A client-chosen id is a way to impersonate. */
  readonly id: number;
  /**
   * ⚠ **Which join this connection belongs to.**
   *
   * ⚠ **Taken from the token's nonce, so a reconnect within the token's life is recognisable as
   * the same participant rather than as a third person.**
   * ⚠ **Without it, a half-open socket holds the slot and the reconnect is refused as room-full** —
   * ⚠ **which is exactly what happens through a tunnel, where the old socket dies quietly.**
   */
  readonly sessionId: string;
  send(line: string): void;
  close(code: number, reason: string): void;
};

/** ⚠ **Sent to a socket that a reconnect has replaced.** ⚠ Its own doing; not an error. */
export const CLOSE_REPLACED = 4000;

export type JoinResult = "joined" | "room-full";

/**
 * ⚠ **Why a relay did not happen.**
 *
 * ⚠ **`stale` is the one that matters** — ⚠ **it means the sender is no longer this room's peer,
 * and the message is from a connection that has been replaced.**
 */
export type RelayResult = "relayed" | "no-peer" | "stale";

export type Hub = {
  join(roomId: string, peer: Peer): JoinResult;
  /**
   * ⚠ **Returns who is still there.**
   *
   * ⚠ **So the caller can tell them.** ⚠ **A peer whose partner dropped and is told nothing sits
   * looking at a frozen picture** — ⚠ **and "the other side left" is not "the room ended", which
   * is the distinction this whole file exists to keep** (kagima#11).
   */
  leave(roomId: string, peerId: number): Peer[];
  relay(roomId: string, fromPeerId: number, line: string): RelayResult;
  /**
   * ⚠ **Say something to everyone in a room, ⚠ from us rather than from a peer.**
   *
   * ⚠ **Used to tell the Host that somebody is at the door** (`docs/adr/0017`).
   * ⚠ **`relay` cannot do it: ⚠ it excludes the sender and there is no sender here.**
   */
  announce(roomId: string, line: string): void;
  /** ⚠ For tests and for closing a room (kagima#10). ⚠ Never served over HTTP. */
  peerCount(roomId: string): number;
  /** ⚠ **Every peer in the room, so a room can be closed.** */
  closeRoom(roomId: string, code: number, reason: string): void;
};

export const createHub = (): Hub => {
  // ⚠ In this process only, like everything else about a room (`docs/adr/0005`).
  const rooms = new Map<string, Peer[]>();

  const peersOf = (roomId: string): Peer[] => rooms.get(roomId) ?? [];

  return {
    join(roomId, peer) {
      const peers = peersOf(roomId);

      // ⚠ A reconnect replaces its own previous socket rather than taking a second slot.
      //   ⚠ The old one is closed here, so it cannot sit half-open holding the room at capacity.
      const previous = peers.filter((p) => p.sessionId === peer.sessionId);
      const others = peers.filter((p) => p.sessionId !== peer.sessionId);
      for (const old of previous) old.close(CLOSE_REPLACED, "replaced by a newer connection");

      if (others.length >= ROOM_CAPACITY) return "room-full";
      rooms.set(roomId, [...others, peer]);
      return "joined";
    },

    announce(roomId, line) {
      for (const peer of peersOf(roomId)) peer.send(line);
    },

    leave(roomId, peerId) {
      const remaining = peersOf(roomId).filter((p) => p.id !== peerId);
      if (remaining.length === 0) rooms.delete(roomId);
      else rooms.set(roomId, remaining);
      return remaining;
    },

    relay(roomId, fromPeerId, line) {
      const peers = peersOf(roomId);
      // ⚠ The sender must still BE this room's peer. ⚠ A socket that has been replaced is not,
      //   ⚠ and its late message is dropped rather than delivered as current.
      if (!peers.some((p) => p.id === fromPeerId)) return "stale";

      const others = peers.filter((p) => p.id !== fromPeerId);
      if (others.length === 0) return "no-peer";
      for (const other of others) other.send(line);
      return "relayed";
    },

    peerCount(roomId) {
      return peersOf(roomId).length;
    },

    closeRoom(roomId, code, reason) {
      for (const peer of peersOf(roomId)) peer.close(code, reason);
      rooms.delete(roomId);
    },
  };
};
