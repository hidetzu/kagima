// ⚠⚠ **The day's budget** (`docs/adr/0031`).
//
// ⚠ **Why there is a budget at all is not cost** — ⚠ **it is `docs/DISCOVERY.md` § 9 の 仮説 D:
//   ⚠ the side that issues a room is asked for a continuing subject, ⚠ and the side that is
//   ⚠ invited is asked for nothing.** ⚠ **A budget can only be given to somebody who continues**
//   (`docs/adr/0030` made that side sign in). ⚠ **Fitting inside the free tier falls out of the
//   ⚠ same implementation; ⚠ writing it the other way round would sell an operating constraint
//   ⚠ as a product value.**
//
// ⚠ **Pure on purpose.** ⚠ **Nothing here touches storage or a clock** — ⚠ **the arithmetic is
//   ⚠ the part that has to be right, ⚠ and it is checked without a Durable Object.**

/**
 * ⚠ **What the day allows** (`docs/adr/0031`).
 *
 * ⚠ **The unit is a room's active wall-clock**, ⚠ **not requests and not sockets** —
 * ⚠ **two people for thirty minutes is thirty minutes** (`docs/adr/0022`).
 * ⚠ **so a reconnect and a re-join cannot count twice: ⚠ the unit already says so.**
 */
export type Limits = {
  /** ⚠ **20 room-hours.** ⚠ **70.9% of the free tier's 28.21** (`docs/adr/0031` の計算). */
  readonly serviceMs: number;
  /** ⚠ **60 room-minutes.** ⚠ **A chosen value, ⚠ not a measured one.** */
  readonly hostMs: number;
  /**
   * ⚠⚠ **8, ⚠ and it is not a chosen value.**
   *
   * ⚠ **The cap is soft: ⚠ rooms already open are never cut** (Owner 決定 2026-09-08),
   * ⚠ **so the overshoot is `open rooms × each one's remaining personal budget`.**
   * ⚠ **20 + 8 ≦ 28.21 ⟹ N ≦ 8.**
   */
  readonly openRooms: number;
};

export const LIMITS: Limits = {
  serviceMs: 20 * 60 * 60 * 1000,
  hostMs: 60 * 60 * 1000,
  openRooms: 8,
};

/**
 * ⚠⚠ **Everything the ledger holds.** ⚠ **This is the whole list** (`docs/adr/0031`).
 *
 * ⚠ **No address is in here.** ⚠ **A host is an HMAC of their account under this deployment's
 * signing key, ⚠ so the same person is a different mark somewhere else** — ⚠ **and the whole
 * ledger is thrown away when the UTC day turns**, ⚠ **so what somebody did does not outlive a
 * day** (`docs/PRODUCT.md` § 5).
 */
export type Ledger = {
  /** ⚠ **The UTC day being counted.** ⚠ **Cloudflare's free limits reset at 00:00 UTC.** */
  readonly day: string;
  /** ⚠ **The whole service, ⚠ today.** */
  readonly usedMs: number;
  /** ⚠ **host mark → ms today.** */
  readonly perHost: Readonly<Record<string, number>>;
  /**
   * ⚠ **room id → who opened it, ⚠ and the last total it reported.**
   *
   * ⚠ **A room reports its TOTAL and the ledger adds `total − last`** — ⚠ **so a repeat adds
   * nothing, ⚠ and a room that was evicted and came back does not start again from zero.**
   * ⚠ **The mark is here because a report says how long, ⚠ never whose** — ⚠ **the room does not
   * know who signed in, ⚠ and must not learn.**
   */
  readonly perRoom: Readonly<Record<string, { readonly host: string; readonly ms: number }>>;
};

/**
 * ⚠⚠ **How many rooms are open is READ from `perRoom`, ⚠ never held beside it.**
 *
 * ⚠ **`docs/adr/0031` listed it as a field.** ⚠ **Two places that answer one question drift**
 * (`CLAUDE.md` § 3), ⚠ **and the one that would drift is the one the cap is read off.**
 */
export const openRooms = (ledger: Ledger): number => Object.keys(ledger.perRoom).length;

/** ⚠ **The UTC day.** ⚠ **Not the machine's day** — ⚠ **the reset is Cloudflare's, at 00:00 UTC.** */
export const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

export const emptyLedger = (day: string): Ledger => ({
  day,
  usedMs: 0,
  perHost: {},
  perRoom: {},
});

/**
 * ⚠⚠ **The day turned: ⚠ everything goes.**
 *
 * ⚠ **Including the rooms that are still open.** ⚠ **They keep running — ⚠ nothing is cut** —
 * ⚠ **and their next report is read as a first report, ⚠ so today is charged for what happens
 * today.** ⚠ **That is the same rule the free tier's own reset follows.**
 */
