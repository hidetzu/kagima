// Types that exist to make a mistake fail at compile time rather than at review time.

/**
 * ⚠ **A passphrase, distinguished from every other string in the program.**
 *
 * ⚠ **Grounds: the way a secret leaks is not `log(passphrase)`.** ⚠ **It is a passphrase reaching
 * a parameter that expected "some string" — a room id, a nickname, a label —
 * ⚠ and being handled the way that thing is handled** (`.claude/rules/security.md` § 2).
 *
 * ⚠ **This does not stop it being logged.** ⚠ **Nothing in the type system does.**
 * ⚠ **kagima#12 is what makes logging it fail.** ⚠ **This only stops it being mistaken for
 * something else on the way there.**
 */
export type Passphrase = string & { readonly __brand: "passphrase" };

/** ⚠ **The one place a plain string becomes a `Passphrase`.** ⚠ Grep for it to find every source. */
export const asPassphrase = (value: string): Passphrase => value as Passphrase;
