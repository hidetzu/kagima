// ⚠⚠ **The only things kagima keeps on a device** (`docs/adr/0021`, `docs/adr/0029`).
//
// ⚠ **Two, ⚠ and that is the ceiling: ⚠ the Host's key for one room, ⚠ the Guest's mark for one
//   ⚠ room.** ⚠ **Each is exactly one, ⚠ replaced rather than appended, ⚠ removed when dead.**
//
// ⚠ **Measured on a real phone on 2026-09-06: ⚠ the browser discarded the backgrounded tab and
//   ⚠ reloaded it from scratch.** ⚠ **The Host's key lived in a variable, ⚠ so it went with the
//   ⚠ page** — ⚠ **and the room stayed alive on the server with nobody able to open its door.**
// ⚠ **That happens in the one window that matters: ⚠ while the Host is handing the URL over.**
//
// ## ⚠ What is kept, and what that costs
//
// ⚠ **`docs/PRODUCT.md` § 5 promises no accounts and ⚠ no way to identify a user over time.**
// ⚠ **A room's key is not a user's identifier** — ⚠ **it is one door, ⚠ and it stops meaning
//   ⚠ anything when that room ends.**
// ⚠⚠ **But a pile of them would be a record of how many rooms this device has been in**, ⚠ **and
//   ⚠ that is close to the thing we promised not to have.**
// ⚠ **So: ⚠ exactly one per key, ⚠ replaced rather than appended, ⚠ and removed the moment it is
//   ⚠ dead.** ⚠ **Two keys, ⚠ and no more** — ⚠ **a device can be the Host of one room and the
//   ⚠ Guest of another, ⚠ and neither should cost the other its way back.**
//
// ## ⚠ What is never kept
//
// ⚠ **The join token.** ⚠ **Short-livedness is the whole point of it**
//   (`.claude/rules/security.md` § 4) — ⚠ **writing it down takes that away.**
// ⚠ **Somebody ELSE's nickname.** ⚠ **A Guest's name belongs to whoever knocked, ⚠ not to the
//   ⚠ Host** (`docs/PRODUCT.md` § 5: ⚠ **誰がノックしたかを記録に残さない**).
//
// ⚠⚠ **A Guest keeps its OWN name, ⚠ and only its own** (`docs/adr/0029`, ⚠ Owner 決定 2026-09-07).
// ⚠ **Grounds: ⚠ a page that was thrown away has to say who it is again, ⚠ and the two other
//   ⚠ places that name could come from are both worse** — ⚠ **the server would be keeping a record
//   ⚠ of who was let in, ⚠ and the Host would be keeping a Guest's name past the moment they left.**
// ⚠ **It is the person's own name, ⚠ on their own device, ⚠ for one room, ⚠ removed when that room
//   ⚠ ends.** ⚠ **On a shared device it is readable until then, ⚠ and that is said out loud rather
//   ⚠ than left to be discovered.**

/** ⚠ **The Host's key.** ⚠ **Not a prefix, ⚠ not a namespace** — ⚠ **there is only ever one room.** */
const KEY = "kagima.room";

/**
 * ⚠⚠ **The Guest's mark** (`docs/adr/0029`, kagima#90). ⚠ **A second key, ⚠ and the last one.**
 *
 * ⚠ **Why not the same key: ⚠ one device can be the Host of one room and the Guest of another,
 * ⚠ and sharing a slot would make becoming a Guest lose the Host's own way back.**
 * ⚠ **Two is the ceiling.** ⚠ **The discipline is unchanged and applies to each: ⚠ exactly one,
 * ⚠ replaced rather than appended, ⚠ removed the moment it is dead** — ⚠ **a pile is the thing
 * `docs/adr/0021` promised not to keep.**
 */
const GUEST_KEY = "kagima.guest";

/**
 * ⚠⚠ **まだ決められていないノック** (⚠ Owner 決定 2026-09-12)。
 *
 * ⚠ **ページを読み込み直しても 同じノックに戻るためだけに在る** — ⚠ **戻らないと、⚠ 同じ人が
 * Host の扉に 二人になる**(⚠ 実機 2026-09-12)。
 * ⚠ **決まった時点で捨てる。** ⚠ **`lostAt` は ページが去った時刻であり、⚠ 猶予を越えていれば
 * 新しいノックからやり直す** (`src/signaling/protocol.ts` の `KNOCK_GRACE_MS`)。
 */
const KNOCK_KEY = "kagima.knock";

/** ⚠ **The whole of what is written down.** ⚠ **Two strings.** */
export type RememberedRoom = {
  readonly roomId: string;
  readonly hostKey: string;
};

/**
 * ⚠ **Storage that may not be there.**
 *
 * ⚠ **A private window, ⚠ a browser told to block site data, ⚠ an embedded view** — ⚠ **reaching
 * for `localStorage` can throw, ⚠ not merely return nothing.**
 * ⚠ **kagima works without it; ⚠ it just loses this one convenience.**
 *
 * ⚠⚠ **This does NOT catch.** ⚠ **Every caller below already wraps the whole thing, ⚠ so a guard
 * here would be unreachable** — ⚠ **and a guard no check can tell apart is one nobody can keep
 * right.** ⚠ **A mutation proved exactly that: ⚠ removing it changed nothing.**
 */
const store = (): Storage | null => globalThis.localStorage ?? null;

/**
 * ⚠ **Write one, ⚠ replacing whatever was there.** ⚠ **Never appends.**
 *
 * ⚠ **One implementation for both keys** — ⚠ **two copies of "keep exactly one" is how one of
 * them quietly starts keeping two** (`CLAUDE.md` § 3).
 */
