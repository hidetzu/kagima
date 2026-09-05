// ⚠⚠ **Whether a WebSocket handshake becomes a way into a room.**
//
// ⚠ **Kept apart from the wiring on purpose.** ⚠ **This is the security-carrying half**
//   (`.claude/rules/security.md` § 3, § 4), ⚠ **and it is the half that must behave identically
//   ⚠ on Node and in a Worker** (`docs/adr/0015`).
// ⚠ **It reaches for no platform, ⚠ so a check can call it directly** — ⚠ **without a server,
//   ⚠ without a port, ⚠ without a browser.**
import { verifyJoinToken } from "../token/join-token.ts";
import { TOKEN_PROTOCOL_PREFIX } from "./protocol.ts";

/**
 * ⚠ **Every outcome the handshake can produce, and the ones it cannot**
 * (`.claude/rules/evidence.md` § Outcomes are not one outcome).
 *
 * ```text
 * accepted and handled            a valid token for that room
 * ⚠ malformed                      no token, or a path that is not a room's signal endpoint
 * ⚠ well-formed but declined       a valid token for a different room, or an expired one
 * ⚠ we have not implemented it yet cannot occur — there is one endpoint and it exists
 * ⚠ nothing arrived                cannot occur — this runs on an upgrade that arrived
 * ⚠ a timer expired while waiting  ⚠ CAN occur, later: the heartbeat gives up on a silent socket
 * ```
 *
 * ⚠ **A refused handshake says only that it was refused.** ⚠ **Which of the reasons above it was
 * is not told to the caller** — ⚠ **telling them would answer "does this room exist?"**
 * (`.claude/rules/security.md` § 3).
 * ⚠ **So this type carries no reason at all.** ⚠ **There is nothing here for a caller to leak.**
 */
export type Upgrade =
  | { readonly ok: true; readonly roomId: string; readonly sessionId: string }
  | { readonly ok: false };

const REFUSED: Upgrade = { ok: false };

export const roomIdFromPath = (url: string): string | null => {
  const m = /^\/api\/rooms\/([^/?]+)\/signal(?:\?|$)/.exec(url);
  return m ? decodeURIComponent(m[1] as string) : null;
};

/**
 * ⚠ **The token out of the `sec-websocket-protocol` header.**
 *
 * ⚠ **A browser may offer several subprotocols, comma separated.** ⚠ **Ours is the one with the
 * prefix; ⚠ anything else is ignored rather than refused, ⚠ because offering more is allowed.**
 */
export const tokenFromProtocols = (raw: string | undefined | null): string | null => {
  if (raw === undefined || raw === null) return null;
  for (const p of raw.split(",").map((s) => s.trim())) {
    if (p.startsWith(TOKEN_PROTOCOL_PREFIX)) return p.slice(TOKEN_PROTOCOL_PREFIX.length);
  }
  return null;
};

/**
 * ⚠ **Asynchronous, ⚠ because Web Crypto is** (`docs/adr/0015`).
 *
 * ⚠ **It never rejects.** ⚠ **A failure of ours produces the same single refusal as a bad token** —
 * ⚠ **a rejection left to the caller becomes a socket nobody owns, ⚠ and a caller waiting for an
 * answer that never comes, ⚠ which `.claude/rules/evidence.md` names as "not an answer".**
 */
export const authorizeUpgrade = async (
  url: string,
  protocolHeader: string | undefined | null,
  secret: string,
  at: number,
): Promise<Upgrade> => {
  const roomId = roomIdFromPath(url);
  const token = tokenFromProtocols(protocolHeader);
  if (roomId === null || token === null) return REFUSED;

  try {
    const checked = await verifyJoinToken(token, roomId, secret, at);
    return checked.ok ? { ok: true, roomId, sessionId: checked.sessionId } : REFUSED;
  } catch {
    return REFUSED;
  }
};