export const onDay = (ledger: Ledger, day: string): Ledger =>
  ledger.day === day ? ledger : emptyLedger(day);

/**
 * ⚠⚠ **Why a room cannot be made right now.** ⚠ `null` means it can.
 *
 * ⚠ **Two answers, ⚠ not three** (Owner 決定 2026-09-08). ⚠ **"the service is full" and "too many
 * at once" are one answer, ⚠ because telling them apart would say how busy kagima is.**
 * ⚠ **The person's own budget is separate, ⚠ because saying "you have used yours up" to somebody
 * who has not is untrue and changes what they do next** (`CLAUDE.md` § 4-1).
 */
export type Refusal = "spent" | "busy";

export const mayOpen = (ledger: Ledger, host: string, limits: Limits = LIMITS): Refusal | null => {
  // ⚠ Their own first. ⚠ It is the one that names a next move — ⚠ "tomorrow" rather than "later".
  if ((ledger.perHost[host] ?? 0) >= limits.hostMs) return "spent";
  if (ledger.usedMs >= limits.serviceMs) return "busy";
  if (openRooms(ledger) >= limits.openRooms) return "busy";
  return null;
};

/** ⚠ **What a person reads** (`docs/adr/0031`, Owner 決定 2026-09-08). ⚠ **Never shown to a Guest.** */
export const WORDING: Readonly<Record<Refusal, string>> = {
  spent: "今日の分を使い切りました。明日またルームを作れます。",
  busy: "いま新しいルームを作れません。しばらくしてからお試しください。",
};

/**
 * ⚠ **A room was opened.** ⚠ **Refuses to open one twice** — ⚠ **a repeat would make the cap on
 * how many are open count one room as two, ⚠ and that cap is what bounds the overshoot.**
 */
export const opened = (ledger: Ledger, roomId: string, host: string): Ledger =>
  ledger.perRoom[roomId] !== undefined
    ? ledger
    : { ...ledger, perRoom: { ...ledger.perRoom, [roomId]: { host, ms: 0 } } };

/**
 * ⚠⚠ **A room said how long it has been held, ⚠ in total.**
 *
 * ⚠ **`total − last` is added.** ⚠ **A repeat adds zero; ⚠ a total that went backwards adds
 * zero** — ⚠ **it came from another process and is not something to trust into a subtraction.**
 * ⚠ **A room the ledger does not know is not counted.** ⚠ **It was never opened here — ⚠ the day
 * may have turned under it — ⚠ and inventing a row would let a report create a room.**
 */
export const reported = (ledger: Ledger, roomId: string, totalMs: number): Ledger => {
  const row = ledger.perRoom[roomId];
  if (row === undefined || !Number.isFinite(totalMs)) return ledger;
  const added = Math.max(0, totalMs - row.ms);
  if (added === 0) return ledger;
  return {
    ...ledger,
    usedMs: ledger.usedMs + added,
    perHost: { ...ledger.perHost, [row.host]: (ledger.perHost[row.host] ?? 0) + added },
    perRoom: { ...ledger.perRoom, [roomId]: { ...row, ms: row.ms + added } },
  };
};

/** ⚠ **The room is over.** ⚠ **Its last total is counted, ⚠ and then its row goes.** */
export const over = (ledger: Ledger, roomId: string, totalMs: number): Ledger => {
  const counted = reported(ledger, roomId, totalMs);
  const { [roomId]: gone, ...rest } = counted.perRoom;
  return gone === undefined ? counted : { ...counted, perRoom: rest };
};

/**
 * ⚠⚠ **What the ledger's answer means, ⚠ read fail-closed** (Owner 決定 2026-09-08).
 *
 * ⚠ **`null` for `answer` is "it could not be reached".** ⚠ **That is a refusal** — ⚠ **a window
 * where the cap does not apply is a window in which the whole day can be spent, ⚠ and one object
 * being a single point of failure was accepted with that in mind** (`docs/adr/0031`).
 * ⚠ **An answer we do not understand is the same: ⚠ we did not learn that it is allowed.**
 * ⚠ **"The ledger did not say no" is not "the ledger said yes"**
 * (`.claude/rules/evidence.md` § Silence is not permission).
 */
export const refusalFrom = (answer: { readonly ok: boolean; readonly said: unknown } | null) => {
  if (answer === null || !answer.ok) return "busy" as Refusal;
  const said = answer.said;
  if (typeof said !== "object" || said === null) return "busy" as Refusal;
  const refused = (said as { refused?: unknown }).refused;
  if (refused === null) return null;
  if (refused === "spent" || refused === "busy") return refused;
  return "busy" as Refusal;
};
