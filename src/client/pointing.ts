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
    picture.addEventListener("pointermove", (event) => {
      const box = picture.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      queued = {
        x: within((event.clientX - box.left) / box.width),
        y: within((event.clientY - box.top) / box.height),
      };
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (queued !== null) call.point(at, queued.x, queued.y);
      });
    });
    // ⚠ **The finger leaving is said** — ⚠ **it is not the absence of a message**
    //   (`.claude/rules/evidence.md`: ⚠ nothing arrived ≠ it was not sent).
    for (const name of ["pointerleave", "pointercancel"]) {
      picture.addEventListener(name, () => {
        queued = null;
        call.point("nowhere", 0, 0);
      });
    }
  }
};
