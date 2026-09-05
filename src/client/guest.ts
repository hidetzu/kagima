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

/**
 * ⚠ **Why a knock did not become a way in.**
 *
 * ⚠ **`refused` is deliberately one value** (`docs/adr/0017`) — ⚠ **the Host declined, ⚠ the room
 * closed, ⚠ and the room ending while somebody waited all land here.**
 * ⚠ **The Guest's next move is the same for all three, ⚠ and telling them apart would say the
 * Host was there and decided.**
 */
export type JoinRefusal = "refused" | "malformed" | "unreachable";
/**
 * ⚠⚠ **Knock, ⚠ and wait for the Host** (`docs/adr/0017`).
 *
 * ⚠ **There is nothing to guess.** ⚠ **The answer comes from a person, ⚠ and it can take minutes.**
 * ⚠ **Measured: ⚠ the Host noticed in 24 seconds once; ⚠ five minutes is accepted.**
 *
 * ⚠ **Every failure looks the same from here** — ⚠ **an unknown room, a Host who has not looked,
 * and a door with too many people at it all read `waiting`** (`src/knock/knocks.ts`).
 */
export const knock = async (
  roomId: string,
  nickname: string,
  origin: string = location.origin,
): Promise<{ ok: true; knockId: string } | { ok: false; why: JoinRefusal }> => {
  let res: Response;
  try {
    res = await fetch(new URL(`/api/rooms/${roomId}/knock`, origin), {
      method: "POST",
      body: JSON.stringify({ nickname }),
    });
  } catch {
    // ⚠ Nothing came back. ⚠ That is not the same as being refused
    //   (`.claude/rules/evidence.md`), ⚠ and the wording downstream keeps them apart.
    return { ok: false, why: "unreachable" };
  }
  if (!res.ok) return { ok: false, why: "malformed" };
  return { ok: true, knockId: ((await res.json()) as { knockId: string }).knockId };
};

/** ⚠ **What the door says.** ⚠ `over` covers refused, closed, and ended while waiting. */
export type KnockOutcome =
  | { readonly state: "waiting" }
  | { readonly state: "admitted"; readonly token: string }
  | { readonly state: "over" };

/** ⚠ **Read once.** ⚠ The caller decides how often; ⚠ a person is on the other end. */
export const readKnock = async (
  roomId: string,
  knockId: string,
  origin: string = location.origin,
): Promise<KnockOutcome> => {
  try {
    const res = await fetch(new URL(`/api/rooms/${roomId}/knock/${knockId}`, origin));
    if (!res.ok) return { state: "waiting" };
    const body = (await res.json()) as { state: string; token?: string };
    if (body.state === "admitted" && typeof body.token === "string") {
      return { state: "admitted", token: body.token };
    }
    // ⚠ Anything we do not recognise is "still waiting". ⚠ Never invent an ending.
    return body.state === "over" ? { state: "over" } : { state: "waiting" };
  } catch {
    // ⚠ One failed read is not an answer. ⚠ Keep waiting rather than end the wait.
    return { state: "waiting" };
  }
};

/**
 * ⚠ **What the guest is told, and what they are not.**
 *
 * ⚠ **One sentence for all three refusals** — ⚠ **and it never opens with what does not work**
 * (`CLAUDE.md` § 4-1). ⚠ **It says what to check and what to do next.**
 */
export const WORDING: Readonly<Record<JoinRefusal, string>> = {
  // ⚠⚠ One sentence for the Host declining, the room closing, and the room ending while waiting.
  //   ⚠ Saying "the Host declined" would say the Host was there and looked (`docs/adr/0017`).
  refused: "今回はこのルームに参加できませんでした。招待した人に確認してください。",
  // ⚠ The caller is the one who is wrong, and telling them so leaks nothing about any room.
  malformed: "うまく送れませんでした。ページを読み込み直して、もう一度お試しください。",
  // ⚠ Nothing arrived. ⚠ Never phrased as a refusal — the reader's next move is different.
  unreachable: "いま kagima につながりませんでした。少し待ってから、もう一度お試しください。",
};
