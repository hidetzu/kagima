// The host's side of making a room.
//
// ⚠ **The Host receives three things once, and never again: ⚠ the room id, the host key and its
//   ⚠ own join token** (`docs/adr/0017`).
//
// ⚠ **There is no passphrase.** ⚠ **Who comes in is the Host's decision, ⚠ made while they are
//   ⚠ sitting there with the socket open** — ⚠ **not something a caller can know.**
//
// ⚠ **So the URL carries only "you may knock here".** ⚠ **A leaked URL lets somebody knock; ⚠ it
//   ⚠ does not let them in.**

export type CreatedRoom = {
  readonly roomId: string;
  readonly shareUrl: string;
  /** ⚠ **The Host's own way in.** ⚠ Handed over once, ⚠ at creation, ⚠ and never again. */
  readonly token: string;
  readonly hostKey: string;
};

export const createRoom = async (origin: string = location.origin): Promise<CreatedRoom> => {
  const res = await fetch(new URL("/api/rooms", origin), { method: "POST" });
  if (!res.ok) throw new Error("the room could not be made");
  return (await res.json()) as CreatedRoom;
};

export const closeRoom = async (
  roomId: string,
  hostKey: string,
  origin: string = location.origin,
): Promise<boolean> => {
  const res = await fetch(new URL(`/api/rooms/${roomId}`, origin), {
    method: "DELETE",
    body: JSON.stringify({ hostKey }),
  });
  return res.ok;
};

/**
 * ⚠ **Copying one thing.** ⚠ **Never two.**
 *
 * ⚠ **Returns whether it worked, because a clipboard can be refused** — ⚠ **and a button that
 * silently does nothing is worse than one that says it could not.**
 */
export const copyOne = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
