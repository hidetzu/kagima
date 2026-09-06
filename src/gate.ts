// ⚠⚠ **A door before the door** (`docs/adr/0024`).
//
// ⚠ **`POST /api/rooms` is open to anyone.** ⚠ **Measured 2026-09-06: ⚠ 20 requests made 20
//   ⚠ rooms, ⚠ with no credential at all.**
// ⚠ **On Cloudflare each one is an object and a written row, ⚠ and nothing collects them** —
//   ⚠ **and the Free boundary is 28.21 room-hours/day, ⚠ past which operations FAIL**
//   (`docs/adr/0022`).
//
// ## ⚠⚠ What this is not
//
// ⚠ **It is not the way in.** ⚠ **`docs/adr/0017` took the passphrase off the door on purpose,
//   ⚠ and this does not put it back** — ⚠ **a Guest never sees this, ⚠ never types this, ⚠ and
//   ⚠ is never told it exists.**
// ⚠ **`CLAUDE.md` § 4: ⚠ "passphrase" is the word for the thing a human says out loud at the
//   ⚠ door.** ⚠ **This is not that, ⚠ and it is not called that.**
//
// ⚠ **It is time-limited, ⚠ and `docs/adr/0024` says how it ends.**
import { constantTimeEqual } from "./token/join-token.ts";

/**
 * ⚠ **Which paths the gate stands in front of** (`docs/adr/0024`).
 *
 * ⚠⚠ **Two.** ⚠ **The page a Host opens, ⚠ and the request that makes a room.**
 * ⚠ **Everything a Guest touches is outside** — ⚠ **`/r/{id}`, ⚠ the knock, ⚠ reading a knock,
 * ⚠ the signalling socket.**
 */
export const isGated = (method: string, pathname: string): boolean =>
  (method === "GET" && (pathname === "/" || pathname === "/index.html")) ||
  (method === "POST" && pathname === "/api/rooms");

/**
 * ⚠ **The one answer to every refusal.**
 *
 * ⚠ **A wrong name, ⚠ a wrong secret, ⚠ a malformed header and no header at all are one answer**
 * (`.claude/rules/security.md` § 3). ⚠ **`WWW-Authenticate` is what makes a browser ask, ⚠ and
 * it says nothing about what was wrong.**
 */
const ASK = new Response(null, {
  status: 401,
  headers: { "www-authenticate": 'Basic realm="kagima", charset="UTF-8"' },
});

/**
 * ⚠ **Whether this request may pass.**
 *
 * ⚠ **`expected` is `undefined` when no gate is configured** — ⚠ **then there is no gate, ⚠ and
 * the caller says so out loud at startup rather than passing silently**
 * (`.claude/rules/security.md` § 6: ⚠ **never a default value**).
 *
 * ⚠ **Compared in constant time.** ⚠ **`===` on the raw string would let the secret be guessed
 * one byte at a time** (`.claude/rules/security.md` § 1).
 *
 * ⚠ **Only meaningful over HTTPS.** ⚠ **Basic sends the secret with every request; ⚠ on plain
 * HTTP it is in the open.** ⚠ **kagima is served over TLS** (`docs/adr/0003`).
 */
export const mayPass = async (
  request: Request,
  expected: string | undefined,
): Promise<Response | null> => {
  if (expected === undefined || expected === "") return null;

  const offered = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = offered.split(" ");
  if (scheme?.toLowerCase() !== "basic" || encoded === undefined) return ASK.clone();

  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
  } catch {
    // ⚠ Malformed. ⚠ Same answer as wrong — ⚠ telling them apart says which half was read.
    return ASK.clone();
  }

  // ⚠ The whole `user:secret` is compared, ⚠ not the halves. ⚠ Comparing them separately would
  //   ⚠ leak whether the name was right.
  return (await constantTimeEqual(decoded, expected)) ? null : ASK.clone();
};