const write = (key: string, value: Record<string, string>): void => {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch {
    // ⚠ Full, or refused. ⚠ Not being able to remember is not a failure of the call.
  }
};

/**
 * ⚠ **Two named strings, ⚠ or nothing** — ⚠ **and anything else is dropped rather than read.**
 *
 * ⚠ **A shape we did not write is not ours to interpret, ⚠ and leaving it there means reading it
 * again.**
 */
const readFields = (key: string, names: readonly string[]): Record<string, string> | null => {
  const raw = (() => {
    try {
      return store()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  })();
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const held: Record<string, string> = {};
    for (const name of names) {
      const field = value[name];
      // ⚠ Every one, ⚠ or none. ⚠ Half a mark is a shape we did not write.
      if (typeof field !== "string" || field === "") {
        drop(key);
        return null;
      }
      held[name] = field;
    }
    return held;
  } catch {
    drop(key);
    return null;
  }
};

const drop = (key: string): void => {
  try {
    store()?.removeItem(key);
  } catch {
    // ⚠ Nothing to do, and nothing to say to anybody about it.
  }
};

/** ⚠ **Replaces.** ⚠ **Never appends** — ⚠ **a pile is the thing we promised not to keep.** */
export const remember = (room: RememberedRoom): void =>
  write(KEY, { roomId: room.roomId, hostKey: room.hostKey });

/**
 * ⚠ **What was written down, ⚠ or `null`.**
 *
 * ⚠ **Anything that is not exactly two strings is treated as absent and removed** — ⚠ **a shape
 * we did not write is not ours to interpret, ⚠ and leaving it there means reading it again.**
 */
export const recall = (): RememberedRoom | null => {
  const held = readFields(KEY, ["roomId", "hostKey"]);
  return held === null
    ? null
    : { roomId: held["roomId"] as string, hostKey: held["hostKey"] as string };
};

/**
 * ⚠⚠ **Called when the room is over, ⚠ and when the server says the key opens nothing.**
 *
 * ⚠ **Holding a dead key is how one becomes a pile.**
 */
export const forget = (): void => drop(KEY);

/**
 * ⚠⚠ **What a Guest keeps so it can come back to one room** (`docs/adr/0029`, kagima#90).
 *
 * ⚠ **The mark is not a way in.** ⚠ **It is exchanged for a short-lived token, ⚠ and the exchange
 * confirms the room still exists** (`.claude/rules/security.md` § 4).
 * ⚠ **It is bound to one room, ⚠ it expires on its own, ⚠ and it means nothing once that room is
 * over** — ⚠ **the same three things `docs/adr/0021` said about the Host's key.**
 */
export type RememberedRejoin = {
  readonly roomId: string;
  readonly rejoin: string;
  /**
   * ⚠⚠ **The name this person typed, ⚠ and nobody else's** (⚠ Owner 決定 2026-09-07).
   *
   * ⚠ **A thrown-away page has to say who it is again, ⚠ or the Host's screen loses the name it
   * was already showing** — ⚠ **and the Host's screen not changing is the decision this whole
   * feature was built under** (`docs/adr/0029`).
   */
  readonly nickname: string;
};

export const rememberRejoin = (mark: RememberedRejoin): void =>
  write(GUEST_KEY, {
    roomId: mark.roomId,
    rejoin: mark.rejoin,
    nickname: mark.nickname,
  });

export const recallRejoin = (): RememberedRejoin | null => {
  const held = readFields(GUEST_KEY, ["roomId", "rejoin", "nickname"]);
  return held === null
    ? null
    : {
        roomId: held["roomId"] as string,
        rejoin: held["rejoin"] as string,
        nickname: held["nickname"] as string,
      };
};

/**
 * ⚠⚠ **Called when the room is over, ⚠ and when the server says the mark opens nothing.**
 *
 * ⚠ **Holding a dead mark is how one becomes a pile** — ⚠ **the same reason `forget` exists.**
 */
export const forgetRejoin = (): void => drop(GUEST_KEY);

/** ⚠ **待っているノック。** ⚠ **決まるまでのあいだだけ 置かれる。** */
export type RememberedKnock = {
  readonly roomId: string;
  readonly knockId: string;
  readonly nickname: string;
  /** ⚠ **ページが去った時刻。** ⚠ **一度も去っていなければ `null`。** */
  readonly lostAt: number | null;
};

export const rememberKnock = (knock: RememberedKnock): void =>
  write(KNOCK_KEY, {
    roomId: knock.roomId,
    knockId: knock.knockId,
    nickname: knock.nickname,
    // ⚠⚠ 空文字は書かない。⚠ `readFields` は「我々が書いた形ではない」として
    //   ⚠ 記録ごと捨てる ― ⚠ 覚えた端から消えることになる(⚠ 実測 2026-09-12)。
    lostAt: String(knock.lostAt ?? 0),
  });

export const recallKnock = (): RememberedKnock | null => {
  const held = readFields(KNOCK_KEY, ["roomId", "knockId", "nickname", "lostAt"]);
  if (held === null) return null;
  const lostAt = Number(held["lostAt"]);
  return {
    roomId: held["roomId"] as string,
    knockId: held["knockId"] as string,
    nickname: held["nickname"] as string,
    // ⚠ 読めない値は「去った時刻を知らない」ことにする ― ⚠ 安全な側に倒す。
    lostAt: Number.isSafeInteger(lostAt) && lostAt > 0 ? lostAt : null,
  };
};

export const forgetKnock = (): void => drop(KNOCK_KEY);
