// The guest's side of getting into a room.
//
// ⚠ **This is the only door an attacker also walks through** (`docs/PRODUCT.md` § 3).
//   ⚠ **So the wording here is part of the security, not a finishing touch:**
//   ⚠ **a wrong passphrase, a room that never existed and a room being hammered must read the
//   ⚠ same** (`docs/adr/0004`, `.claude/rules/security.md` § 3).
//
// ⚠ **The server already answers all three identically.** ⚠ **This file's job is not to undo that
//   ⚠ by explaining the difference in words the server refused to give.**

import {
  KNOCK_PROTOCOL_PREFIX,
  type KnockEnding,
  parseKnockEnding,
  waitPath,
} from "../signaling/protocol.ts";

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

/**
 * ⚠ **How long to wait before opening the waiting socket again, in order.**
 *
 * ⚠⚠ **Chosen values, ⚠ not measured ones** (`.claude/rules/evidence.md`).
 * ⚠ **The last one repeats, ⚠ and that is the difference from `RETRY_DELAYS_MS` in
 * `./reconnect.ts`** — ⚠ **there, the length of the list is the bound; ⚠ here the bound is the
 * person, ⚠ who is looking at a 「やめる」 button while they wait.**
 * ⚠ **A socket that closed without saying anything is not an answer** — ⚠ **`nothing arrived ≠
 * it was refused`, ⚠ and giving up would tell a Guest something that did not happen.**
 * ⚠ **At the slowest that is one handshake every 8 seconds** — ⚠ **450/hour against the 1,800/hour
 * the two-second polling cost** (kagima#78).
 */
export const WAIT_RETRY_DELAYS_MS: readonly number[] = [500, 1_000, 2_000, 4_000, 8_000];

/**
 * ⚠⚠ **Wait for the Host, ⚠ and be told** (`docs/adr/0028`, kagima#78, kagima#99).
 *
 * ⚠ **This replaces a `GET` that carried the knock id in its path and was read every two
 * seconds.** ⚠ **The id now travels in `sec-websocket-protocol`, ⚠ where the join token already
 * travels** (`src/signaling/protocol.ts`).
 *
 * ⚠ **Silence is what waiting looks like.** ⚠ **An unknown room, a Host who has not looked and a
 * door with too many people at it all open a socket that simply says nothing**
 * (`src/knock/knocks.ts`) — ⚠ **the same three that all read `waiting` before.**
 *
 * ⚠ **Returns how to stop.** ⚠ **Calling it closes the socket and cancels any pending retry.**
 */
export const waitForDecision = (
  roomId: string,
  knockId: string,
  onEnding: (ending: KnockEnding) => void,
  origin: string = location.origin,
): (() => void) => {
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const again = (): void => {
    if (stopped) return;
    const at = Math.min(attempt, WAIT_RETRY_DELAYS_MS.length - 1);
    attempt += 1;
    timer = setTimeout(open, WAIT_RETRY_DELAYS_MS[at] as number);
  };

  function open(): void {
    if (stopped) return;
    const url = new URL(waitPath(roomId), origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let ws: WebSocket;
    try {
      ws = new WebSocket(url.toString(), [`${KNOCK_PROTOCOL_PREFIX}${knockId}`]);
    } catch {
      // ⚠ The socket could not even be made. ⚠ That is not an answer either.
      again();
      return;
    }
    socket = ws;
    // ⚠ It opened, ⚠ so the next failure starts the backoff from the top rather than the bottom.
    ws.addEventListener("open", () => {
      attempt = 0;
    });
    ws.addEventListener("message", (event: MessageEvent) => {
      const ending = parseKnockEnding(String(event.data));
      // ⚠ A line we do not recognise is not an ending. ⚠ Never invent one.
      if (ending === null) return;
      stopped = true;
      onEnding(ending);
    });
    ws.addEventListener("close", () => {
      socket = null;
      again();
    });
    // ⚠ `close` follows an error, ⚠ so the coming back happens in one place and not two.
    ws.addEventListener("error", () => {});
  }

  open();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    socket?.close();
  };
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
