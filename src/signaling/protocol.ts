// ⚠⚠ **What both ends of the signalling socket have to agree on, ⚠ in one place.**
//
// ⚠ **This was written twice** — ⚠ **once in the server's `attach.ts`, ⚠ once in the browser's
//   ⚠ `client/transport.ts`** — ⚠ **and two copies of an agreement are two things that can drift**
//   (`CLAUDE.md` § 3).
// ⚠ **A drift here does not fail loudly: ⚠ the browser sends a subprotocol the server does not
//   ⚠ recognise, ⚠ the server refuses, ⚠ and the refusal looks exactly like a bad token**
//   (`.claude/rules/security.md` § 3, ⚠ which is the property that makes it hard to see).
//
// ⚠ **Nothing here reaches for a platform.** ⚠ **It is loaded by the server and by the browser.**

/**
 * ⚠ **The subprotocol that carries the join token.**
 *
 * ⚠ **A URL is written to history, to the referer header, and to every log in between**
 * (`.claude/rules/security.md` § 2). ⚠ **A join token in a query string is a secret in all of them.**
 * ⚠ **A browser cannot set arbitrary headers on a WebSocket handshake** — ⚠ **the one field it can
 * set is the subprotocol.** ⚠ **So the token travels there.**
 */
export const TOKEN_PROTOCOL_PREFIX = "kagima.token.";

/**
 * ⚠⚠ **The subprotocol that carries the knock id** (`docs/adr/0028`, kagima#99).
 *
 * ⚠ **Measured 2026-09-06: ⚠ Cloudflare's own log carried
 * `GET /api/rooms/{roomId}/knock/{knockId}`** — ⚠ **kagima never wrote that line, ⚠ and the id
 * was in the path, ⚠ so the path is what was recorded.**
 * ⚠ **A knock id is not the join token; ⚠ it is what the token is handed to**
 * (`src/client/guest.ts`). ⚠ **So it travels where the token travels, ⚠ and for the same reason.**
 */
export const KNOCK_PROTOCOL_PREFIX = "kagima.knock.";

/**
 * ⚠ **Where the waiting socket goes.** ⚠ **The room id is in the path; ⚠ the knock id is not.**
 *
 * ⚠ **The room id is already in `/r/{roomId}` and in the signalling path, ⚠ so putting it here
 * discloses nothing new.** ⚠ **The knock id is the thing kagima#99 is about.**
 */
export const waitPath = (roomId: string): string => `/api/rooms/${encodeURIComponent(roomId)}/wait`;

/**
 * ⚠⚠ **How a knock ends, ⚠ as it goes over the wire** (`docs/adr/0028`).
 *
 * ⚠ **There is no `waiting` here on purpose.** ⚠ **Waiting is what silence looks like**, ⚠ **and
 * that is what makes an unknown room and a Host who has not answered the same thing from
 * outside** (`.claude/rules/security.md` § 3).
 *
 * ⚠ **It lives in this file rather than next to the door because both ends have to agree on it**,
 * ⚠ **and two copies of an agreement are two things that can drift** (the head of this file).
 */
export type KnockEnding =
  /**
   * ⚠ **`token` opens the socket, ⚠ once, ⚠ within two minutes.**
   * ⚠⚠ **`rejoin` is the mark that lets this Guest come back to this one room if the browser
   * throws their page away** (`docs/adr/0029`, kagima#90). ⚠ **It is not a way in by itself.**
   */
  | { readonly state: "admitted"; readonly token: string; readonly rejoin: string }
  | { readonly state: "over" };

export const knockEndingLine = (ending: KnockEnding): string => JSON.stringify(ending);

/**
 * ⚠ **The one line the waiting socket ever carries, ⚠ read back.**
 *
 * ⚠ **Anything else is `null`** — ⚠ **never guessed at, ⚠ and never turned into an ending.**
 * ⚠ **Inventing an ending out of a line we do not recognise would end somebody's wait for a
 * reason that did not happen** (`.claude/rules/evidence.md`).
 */
export const parseKnockEnding = (line: string): KnockEnding | null => {
  let body: unknown;
  try {
    body = JSON.parse(line);
  } catch {
    return null;
  }
  const seen = body as { state?: unknown; token?: unknown; rejoin?: unknown };
  // ⚠ Both or neither. ⚠ An `admitted` without its mark is a shape we did not send, ⚠ and
  //   ⚠ guessing at half of one is how a Guest ends up holding nothing on the way back.
  if (
    seen.state === "admitted" &&
    typeof seen.token === "string" &&
    typeof seen.rejoin === "string"
  ) {
    return { state: "admitted", token: seen.token, rejoin: seen.rejoin };
  }
  return seen.state === "over" ? { state: "over" } : null;
};

/**
 * ⚠⚠ **The heartbeat as a message, ⚠ running in shadow** (`docs/adr/0020`, kagima#62).
 *
 * ⚠ **A Worker's server-side WebSocket has no `ping`** (⚠ measured 2026-09-06, `docs/adr/0015`).
 * ⚠ **So the heartbeat has to move to a text frame, ⚠ which both platforms have.**
 *
 * ⚠⚠ **Right now it decides nothing.** ⚠ **The protocol ping is still what closes a socket.**
 * ⚠ **This one only records what it WOULD have concluded** — ⚠ **so the value it needs can be
 * measured on real devices without anybody being hung up on for a guess.**
 *
 * ## ⚠ Why the number
 *
 * ⚠ **A pong that answers nothing is not an answer.** ⚠ **Without `n`, a page could send pongs
 * it was never asked for, ⚠ and the heartbeat would say "alive" about a page that never received
 * anything.** ⚠ **Echoing the number means the page took delivery** — ⚠ **which is the whole
 * thing being measured.**
 */
export const pingLine = (n: number): string => JSON.stringify({ type: "ping", n });

export const CLOSE_UNAUTHORIZED = 4001;
export const CLOSE_ROOM_FULL = 4002;
export const CLOSE_BAD_MESSAGE = 4003;
export const CLOSE_SILENT = 4004;
/** ⚠ **The host ended the room.** ⚠ Not an error, and the wording the guest sees says so. */
export const CLOSE_ROOM_CLOSED = 4005;
