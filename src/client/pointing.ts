// ⚠ **「ここ」を 画面に置く** (`docs/adr/0033` 決定 3)。
//
// ⚠⚠ **Here rather than in each page.** ⚠ **The two pages would drift**, ⚠ **and the part that
//   ⚠ would drift first is which picture a point belongs to** — ⚠ **get that wrong and the dot
//   ⚠ appears on the wrong face.**
// ⚠ **What travels is in [`../call/pointer.ts`](../call/pointer.ts), ⚠ which is pure.**
//   ⚠ **This file is the half that needs a DOM.**

import type { Point, PointAt } from "../call/pointer.ts";

/**
 * ⚠⚠ **Which element each picture is, ⚠ read in this side's own terms.**
 *
 * ⚠ **A point arrives already flipped** (`src/client/call.ts`), ⚠ **so `my-camera` means "the
 * other person is pointing at MY camera", ⚠ and that is the element showing this side's face.**
 */
const PICTURE: Readonly<Record<Exclude<PointAt, "nowhere">, string>> = {
  "my-camera": "local",
  "your-camera": "remote",
  "my-screen": "shared-mine",
  "your-screen": "shared",
};

/** ⚠ **Which picture this side may point at, ⚠ and what that is called on the wire.** */
const POINTABLE: readonly (readonly [string, PointAt])[] = [
  // ⚠ **The other person's camera** — ⚠ **`docs/adr/0033` 決定 1: ⚠ a phone shows things by
  //   ⚠ aiming its camera, ⚠ so "ここ" has to work on a camera picture too** (Owner 決定 2026-09-09).
  ["remote", "your-camera"],
  ["shared", "your-screen"],
  // ⚠ **This side's own shared screen.** ⚠ **Somebody showing a document points at it themselves.**
  ["shared-mine", "my-screen"],
];

type Pointing = {
  point(at: PointAt, x: number, y: number): void;
  onPeerPoint(handler: (point: Point) => void): void;
};

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** ⚠ **A border can put the finger a pixel outside its own box.** ⚠ **That is not nonsense.** */
const within = (fraction: number): number => Math.min(1, Math.max(0, fraction));

/**
 * ⚠⚠ **How long the spot stays after the finger goes** (⚠ Owner 決定 2026-09-11).
 *
 * ⚠ **A finger only exists while it is pressed** (⚠ 実測 2026-09-11: ⚠ a tap produces no
 * `pointermove` at all). ⚠ **So without this, ⚠ "ここ" on a phone is gone before the other person
 * has looked up** — ⚠ **and what it is for is exactly that moment.**
 *
 * ⚠ **A few seconds, ⚠ and then nothing.** ⚠ **Leaving it there until the next touch would be a
 * mark rather than a pointer**, ⚠ **and `docs/PRODUCT.md` § 3 keeps a whiteboard out of v0.1.0.**
 * ⚠ **The same rule for a mouse**: ⚠ **one behaviour is one thing to explain, ⚠ and the promise
 * is the same either way — ⚠ where somebody pointed stays for a moment.**
 */
export const POINT_LINGERS_MS = 3_000;

export const wirePointing = (call: Pointing): void => {
  call.onPeerPoint((point) => {
    for (const id of Object.values(PICTURE)) {
      const dot = byId(`dot-${id}`);
      if (dot !== null) dot.hidden = true;
    }
    if (point.at === "nowhere") return;
    const picture = byId(PICTURE[point.at]);
    const dot = byId(`dot-${PICTURE[point.at]}`);
    // ⚠ **A picture that is not being shown gets no dot.** ⚠ **The camera may be off, ⚠ or
    //   ⚠ nothing may be shared** — ⚠ **a dot floating on nothing says somebody pointed at nothing.**
    if (picture === null || dot === null || picture.hidden) return;
    dot.style.left = `${point.x * picture.clientWidth}px`;
    dot.style.top = `${point.y * picture.clientHeight}px`;
    dot.hidden = false;
  });

  for (const [id, at] of POINTABLE) {
    const picture = byId(id);
    if (picture === null) continue;
    // ⚠⚠ **One send per frame.** ⚠ **A pointer moves far more often than a screen is redrawn, ⚠ and
    //   ⚠ every extra send is bandwidth spent on a position that was already replaced.**
    let queued: { x: number; y: number } | null = null;
    let frame = 0;
    const whereIn = (event: PointerEvent): { x: number; y: number } | null => {
      const box = picture.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return null;
      return {
        x: within((event.clientX - box.left) / box.width),
        y: within((event.clientY - box.top) / box.height),
      };
    };

    // ⚠⚠ **Landing counts** (⚠ 実測 2026-09-11、⚠ 実機、⚠ Owner の報告).
    //
    // ⚠ **A finger only produces `pointermove` while it is down** — ⚠ **so a tap that does not
    //   ⚠ slide produced nothing at all, ⚠ and the person had to move before anything appeared.**
    // ⚠ **On a mouse this never showed: ⚠ hovering moves the pointer without pressing anything.**
    // ⚠ **Sent straight away rather than queued for the next frame**: ⚠ **this is the moment the
    //   ⚠ person meant, ⚠ and there is nothing yet for it to overtake.**
    // ⚠ **Pointing again cancels the letting-go that was already scheduled.**
    let letGo: ReturnType<typeof setTimeout> | null = null;
    const stillPointing = (): void => {
      if (letGo === null) return;
      clearTimeout(letGo);
      letGo = null;
    };

    picture.addEventListener("pointerdown", (event) => {
      const where = whereIn(event);
      if (where === null) return;
      stillPointing();
      queued = where;
      call.point(at, where.x, where.y);
    });

    picture.addEventListener("pointermove", (event) => {
      const where = whereIn(event);
      if (where === null) return;
      stillPointing();
      queued = where;
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (queued !== null) call.point(at, queued.x, queued.y);
      });
    });
    // ⚠ **The finger leaving is said** — ⚠ **it is not the absence of a message**
    //   (`.claude/rules/evidence.md`: ⚠ nothing arrived ≠ it was not sent).
    // ⚠⚠ **Said late, ⚠ on purpose** (`POINT_LINGERS_MS`, ⚠ Owner 決定 2026-09-11).
    //   ⚠ **The spot is what the other person has to look at, ⚠ and they have not looked yet.**
    for (const name of ["pointerleave", "pointercancel"]) {
      picture.addEventListener(name, () => {
        queued = null;
        stillPointing();
        letGo = setTimeout(() => {
          letGo = null;
          call.point("nowhere", 0, 0);
        }, POINT_LINGERS_MS);
      });
    }
  }
};
