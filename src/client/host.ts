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
  /**
   * ⚠ **A token with no role** (`docs/adr/0018`).
   *
   * ⚠⚠ **Not what the Host connects with.** ⚠ **A connection made with this cannot open its own
   * door** — ⚠ **`hostSession` below is what the Host uses.**
   */
  readonly token: string;
  /**
   * ⚠ **The room's own key.** ⚠ **It closes the room, ⚠ and it buys a host session.**
   * ⚠ **It stays in this page and goes on the wire only to those two endpoints.**
   */
  readonly hostKey: string;
};

export const createRoom = async (origin: string = location.origin): Promise<CreatedRoom> => {
  const res = await fetch(new URL("/api/rooms", origin), { method: "POST" });
  if (!res.ok) throw new Error("the room could not be made");
  return (await res.json()) as CreatedRoom;
};

/**
 * ⚠⚠ **Exchange the room's key for a short-lived role inside that room** (`docs/adr/0018`).
 *
 * ⚠ **Done once, before connecting.** ⚠ **Nothing after this reads `hostKey` again**
 * (`.claude/rules/security.md` § 4).
 *
 * ⚠ **Every refusal looks the same** — ⚠ **a wrong key and a room that is not there are one
 * answer** — ⚠ **so there is nothing to tell apart here either.**
 */
export const hostSession = async (
  roomId: string,
  hostKey: string,
  origin: string = location.origin,
): Promise<string> => {
  const res = await fetch(new URL(`/api/rooms/${roomId}/host-session`, origin), {
    method: "POST",
    body: JSON.stringify({ hostKey }),
  });
  if (!res.ok) throw new Error("this room could not be opened as its host");
  return ((await res.json()) as { token: string }).token;
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
