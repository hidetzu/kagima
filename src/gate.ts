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
// ⚠⚠ **2026-09-08: ⚠ the gate stopped being a shared secret** (`docs/adr/0030`).
//
// ⚠ **It was Basic auth: ⚠ one `user:secret`, ⚠ handed round, ⚠ saying nothing about who used it
//   ⚠ and revocable only for everybody at once.** ⚠ **Now the person who makes a room signs in
//   ⚠ with Google** (Owner 決定 2026-09-08, `docs/PRODUCT.md` § 4 と § 5 が動いた)。
// ⚠⚠ **What did not change: ⚠ which paths this stands in front of.** ⚠ **A Guest still never
//   ⚠ meets it.**
import { readSession, SESSION_COOKIE, cookieFrom } from "./auth/session.ts";

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
 * ⚠⚠ **Signing in is outside the gate, ⚠ or nobody can ever get through it** (`docs/adr/0030`).
 *
 * ⚠ **Said as its own function rather than folded into `isGated`** — ⚠ **a gate that stands in
 * front of its own door is a mistake that reads as correct.**
 */
export const isSignIn = (pathname: string): boolean => pathname.startsWith("/auth/");

/**
 * ⚠ **The one answer to every refusal.**
 *
 * ⚠ **A wrong name, ⚠ a wrong secret, ⚠ a malformed header and no header at all are one answer**
 * (`.claude/rules/security.md` § 3). ⚠ **`WWW-Authenticate` is what makes a browser ask, ⚠ and
 * it says nothing about what was wrong.**
 */
/**
 * ⚠⚠ **Built when it is needed, ⚠ never at module scope** (⚠ measured 2026-09-08).
 *
 * ⚠ **A Worker refuses I/O in global scope, ⚠ and a `Response` with a body counts** —
 * ⚠ **`wrangler dev --local` said `Disallowed operation called within global scope` and the
 * isolate never started.** ⚠ **The version before this held a body-less `Response` there and was
 * fine, ⚠ so the shape looked safe and was not.**
 * ⚠ **`src/token/join-token.ts` already carries the same lesson about random values.**
 */
const refused = (): Response =>
  new Response(JSON.stringify({ error: "sign in first" }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/**
 * ⚠ **Whether this request may pass** (`docs/adr/0030`).
 *
 * ⚠ **`secret` is `undefined` when nothing is configured** — ⚠ **then there is no gate, ⚠ and the
 * caller says so out loud at startup rather than passing silently**
 * (`.claude/rules/security.md` § 6: ⚠ **never a default value**).
 * ⚠ **This is unchanged from the Basic auth version, ⚠ deliberately** — ⚠ **`wrangler dev --local`
 * and every check run without one.**
 *
 * ⚠⚠ **A browser is sent to sign in; ⚠ anything else is refused.**
 *
 * ⚠ **The redirect is what the Basic auth box did**: ⚠ **arrive without a credential and you are
 * asked for one, immediately.** ⚠ **No new sentence is put in front of anybody** (`CLAUDE.md` § 4).
 * ⚠ **`POST /api/rooms` gets the refusal instead** — ⚠ **a caller that is not a browser cannot
 * follow a redirect to a consent screen, ⚠ and pretending otherwise would hang it.**
 */
export const mayPass = async (
  request: Request,
  secret: string | undefined,
  now: number = Date.now(),
): Promise<Response | null> => {
  if (secret === undefined || secret === "") return null;

  const cookie = cookieFrom(request.headers.get("cookie"), SESSION_COOKIE);
  if ((await readSession(cookie, secret, now)) !== null) return null;

  // ⚠ Expired, ⚠ forged, ⚠ absent, ⚠ and for another purpose are one answer
  //   (`.claude/rules/security.md` § 3). ⚠ Nothing here says which it was.
  if (request.method === "GET") {
    return new Response(null, { status: 302, headers: { location: "/auth/google" } });
  }
  return refused();
};
