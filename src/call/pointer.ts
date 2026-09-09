// ⚠ **「ここ」** (`docs/adr/0033` 決定 3)。
//
// ⚠⚠ **Where somebody is pointing goes browser to browser, ⚠ never through our server.**
//   ⚠ **`docs/adr/0032` decided that what a pointer points AT is not measured** — ⚠ **so it does
//   ⚠ not get put anywhere it could be.** ⚠ **`docs/adr/0031`'s daily budget is the other half:
//   ⚠ a pointer moves many times a second, ⚠ and signalling messages count against requests.**
//
// ⚠ **What travels is a fraction of a box and which box.** ⚠ **No pixels, ⚠ no content, ⚠ nothing
//   ⚠ about what is under the finger.**
//
// ⚠ **Pure on purpose.** ⚠ **Nothing here touches the DOM** (`src/call/notice.ts` is here for the
//   ⚠ same reason), ⚠ **so the flip and the staleness rule can be checked without a browser.**

/** ⚠ **Its own channel.** ⚠ **Unordered, ⚠ because a position that arrives late is already wrong.** */
export const POINTER_CHANNEL = "kagima.pointer";

/**
 * ⚠⚠ **Which of the four pictures in a call this is about, ⚠ said from the sender's side.**
 *
 * ⚠ **A room holds two people** (`docs/PRODUCT.md` § 3), ⚠ **so "mine" and "yours" name everybody
 * without a name travelling.** ⚠ **The receiver reads it through [`flipPoint`](#).**
 * ⚠ **`nowhere` is "the finger left" — ⚠ ⚠ its own value rather than an absent message, ⚠ because
 * an absent message is indistinguishable from one that never arrived**
 * (`.claude/rules/evidence.md`).
 */
export type PointAt = "my-camera" | "your-camera" | "my-screen" | "your-screen" | "nowhere";

export type Point = {
  readonly at: PointAt;
  /** ⚠ **0 to 1 across the picture**, ⚠ **never pixels** — ⚠ **the two screens are different sizes.** */
  readonly x: number;
  readonly y: number;
  /**
   * ⚠⚠ **Which move this is.** ⚠ **The channel is unordered, ⚠ so an older position can arrive
   * after a newer one and would put the dot back where it used to be**
   * (`.claude/skills/change-review/SKILL.md` § 4).
   */
  readonly n: number;
};

const AT: readonly PointAt[] = ["my-camera", "your-camera", "my-screen", "your-screen", "nowhere"];

const FLIPPED: Readonly<Record<PointAt, PointAt>> = {
  "my-camera": "your-camera",
  "your-camera": "my-camera",
  "my-screen": "your-screen",
  "your-screen": "my-screen",
  nowhere: "nowhere",
};

/** ⚠ **The same point, ⚠ read from the other side of the call.** ⚠ **Its own inverse.** */
export const flipPoint = (point: Point): Point => ({ ...point, at: FLIPPED[point.at] });

/**
 * ⚠ **Untrusted: ⚠ it came from the other browser** (`.claude/rules/security.md` § Grounds 3).
 *
 * ⚠ **A fraction outside 0..1 is dropped rather than clamped** — ⚠ **clamping would turn a
 * nonsense position into a plausible one, ⚠ and a dot in the corner reads as somebody pointing
 * at the corner.**
 */
export const readPoint = (data: unknown): Point | null => {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const said = parsed as Record<string, unknown>;
  const at = said.at;
  if (typeof at !== "string" || !AT.includes(at as PointAt)) return null;
  const { x, y, n } = said;
  if (typeof x !== "number" || typeof y !== "number" || typeof n !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(n)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { at: at as PointAt, x, y, n };
};

/** ⚠ **One writer, ⚠ so the two ends cannot drift into different words.** */
export const writePoint = (point: Point): string =>
  JSON.stringify({ at: point.at, x: point.x, y: point.y, n: point.n });

/**
 * ⚠⚠ **Whether this one is worth acting on.**
 *
 * ⚠ **Strictly newer.** ⚠ **Equal means it arrived twice, ⚠ and re-applying it is not wrong so
 * much as it is a second chance for the ordering question to be got wrong later.**
 */
export const isFresh = (seen: number, point: Point): boolean => point.n > seen;
