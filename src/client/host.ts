// The host's side of making a room.
//
// ⚠ **The host receives two things once, and never again: the passphrase and the host key**
//   (`docs/adr/0004`, `docs/adr/0005`). ⚠ **Both live in this page's memory and nowhere else.**
//
// ## ⚠ Why there is no "copy both"
//
// ⚠ **The URL and the passphrase are supposed to travel by different routes.**
// ⚠ **That separation is the only wall standing between a leaked link and a stranger in the room**
//   (`docs/PRODUCT.md` § 3).
// ⚠ **One button that puts both on the clipboard collapses it into one paste, into one channel.**
// ⚠ **So there are two, and they are never joined.**
//
// ## ⚠ Why the passphrase is not in the URL
//
// ⚠ **A URL is written to history, to the referer header, and to every log in between**
//   (`.claude/rules/security.md` § 2). ⚠ **Nothing here ever puts it there, and the final gate
//   ⚠ checks that it did not.**

export type CreatedRoom = {
  readonly roomId: string;
  readonly shareUrl: string;
  readonly passphrase: string;
  readonly hostKey: string;
};

export const createRoom = async (origin: string = location.origin): Promise<CreatedRoom> => {
  const res = await fetch(new URL("/api/rooms", origin), { method: "POST" });
  if (!res.ok) throw new Error("the room could not be made");
  return (await res.json()) as CreatedRoom;
};

/** ⚠ **The host holds the passphrase to get its own join token, once.** ⚠ Then it stops reading it. */
export const joinOwnRoom = async (
  roomId: string,
  passphrase: string,
  origin: string = location.origin,
): Promise<string> => {
  const res = await fetch(new URL(`/api/rooms/${roomId}/join`, origin), {
    method: "POST",
    body: JSON.stringify({ passphrase }),
  });
  if (!res.ok) throw new Error("the room could not be opened");
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
