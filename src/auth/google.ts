// ⚠⚠ **The trip to Google and back** (`docs/adr/0030`).
//
// ⚠ **Google is the one thing kagima reaches for at runtime that it did not write**
//   (`CLAUDE.md` § 3 forbids that without an ADR; ⚠ `docs/adr/0030` is it).
// ⚠ **It appears in exactly one place: ⚠ signing in.** ⚠ **Not in the door, ⚠ not in the waiting
//   ⚠ socket, ⚠ not in a call.** ⚠ **Google being down does not stop a room that already exists.**
//
// ## ⚠⚠ Why the ID token's signature is not checked here
//
// ⚠ **Google's own document says it** (⚠ 参照日 2026-09-08):
//   ⚠ **an ID token received directly from Google over HTTPS "you can be confident ... really
//   ⚠ comes from Google and is valid"**, ⚠ **and signature validation is what matters when the
//   ⚠ token is passed to other components.**
// ⚠⚠ **kagima passes it to nothing.** ⚠ **It is read once, ⚠ here, ⚠ and dropped.**
// ⚠ **What IS checked is every claim that binds it to this request: ⚠ `iss`, ⚠ `aud`, ⚠ `exp`,
//   ⚠ `nonce`.**
//
// ## ⚠ PKCE is not here, ⚠ and that is said rather than hidden
//
// ⚠ **The article this started from uses PKCE.** ⚠ **Google's OpenID Connect document says
//   ⚠ nothing about it for this flow** (⚠ 参照日 2026-09-08).
// ⚠ **kagima is a confidential client: ⚠ the secret is on the server and never in a browser.**
// ⚠⚠ **So the authority is silent, ⚠ and that is what is written** — ⚠ **not "it permits", ⚠ not
//   ⚠ "it forbids"** (`.claude/rules/evidence.md` § Silence is not permission).
//
// ⚠ **The only thing here that leaves the process is `exchangeAtGoogle`, ⚠ and it is injectable**
//   — ⚠ **so every check runs without a network** (`.claude/rules/verification.md`: ⚠ **a check
//   ⚠ whose result depends on a third party being up cannot assert our correctness**).
import { base64urlDecode } from "../random.ts";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** ⚠ **The two Google publishes.** ⚠ **Both are accepted; ⚠ nothing else is.** */
const ISSUERS: readonly string[] = ["https://accounts.google.com", "accounts.google.com"];

/**
 * ⚠ **`openid` to get an ID token at all, ⚠ `email` to get the one claim we use.**
 *
 * ⚠ **Nothing else is asked for.** ⚠ **A profile, a picture and a name would all be things kagima
 * then held about a person** — ⚠ **and it has no use for any of them** (`docs/PRODUCT.md` § 5).
 */
export const SCOPE = "openid email";

export type GoogleConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  /** ⚠ **Where Google sends the person back.** ⚠ Must match what is registered, exactly. */
  readonly redirectUri: string;
};

export const authorizeUrl = (config: GoogleConfig, state: string, nonce: string): string => {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  return url.toString();
};

/** ⚠ **The body of the exchange.** ⚠ Built here so a check can read it without a network. */
export const exchangeBody = (config: GoogleConfig, code: string): string =>
  new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  }).toString();

/**
 * ⚠ **Why an ID token was not accepted.**
 *
 * ⚠ **For counting, ⚠ and it never reaches a caller** — ⚠ **telling somebody which check failed
 * answers questions they did not ask** (`.claude/rules/security.md` § 3).
 */
export type IdTokenRejection =
  | "malformed"
  | "wrong-issuer"
  | "wrong-audience"
  | "expired"
  | "wrong-nonce"
  | "unverified-email";

export type IdTokenCheck =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly why: IdTokenRejection };

/**
 * ⚠⚠ **Read the claims, ⚠ and check every one that binds this token to this request.**
 *
 * ⚠ **`email_verified` is required.** ⚠ **An address Google has not verified is an address
 * somebody may have typed** — ⚠ **and the allow-list is written in addresses.**
 */
export const checkIdToken = (
  idToken: string,
  config: GoogleConfig,
  nonce: string,
  now: number,
): IdTokenCheck => {
  const parts = idToken.split(".");
  if (parts.length !== 3) return { ok: false, why: "malformed" };
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1] as string))) as Record<
      string,
      unknown
    >;
  } catch {
    return { ok: false, why: "malformed" };
  }

  if (typeof claims["iss"] !== "string" || !ISSUERS.includes(claims["iss"])) {
    return { ok: false, why: "wrong-issuer" };
  }
  // ⚠ One audience, ⚠ ours. ⚠ A token minted for another app is not a way into this one.
  if (claims["aud"] !== config.clientId) return { ok: false, why: "wrong-audience" };
  const exp = Number(claims["exp"]);
  // ⚠ Seconds, ⚠ because that is what the claim is. ⚠ Everything else here is milliseconds.
  if (!Number.isSafeInteger(exp) || now >= exp * 1000) return { ok: false, why: "expired" };
  // ⚠⚠ The nonce we sent, ⚠ echoed. ⚠ Without it an old token could be replayed at us.
  if (claims["nonce"] !== nonce) return { ok: false, why: "wrong-nonce" };
  if (claims["email_verified"] !== true || typeof claims["email"] !== "string") {
    return { ok: false, why: "unverified-email" };
  }
  return { ok: true, email: claims["email"] };
};

/**
 * ⚠⚠ **The one call that leaves this process** (`docs/adr/0030`).
 *
 * ⚠ **Returns the ID token, ⚠ or nothing.** ⚠ **Why it failed is not carried out of here** —
 * ⚠ **the caller has one answer to give either way** (`.claude/rules/security.md` § 3).
 * ⚠ **Nothing is logged: ⚠ the body holds the client secret and the code**
 * (`.claude/rules/security.md` § 2).
 */
export type ExchangeCode = (body: string) => Promise<string | null>;

export const exchangeAtGoogle: ExchangeCode = async (body) => {
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    const got = (await res.json()) as { id_token?: unknown };
    return typeof got.id_token === "string" ? got.id_token : null;
  } catch {
    // ⚠ Google was not reachable. ⚠ Not the same as being refused — ⚠ but the person's next move
    //   ⚠ is the same one, ⚠ and it is the only one we have.
    return null;
  }
};
