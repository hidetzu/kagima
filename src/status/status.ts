// ⚠⚠ **The one sentence a person reads, ⚠ decided in one place.**
//
// ⚠ **Grounds: this decision was written twice — ⚠ once in each page — ⚠ and the two drifted.**
// ⚠ **`CLAUDE.md` § 3: ⚠ never keep two implementations that answer the same question.**
// ⚠ **Here it is worse than drift: ⚠ the fast tier could not see either copy**, ⚠ so the
//   ⚠ precedence between endings was held only by two browser checks.
//
// ⚠ **The wording rules this file is held to are `CLAUDE.md` § 4-1:**
//
// ```text
// ⚠ never the progressive tense for a state   ⚠ "つないでいます" reads as happening right now
// ⚠ never sound stalled                       ⚠ leave a reason to come back
// ⚠ never phrase our gap as their fault       ⚠ the reader's next move depends on which it is
// ⚠ never name a cause we cannot see          ⚠ docs/adr/0012
// ```

/**
 * ⚠ **The endings, ⚠ and they are not the same thing** (kagima#11, kagima#16).
 *
 * ⚠ **`disconnected` is deliberately absent: ⚠ it recovers, ⚠ and it is not an ending**
 * (`CLAUDE.md` § 4 — ⚠ `closed` means the room is over; ⚠ a socket that dropped is `disconnected`).
 */
export type Ending =
  /** ⚠ The room is over and its state is gone. */
  | "closed"
  /**
   * ⚠ **This connection was never admitted: ⚠ the room already has two people in it.**
   *
   * ⚠ **Its own ending because it is not a drop.** ⚠ **Calling it `detached` told somebody who
   * never got in that "the call may still be running"** — ⚠ **it was not, ⚠ and it never started.**
   * ⚠ **This is the one refusal whose reason may be named: ⚠ the server said it in the close code.**
   */
  | "room-full"
  /** ⚠ The other side dropped. ⚠ Recoverable; ⚠ the room is still open. */
  | "peer-left"
  /** ⚠ Signalling went away. ⚠ **The call may well still be running** (`docs/adr/0010`). */
  | "detached"
  /** ⚠ No media path could be built. ⚠ **Never connected.** */
  | "unreachable"
  /** ⚠ A media path existed and did not come back. ⚠ **Had connected.** */
  | "dropped"
  | null;

/**
 * ⚠ **Precedence.** ⚠ **An ending is the last thing known, ⚠ and a later `track` must not talk
 * over it.** ⚠ **`closed` outranks everything: ⚠ the room being over is not softened by anything
 * that happened on the way there.**
 */
const ORDER: readonly Exclude<Ending, null>[] = [
  "closed",
  "room-full",
  "peer-left",
  "detached",
  "unreachable",
  "dropped",
];

/** ⚠ **Which of two endings stands.** ⚠ Never "whichever arrived last". */
export const outranks = (a: Ending, b: Ending): Ending => {
  if (a === null) return b;
  if (b === null) return a;
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
};

export type HostState = {
  readonly ending: Ending;
  readonly connected: boolean;
  readonly guestName: string | null;
};

export type GuestState = {
  readonly ending: Ending;
  readonly connected: boolean;
};

const HOST_ENDINGS: Readonly<Record<Exclude<Ending, null>, string>> = {
  closed: "このルームは閉じました。何も残っていません。",
  "room-full": "このルームにはもう 2 人います。空いてから、もう一度お試しください。",
  "peer-left": "相手の接続が切れました。まだこのルームは開いています。",
  detached: "kagima とのつながりが切れました。通話は続いているかもしれません。",
  // ⚠ Says what happened and what to do. ⚠ ⚠ It does not say why — ⚠ we cannot see why, ⚠ and
  //   ⚠ naming the wrong reason sends somebody to fix what is not broken.
  unreachable: "接続できませんでした。相手に、別のネットワークから入り直してもらってください。",
  dropped: "接続が途切れました。相手に入り直してもらってください。",
};

const GUEST_ENDINGS: Readonly<Record<Exclude<Ending, null>, string>> = {
  closed: "この通話は終わりました。何も残っていません。",
  "room-full": "このルームにはもう 2 人います。空いてから、もう一度お試しください。",
  "peer-left": "相手の接続が切れました。待っています。",
  detached: "kagima とのつながりが切れました。通話は続いているかもしれません。",
  unreachable:
    "接続できませんでした。別のネットワーク(モバイル回線など)に切り替えて、もう一度お試しください。",
  dropped: "接続が途切れました。もう一度お試しください。",
};

export const hostStatus = (s: HostState): string => {
  if (s.ending !== null) return HOST_ENDINGS[s.ending];
  if (s.connected) {
    return s.guestName === null ? "つながりました。" : `${s.guestName} さんとつながりました。`;
  }
  return s.guestName === null
    ? "相手が来るのを待っています。"
    : `${s.guestName} さんが入りました。つないでいます。`;
};

export const guestStatus = (s: GuestState): string => {
  if (s.ending !== null) return GUEST_ENDINGS[s.ending];
  return s.connected ? "つながりました。" : "つないでいます。";
};
