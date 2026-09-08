// ⚠⚠ **The two routes that let somebody say who they are** (`docs/adr/0030`).
//
// ⚠ **They are NOT a room's business.** ⚠ **On Cloudflare every `/api/rooms/...` path goes to one
//   ⚠ Durable Object** (`docs/adr/0022`); ⚠ **signing in belongs to nobody's room, ⚠ so it is
//   ⚠ answered before that split.** ⚠ **Both platforms call this same function** (`CLAUDE.md` § 3).
//
// ⚠⚠ **A Guest never arrives here.** ⚠ **The person who makes a room says who they are; ⚠ the
//   ⚠ person who comes in does not** (`docs/PRODUCT.md` § 5).
import {
  authorizeUrl,
  checkIdToken,
  exchangeAtGoogle,
  exchangeBody,
  type ExchangeCode,
  type GoogleConfig,
} from "./google.ts";
import {
  clearCookie,
  cookieFrom,
  isAllowed,
  issueOAuth,
  issueSession,
  newOpaque,
  OAUTH_COOKIE,
  OAUTH_TTL_MS,
  readOAuth,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  setCookie,
} from "./session.ts";

/**
 * ⚠ **What a person is told when signing in did not work** (`docs/adr/0030`).
 *
 * ⚠ **Two sentences, ⚠ because the next move is different** (`CLAUDE.md` § 4-1).
 * ⚠ **Neither opens with what does not work, ⚠ and neither names an internal reason.**
 */
const SIGN_IN_AGAIN = "サインインをやり直してください。";
const NOT_ON_THE_LIST = "このアカウントではルームを作れません。招待した人に確認してください。";

/**
 * ⚠ **The half-finished round trip is thrown away, ⚠ whichever way it ended.**
 *
 * ⚠ **Leaving it there means the next attempt starts holding somebody else's `state`.**
 */
const signInFailed = (secure: boolean, said: string): Response =>
  new Response(said, {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": clearCookie(OAUTH_COOKIE, secure),
    },
  });

export type SignInOptions = {
  /** ⚠ **`null` when nothing is configured** — ⚠ **then there is no sign-in and no gate.** */
  readonly google: GoogleConfig | null;
  /** ⚠ **The one signing secret.** ⚠ Same one the join token uses (`docs/adr/0030`). */
  readonly secret: string;
  readonly allowList: string | undefined;
  /** ⚠ **Whether the cookies say `Secure`.** ⚠ Off only where there is no TLS to be had. */
  readonly secure: boolean;
  /** ⚠ **Injected so a check needs no network** (`.claude/rules/verification.md`). */
  readonly exchangeCode?: ExchangeCode;
};

/** ⚠ **`null` when the path is not ours.** ⚠ The caller carries on routing. */
export const handleSignIn = async (
  o: SignInOptions,
  request: Request,
  url: URL,
): Promise<Response | null> => {
  if (url.pathname !== "/auth/google" && url.pathname !== "/auth/google/callback") return null;

  // ⚠ Nothing is configured, ⚠ so there is no sign-in. ⚠ Answered like any other unknown path:
  //   ⚠ saying "sign-in is off here" would describe the deployment to whoever asked.
  const google = o.google;
  if (google === null) {
    return new Response(JSON.stringify({ error: "no such endpoint" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (url.pathname === "/auth/google") {
    // ⚠ Both drawn from the CSPRNG (`.claude/rules/security.md` § 1). ⚠ `state` is the
    //   ⚠ anti-forgery value; ⚠ `nonce` is what the ID token has to echo back.
    const state = newOpaque();
    const nonce = newOpaque();
    return new Response(null, {
      status: 302,
      headers: {
        location: authorizeUrl(google, state, nonce),
        // ⚠ Signed and short-lived. ⚠ Stage 1 keeps nothing on a server (`docs/adr/0030`).
        "set-cookie": setCookie(
          OAUTH_COOKIE,
          await issueOAuth(state, nonce, o.secret, Date.now()),
          OAUTH_TTL_MS,
          o.secure,
        ),
        "cache-control": "no-store",
      },
    });
  }

  // ⚠⚠ **Back from Google.** ⚠ **Everything below is checked before anything is believed.**
  const held = await readOAuth(
    cookieFrom(request.headers.get("cookie"), OAUTH_COOKIE),
    o.secret,
    Date.now(),
  );
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // ⚠ The round trip expired, ⚠ was never started, ⚠ or came back for a different one.
  //   ⚠ `state` is compared here rather than trusted: ⚠ it is the anti-forgery value.
  if (held === null || code === null || state === null || state !== held.state) {
    return signInFailed(o.secure, SIGN_IN_AGAIN);
  }

  const exchange = o.exchangeCode ?? exchangeAtGoogle;
  const idToken = await exchange(exchangeBody(google, code));
  if (idToken === null) return signInFailed(o.secure, SIGN_IN_AGAIN);

  // ⚠⚠ The signature is not checked here, ⚠ and Google's own document says why (`./google.ts`).
  //   ⚠ Every claim that binds it to THIS request is.
  const checked = checkIdToken(idToken, google, held.nonce, Date.now());
  if (!checked.ok) return signInFailed(o.secure, SIGN_IN_AGAIN);

  // ⚠⚠ **Who may make a room** (stage 1 of `docs/adr/0030`).
  //   ⚠ **A different sentence on purpose**: ⚠ **"try again" is wrong advice for somebody who
  //   ⚠ signed in perfectly well and is simply not on the list** (`CLAUDE.md` § 4-1: ⚠ **the
  //   ⚠ reader's next move depends on which it is**).
  if (!(await isAllowed(checked.email, o.allowList))) {
    return signInFailed(o.secure, NOT_ON_THE_LIST);
  }

  // ⚠ The address is never logged (`.claude/rules/security.md` § 2). ⚠ It goes into a signed
  //   ⚠ cookie on that person's own device and nowhere else.
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": setCookie(
        SESSION_COOKIE,
        await issueSession(checked.email, o.secret, Date.now()),
        SESSION_TTL_MS,
        o.secure,
      ),
      "cache-control": "no-store",
    },
  });
};
