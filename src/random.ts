// ⚠⚠ **The one place kagima draws randomness.**
//
// ⚠ **Grounds: `.claude/rules/security.md` § 1** — ⚠ **a room id, a passphrase and a host key all
//   ⚠ come from a CSPRNG, ⚠ never from a counter, a timestamp, a PID or `Math.random`.**
//
// ⚠ **Why it is its own file: ⚠ kagima is moving to Workers** (`docs/adr/0015`), ⚠ **where
//   ⚠ `node:crypto` does not exist.** ⚠ **`crypto.getRandomValues` is the Web Crypto name and it
//   ⚠ is present in both** — ⚠ **so this file is the seam, ⚠ and nothing else needs to know.**
//
// ⚠ **`crypto.getRandomValues` is a CSPRNG in both runtimes.** ⚠ **It is not `Math.random` wearing
//   ⚠ a different name** — ⚠ **`Math.random` makes no such promise and must never appear near this.**

/** ⚠ **`n` bytes from the platform CSPRNG.** ⚠ Never a counter, ⚠ never a timestamp. */
export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/**
 * ⚠ **Base64url, ⚠ written out rather than borrowed.**
 *
 * ⚠ **`Buffer` is Node's and does not exist in Workers.** ⚠ **`btoa` exists in both, ⚠ but it
 * speaks base64 and takes a binary string** — ⚠ **so the two differences from base64url (`+/`
 * for `-_`, and the padding) are removed here, ⚠ in one place.**
 */
export const base64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

/**
 * ⚠ **The other direction.** ⚠ **Here so the pair cannot drift apart.**
 *
 * ⚠ **`atob` is in both runtimes and speaks base64**, ⚠ **so the two base64url differences are
 * put back before decoding.** ⚠ **Padding is restored because `atob` requires it.**
 */
export const base64urlDecode = (text: string): Uint8Array => {
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

/** ⚠ **`n` random bytes as base64url.** ⚠ A host key and a token nonce are both this. */
export const randomToken = (n: number): string => base64url(randomBytes(n));
