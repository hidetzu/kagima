// The room id, and the share URL built from it.
//
// ⚠ **The room id is the outer wall.** ⚠ **The URL travels over a channel we do not control**
//   (`.claude/rules/security.md` § 1). ⚠ **A guessable wall is not a wall.**
//
// ⚠ **The passphrase is the second wall, and it is deliberately weak** — ⚠ **it is said out loud**
//   (`docs/adr/0007`). ⚠ **So this one carries the entropy.**
//
// ⚠ **What may be claimed is `ROOM_ID_BITS`, and it is computed from the alphabet and the length.**
//   ⚠ **Never write the number anywhere else** (`.claude/rules/evidence.md`).
import { randomBytes } from "node:crypto";

/**
 * ⚠ **Crockford base32, lowercased, with `i` `l` `o` `u` already absent.**
 *
 * ⚠ **Chosen for what it leaves out, not for what it contains:**
 * ⚠ `0`/`O` and `1`/`l`/`I` are the pairs a person mistypes when copying a URL by hand,
 * ⚠ and `u` is out because it lets the alphabet spell things nobody wants in a URL.
 *
 * ⚠ **The length is 32, which is a power of two.** ⚠ **That is what lets a random byte be masked
 * into an index with no modulo bias** — ⚠ **a test asserts it, and without it this is biased.**
 */
export const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** ⚠ **Characters in a room id.** ⚠ Longer is free here; nobody types this, they follow a link. */
export const ID_LENGTH = 16;

/**
 * ⚠ **The strength claim, derived.**
 * ⚠ **`ID_LENGTH × log2(ALPHABET.length)`** — ⚠ **never typed as a literal.**
 */
export const ROOM_ID_BITS = ID_LENGTH * Math.log2(ALPHABET.length);

// ⚠ Uniform only because ALPHABET.length is exactly a power of two. ⚠ A test holds that.
const INDEX_MASK = ALPHABET.length - 1;

/**
 * Build a room id from raw bytes.
 *
 * ⚠ **Pure, so both ends of the range can be shown with fixtures instead of sampled.**
 */
export const roomIdFromBytes = (bytes: Uint8Array): string => {
  if (bytes.length < ID_LENGTH) {
    // ⚠ Never quietly produce a shorter id. ⚠ It would weaken ROOM_ID_BITS with nothing saying so.
    throw new RangeError(`need ${ID_LENGTH} bytes, got ${bytes.length}`);
  }
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ALPHABET[(bytes[i] as number) & INDEX_MASK];
  }
  return id;
};

/**
 * ⚠ **`randomBytes` is a CSPRNG.** ⚠ **`Math.random`, a counter, a timestamp, or anything derived
 * from one is forbidden here** (`.claude/rules/security.md` § 1), ⚠ **and a test reads the source
 * to hold that.**
 */
export const generateRoomId = (): string => roomIdFromBytes(randomBytes(ID_LENGTH));

/** ⚠ **True only for the canonical form.** ⚠ Used to reject a malformed id before it reaches the store. */
export const isRoomId = (value: string): boolean =>
  value.length === ID_LENGTH && [...value].every((c) => ALPHABET.includes(c));

/**
 * ⚠ **The link the host hands over.**
 *
 * ⚠ **The passphrase never appears in it** — ⚠ **not in the path, not in the query, not in the
 * fragment** (`.claude/rules/security.md` § 2). ⚠ **A URL is written to history, to the referer
 * header, and to every log between here and there.**
 */
export const buildShareUrl = (baseUrl: string, roomId: string): string => {
  if (!isRoomId(roomId)) throw new TypeError("not a room id");
  // ⚠ `new URL` rather than string concatenation: it normalises the base and refuses a bad one.
  return new URL(`/r/${roomId}`, baseUrl).toString();
};
