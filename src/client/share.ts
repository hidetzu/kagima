// ⚠⚠ **Whether this device can put a screen into the call** (`docs/adr/0033`).
//
// ⚠ **`getDisplayMedia` does not exist on mobile browsers** (⚠ caniuse、⚠ 参照日 2026-09-09:
//   ⚠ **iOS Safari, ⚠ Chrome for Android, ⚠ Firefox for Android, ⚠ Samsung Internet — ⚠ 全部**)。
//
// ## ⚠ Why this is a function and not a list of devices
//
// ⚠ **The name of a device does not say what its browser can do.** ⚠ **Reading a user-agent to
//   ⚠ decide is a guess wearing the face of a measurement**
//   (`.claude/rules/evidence.md`). ⚠ **The presence of the method is the fact.**
//
// ## ⚠ Why it lives in `src/client/`
//
// ⚠ **It names a media API, ⚠ and `test/no-media-on-the-server.test.ts` forbids that outside
//   ⚠ here.** ⚠ **It was written in `src/call/` first and the wall rang** — ⚠ **correctly.**
// ⚠ **Naming one is not receiving one, ⚠ but the wall is a closed rule rather than a judgement,
//   ⚠ and that is what makes it a wall.** ⚠ **The fast tier reaches this file either way**
//   (`test/remember.test.ts` and `test/diagnostics.test.ts` both test `src/client`).
//
// ⚠ **Nothing here reaches for a platform.** ⚠ **It is handed the object to look at.**

/** ⚠ **As much of `navigator.mediaDevices` as this question needs.** */
export type DisplayCapable = { readonly getDisplayMedia?: unknown };

export const canShare = (media: DisplayCapable | undefined | null): boolean =>
  typeof media?.getDisplayMedia === "function";

/**
 * ⚠ **What a person is told, ⚠ if they are told at all** (`CLAUDE.md` § 4-1).
 *
 * ⚠⚠ **It says what they CAN do.** ⚠ **"対応していません" would leave the reader with no next
 * move** — ⚠ **and the next move exists: ⚠ point the camera at the thing.**
 * ⚠ **It is not our gap and it is not their fault**: ⚠ **the browser does not have the feature.**
 * ⚠ **Neither of those is said out loud, ⚠ because neither helps.**
 */
export const SHARE_UNAVAILABLE = "この端末では画面を共有できません。カメラを向けて見せられます。";
