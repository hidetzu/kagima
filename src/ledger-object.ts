// ⚠⚠ **The day's budget, ⚠ in one Durable Object** (`docs/adr/0031`).
//
// ⚠⚠ **This is the first thing in kagima that outlives a single room.** ⚠ **`CLAUDE.md` § 3 says
//   ⚠ nothing may survive the process without an ADR; ⚠ `docs/adr/0031` is that ADR.**
//
// ## ⚠ Why an object and not KV
//
// ⚠ **A Durable Object runs one call at a time.** ⚠ **Read, add, write is atomic because of that,
//   ⚠ and a budget that is not atomic is not a budget.** ⚠ **KV is eventually consistent and
//   ⚠ cannot answer "may I" at the moment it is asked.**
//
// ## ⚠⚠ What is NOT in here
//
// ⚠ **No address.** ⚠ **A host is an HMAC of their account under this deployment's signing key**
//   (`src/worker.ts` makes it), ⚠ **so the mark means nothing anywhere else.**
// ⚠ **Nothing at all outlives the UTC day** — ⚠ **the whole ledger is thrown away when it turns**
//   (`docs/PRODUCT.md` § 5: ⚠ **what somebody did is not kept**).
//
// ⚠ **The arithmetic is `src/quota/ledger.ts`, ⚠ and it is pure.** ⚠ **This file is storage and
//   ⚠ a route table.**
import { logger } from "./log.ts";
import {
  dayOf,
  emptyLedger,
  type Ledger,
  mayOpen,
  onDay,
  opened,
  over,
  reported,
} from "./quota/ledger.ts";

/** ⚠ **One key.** ⚠ **One object for the whole service, ⚠ so there is nothing to key by.** */
const KEY = "ledger";

/** ⚠ **The name the one ledger is addressed by.** ⚠ **Named here so both callers say the same.** */
export const LEDGER_NAME = "the-day";

export type LedgerStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
};

export type LedgerState = { readonly storage: LedgerStorage };

/** ⚠ **What a caller may ask.** ⚠ **Three things, ⚠ and none of them reads the ledger out.** */
export type Asked =
  | { readonly ask: "open"; readonly host: string; readonly roomId: string }
  | { readonly ask: "give-back"; readonly roomId: string }
  | {
      readonly ask: "used";
      readonly roomId: string;
      readonly totalMs: number;
      readonly over?: boolean;
    };

/**
 * ⚠ **It arrives as JSON from inside our own deployment.** ⚠ **Checked anyway** — ⚠ **a shape
 * that is merely expected is not a shape that was checked** (`.claude/rules/evidence.md`).
 */
export const readAsked = (body: unknown): Asked | null => {
  if (typeof body !== "object" || body === null) return null;
  const said = body as Record<string, unknown>;
  const roomId = said.roomId;
  if (typeof roomId !== "string" || roomId === "") return null;
  if (said.ask === "open") {
    return typeof said.host === "string" && said.host !== ""
      ? { ask: "open", host: said.host, roomId }
      : null;
  }
  if (said.ask === "give-back") return { ask: "give-back", roomId };
  if (said.ask === "used") {
    const totalMs = said.totalMs;
    if (typeof totalMs !== "number" || !Number.isFinite(totalMs) || totalMs < 0) return null;
    return { ask: "used", roomId, totalMs, over: said.over === true };
  }
  return null;
};

export class LedgerObject {
  state: LedgerState;

  constructor(state: LedgerState) {
    this.state = state;
  }

  /**
   * ⚠ **Today's ledger.** ⚠ **Read, ⚠ and rolled over if the day turned while it sat there.**
   *
   * ⚠ **Rooms that are open when the day turns are not cut** (Owner 決定 2026-09-08) — ⚠ **their
   * rows go with everything else, ⚠ and their next report is read as a first report, ⚠ so today
   * is charged for today.**
   */
  private async today(at: number): Promise<Ledger> {
    const held = await this.state.storage.get<Ledger>(KEY);
    const day = dayOf(at);
    return held === undefined ? emptyLedger(day) : onDay(held, day);
  }

  async fetch(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const asked = readAsked(body);
    if (asked === null) {
      // ⚠ Nobody outside can reach this object; ⚠ only our own code can. ⚠ So this is our own
      //   ⚠ mistake and it says so, ⚠ rather than inventing an answer for a caller.
      return json(500, { error: "the ledger was asked something it does not understand" });
    }

    const at = Date.now();
    const before = await this.today(at);

    if (asked.ask === "open") {
      const refused = mayOpen(before, asked.host);
      // ⚠ Written even when refused — ⚠ the day may have rolled over on this very call, ⚠ and
      //   ⚠ dropping that would count yesterday's total against today.
      const after = refused === null ? opened(before, asked.roomId, asked.host) : before;
      await this.state.storage.put(KEY, after);
      // ⚠ Counted, ⚠ so a refusal is not indistinguishable from a request that never arrived
      //   (`.claude/rules/evidence.md`). ⚠ Says why, ⚠ and never who or which room.
      if (refused !== null) logger.info("a room was not opened", { why: refused });
      return json(200, { refused });
    }

    if (asked.ask === "give-back") {
      // ⚠ The id was already a live room, ⚠ so this claim was never used
      //   (`src/worker.ts` tries another). ⚠ Nothing was spent on it.
      await this.state.storage.put(KEY, over(before, asked.roomId, 0));
      return json(200, {});
    }

    const after = asked.over
      ? over(before, asked.roomId, asked.totalMs)
      : reported(before, asked.roomId, asked.totalMs);
    await this.state.storage.put(KEY, after);
    return json(200, {});
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
