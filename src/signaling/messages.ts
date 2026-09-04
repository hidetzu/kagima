// What may cross the signalling socket, and what is refused.
//
// ⚠ **Everything here arrived from outside.** ⚠ **The first priority when confirming anything is
//   ⚠ parsing and validating what arrives from outside** (`.claude/rules/verification.md`).
//
// ⚠ **The server does not understand SDP, and does not want to.** ⚠ **It carries who may join;
//   ⚠ it never carries what they say** (`CLAUDE.md` § 3).
//   ⚠ **So the payload is checked for shape and size, and relayed opaque.**
//
// ⚠ **Size matters more than structure here.** ⚠ **An unbounded SDP is a way to make this process
//   ⚠ hold memory for someone else**, ⚠ **and losing the process loses every live room**
//   (`docs/adr/0005`).

/** ⚠ **A real SDP offer is a few kilobytes.** ⚠ Generous, and still a ceiling. */
export const MAX_SDP_BYTES = 64 * 1024;

/** ⚠ **An ICE candidate line is short.** */
export const MAX_CANDIDATE_BYTES = 4 * 1024;

/** ⚠ **Anything larger than the largest thing we accept is refused before it is parsed.** */
export const MAX_MESSAGE_BYTES = MAX_SDP_BYTES + 1024;

export type ClientMessage =
  | { readonly type: "offer"; readonly sdp: string }
  | { readonly type: "answer"; readonly sdp: string }
  | {
      readonly type: "candidate";
      readonly candidate: string;
      readonly sdpMid: string | null;
      readonly sdpMLineIndex: number | null;
    }
  | { readonly type: "bye" };

/**
 * ⚠ **Why a message was refused.**
 *
 * ⚠ **Counted, and told to the sender** — ⚠ **this side is not a secret.**
 * ⚠ **`malformed` and `unsupported` are different things and the difference is which side is
 * wrong** (`.claude/rules/evidence.md` § Outcomes are not one outcome).
 */
export type ParseRejection = "too-large" | "not-json" | "malformed" | "unsupported-type";

export type ParseResult =
  | { readonly ok: true; readonly message: ClientMessage }
  | { readonly ok: false; readonly why: ParseRejection };

const isString = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && Buffer.byteLength(v, "utf8") <= max;

/**
 * ⚠ **The only way a client message becomes a value this program acts on.**
 *
 * ⚠ **Size is checked before parsing.** ⚠ **Parsing first means having already held it.**
 */
export const parseClientMessage = (raw: string): ParseResult => {
  if (Buffer.byteLength(raw, "utf8") > MAX_MESSAGE_BYTES) return { ok: false, why: "too-large" };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, why: "not-json" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, why: "malformed" };
  }

  const m = value as Record<string, unknown>;
  switch (m["type"]) {
    case "offer":
    case "answer": {
      if (!isString(m["sdp"], MAX_SDP_BYTES)) return { ok: false, why: "malformed" };
      return { ok: true, message: { type: m["type"], sdp: m["sdp"] } };
    }
    case "candidate": {
      if (!isString(m["candidate"], MAX_CANDIDATE_BYTES)) return { ok: false, why: "malformed" };
      const sdpMid = m["sdpMid"];
      const sdpMLineIndex = m["sdpMLineIndex"];
      // ⚠ Both are optional in the browser API, and both arrive as `null` when absent.
      //   ⚠ Accepting anything else would be relaying a shape the other side cannot use.
      if (sdpMid !== undefined && sdpMid !== null && !isString(sdpMid, 256)) {
        return { ok: false, why: "malformed" };
      }
      if (
        sdpMLineIndex !== undefined &&
        sdpMLineIndex !== null &&
        !(
          typeof sdpMLineIndex === "number" &&
          Number.isSafeInteger(sdpMLineIndex) &&
          sdpMLineIndex >= 0
        )
      ) {
        return { ok: false, why: "malformed" };
      }
      return {
        ok: true,
        message: {
          type: "candidate",
          candidate: m["candidate"],
          sdpMid: typeof sdpMid === "string" ? sdpMid : null,
          sdpMLineIndex: typeof sdpMLineIndex === "number" ? sdpMLineIndex : null,
        },
      };
    }
    case "bye":
      return { ok: true, message: { type: "bye" } };
    default:
      // ⚠ We understand the envelope and decline the contents. ⚠ That is not the same as malformed,
      //   ⚠ and the sender is not wrong about the format.
      return { ok: false, why: "unsupported-type" };
  }
};
