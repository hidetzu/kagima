// Creating a room: an id nobody can guess, a passphrase a person can say, and the link to hand over.
//
// ⚠ **Everything this needs is injected.** ⚠ **Not for elegance** — ⚠ **because the two properties
//   ⚠ that matter (a collision is handled; the id comes from a CSPRNG) cannot be shown against a
//   ⚠ real generator.** ⚠ **A collision would have to be waited for, and waiting is not a test.**
import { randomBytes } from "node:crypto";
import { generatePassphrase } from "../passphrase/passphrase.ts";
import { buildShareUrl, generateRoomId } from "./room-id.ts";
import type { Room, RoomStore } from "./store.ts";
import { asPassphrase } from "./types.ts";

/**
 * ⚠ **How many ids to try before giving up.**
 *
 * ⚠ **With `ROOM_ID_BITS` of entropy a collision is not a thing that happens; this exists because
 * "not a thing that happens" is not "cannot happen"**, ⚠ **and the alternative to a bound is a
 * loop that never ends when the generator is broken.**
 * ⚠ **Giving up loudly beats spinning silently.**
 */
export const MAX_ID_ATTEMPTS = 8;

export type CreateRoomDeps = {
  readonly newId: () => string;
  readonly newPassphrase: () => string;
  /** ⚠ **CSPRNG.** ⚠ A guessable host key lets anyone end anyone's call. */
  readonly newHostKey: () => string;
  readonly now: () => number;
};

/** ⚠ **The real ones.** ⚠ Overridden only by tests, and only to force a state that cannot be waited for. */
export const defaultDeps: CreateRoomDeps = {
  newId: generateRoomId,
  newPassphrase: generatePassphrase,
  newHostKey: () => randomBytes(32).toString("base64url"),
  now: Date.now,
};

export type CreatedRoom = {
  readonly room: Room;
  readonly shareUrl: string;
};

/**
 * ⚠ **The host is the only party that ever receives the passphrase from us**, and only here,
 * ⚠ once. ⚠ **Nothing later re-reads or re-sends it** (`docs/adr/0004`).
 *
 * @throws when no free id was found in `MAX_ID_ATTEMPTS` tries. ⚠ **Never returns a partial room.**
 */
export const createRoom = (
  store: RoomStore,
  baseUrl: string,
  deps: CreateRoomDeps = defaultDeps,
): CreatedRoom => {
  const passphrase = asPassphrase(deps.newPassphrase());
  const hostKey = deps.newHostKey();

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const id = deps.newId();
    const at = deps.now();
    // ⚠ A room nobody ever joins still has a clock, and it starts here.
    const room: Room = { id, passphrase, hostKey, createdAt: at, lastSeenAt: at };
    // ⚠ `add` refuses rather than overwrites, so a collision cannot silently steal a live room.
    if (store.add(room)) return { room, shareUrl: buildShareUrl(baseUrl, id) };
  }

  // ⚠ Says what happened, not an error code (`CLAUDE.md` § 4).
  //   ⚠ It names neither the ids tried nor anything about the room — there is nothing to leak here.
  throw new Error(`could not find a free room id in ${MAX_ID_ATTEMPTS} attempts`);
};
