// The guest's side of getting into a room.
//
// ⚠ **This is the only door an attacker also walks through** (`docs/PRODUCT.md` § 3).
//   ⚠ **So the wording here is part of the security, not a finishing touch:**
//   ⚠ **a wrong passphrase, a room that never existed and a room being hammered must read the
//   ⚠ same** (`docs/adr/0004`, `.claude/rules/security.md` § 3).
//
// ⚠ **The server already answers all three identically.** ⚠ **This file's job is not to undo that
//   ⚠ by explaining the difference in words the server refused to give.**

/** ⚠ **The room id, taken from the path.** ⚠ **Never from a query string somebody can craft.** */
export const roomIdFromPath = (pathname: string): string | null =>
  /^\/r\/([0-9a-z]{16})$/.exec(pathname)?.[1] ?? null;

export type JoinRefusal = "refused" | "malformed" | "unreachable";

export type JoinResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly why: JoinRefusal };

/**
 * ⚠ **Exchange the passphrase for a token, once.**
 *
 * ⚠ **`refused` is deliberately one value.** ⚠ **The server returns one answer for a wrong
 * passphrase, an unknown room and a rate-limited attempt** — ⚠ **so there is nothing here to
 * tell apart, and inventing a distinction would answer a question the server declined to.**
 */
export const join = async (
  roomId: string,
  passphrase: string,
  origin: string = location.origin,
): Promise<JoinResult> => {
  let res: Response;
  try {
    res = await fetch(new URL(`/api/rooms/${roomId}/join`, origin), {
      method: "POST",
      body: JSON.stringify({ passphrase }),
    });
  } catch {
    // ⚠ Nothing came back. ⚠ That is not the same as being refused
    //   (`.claude/rules/evidence.md`), ⚠ and the wording downstream keeps them apart.
    return { ok: false, why: "unreachable" };
  }
  if (res.status === 401) return { ok: false, why: "refused" };
  if (!res.ok) return { ok: false, why: "malformed" };
  return { ok: true, token: ((await res.json()) as { token: string }).token };
};

/**
 * ⚠ **What the guest is told, and what they are not.**
 *
 * ⚠ **One sentence for all three refusals** — ⚠ **and it never opens with what does not work**
 * (`CLAUDE.md` § 4-1). ⚠ **It says what to check and what to do next.**
 */
export const WORDING: Readonly<Record<JoinRefusal, string>> = {
  // ⚠ Wrong passphrase, unknown room, and rate-limited all land here. ⚠ On purpose.
  //   ⚠ Saying "no such room" would answer "does this room exist?" to anyone who asks.
  refused: "合言葉を確かめて、もう一度入力してください。URL と合言葉の両方が必要です。",
  // ⚠ The caller is the one who is wrong, and telling them so leaks nothing about any room.
  malformed: "うまく送れませんでした。ページを読み込み直して、もう一度お試しください。",
  // ⚠ Nothing arrived. ⚠ Never phrased as a refusal — the reader's next move is different.
  unreachable: "いま kagima につながりませんでした。少し待ってから、もう一度お試しください。",
};
