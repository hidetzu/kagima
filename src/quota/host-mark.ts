// ⚠⚠ **How the ledger names a person without holding who they are** (`docs/adr/0031`).
//
// ⚠ **An HMAC of the account under this deployment's signing key.** ⚠ **The ledger never holds an
//   ⚠ address**, ⚠ **and the mark means nothing anywhere else** — ⚠ **another deployment has
//   ⚠ another key, ⚠ so the same person is a different mark there.**
// ⚠ **It is thrown away with the rest of the ledger when the UTC day turns**
//   (`docs/PRODUCT.md` § 5: ⚠ **what somebody did is not kept**).
import { signPayload } from "../token/join-token.ts";

/**
 * ⚠⚠ **The purpose, ⚠ inside the signed payload.**
 *
 * ⚠ **The same key signs join tokens, ⚠ rejoin marks and sessions** (`docs/adr/0029`,
 * `docs/adr/0030`). ⚠ **A mark that could be read as one of those, ⚠ or one of those as a mark,
 * would be a way in.** ⚠ **The purpose is what keeps them apart** — ⚠ **never the field count,
 * ⚠ and never which reader happens to look** (`.claude/rules/security.md` § 4).
 */
export const HOST_MARK = "quota";

export const hostMark = (email: string, secret: string): Promise<string> =>
  signPayload(`${HOST_MARK}:${email}`, secret);
