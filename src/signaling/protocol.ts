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

export const CLOSE_UNAUTHORIZED = 4001;
export const CLOSE_ROOM_FULL = 4002;
export const CLOSE_BAD_MESSAGE = 4003;
export const CLOSE_SILENT = 4004;
/** ⚠ **The host ended the room.** ⚠ Not an error, and the wording the guest sees says so. */
export const CLOSE_ROOM_CLOSED = 4005;
