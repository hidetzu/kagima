// ⚠⚠ **What to do when the media path has failed and the signalling path has not**
//   (`docs/adr/0026`, kagima#89).
//
// ## ⚠ Why this is not in `src/client/call.ts`
//
// ⚠ **The decision here is a small state machine, ⚠ and none of it needs a browser.**
// ⚠ **`src/client/call.ts` is the one file that touches media, ⚠ so nothing in it can be held by
//   ⚠ the fast tier** — ⚠ **there is no ICE agent in a unit test, ⚠ and there never will be.**
// ⚠ **`src/diagnostics/report.ts` was split out for exactly this reason and is the shape copied
//   ⚠ here**: ⚠ **the part that can be decided against fixtures lives where fixtures can reach it.**
//
// ⚠ **So this file names nothing from the media APIs.** ⚠ **States are plain strings, ⚠ and
//   ⚠ `test/no-media-on-the-server.test.ts` walks this directory like any other.**
//
// ## ⚠ What this does not do
//
// ⚠ **It does not open the door.** ⚠ **An ICE restart re-negotiates a connection that is already
//   ⚠ authorised** — ⚠ **no knock, ⚠ no new join token, ⚠ and the Host is not asked again**
//   (`docs/adr/0017`, `.claude/rules/security.md` § 4).
// ⚠ **It cannot help a page that is gone.** ⚠ **That is kagima#90, ⚠ and it is a different
//   ⚠ question because it does touch the door.**

/**
 * ⚠ **Everything this needs from the outside**, ⚠ and each piece is read, ⚠ never assumed.
 */
export type RestartWorld = {
  /**
   * ⚠ **The connection's own word for where it is.**
   *
   * ⚠ **A string rather than the browser's type**, ⚠ **so this file stays outside `src/client`.**
   * ⚠ **Only `connected` and `closed` are acted on; ⚠ anything else means "still not back".**
   */
  connectionState(): string;
  /**
   * ⚠⚠ **Whether an offer sent right now would actually leave this page.**
   *
   * ⚠ **This is the whole point of the check.** ⚠ **The reconnecting transport drops a `send`
   * on the floor while it is between sockets** (`src/client/reconnect.ts`) — ⚠ **so restarting
   * into a closed socket spends an attempt and produces nothing.**
   */
  canSignal(): boolean;
  /** ⚠ **Build a fresh offer with ICE restarted, and send it.** */
  offerAgain(): Promise<void>;
  wait(ms: number): Promise<void>;
};

/**
 * ⚠ **How long to wait before each attempt, in order.**
 *
 * ⚠⚠ **These are chosen values, ⚠ not measured ones** (`.claude/rules/evidence.md`) —
 * ⚠ **the same footing as `RETRY_DELAYS_MS` in `src/client/reconnect.ts`.**
 *
 * ⚠ **What *is* measured: ⚠ on 2026-09-06 a real call went `disconnected` at 78761ms and
 * `failed` at 88762ms.** ⚠ **Chromium spent 10.0 seconds deciding.** ⚠ **By the time this runs,
 * that time is already gone, ⚠ so the first wait is short.**
 *
 * ⚠ **The length of this list is the bound.** ⚠ **Nothing here grinds.**
 */
export const RESTART_DELAYS_MS: readonly number[] = [500, 2_000, 4_000, 8_000, 8_000];

/**
 * ⚠⚠ **The same thing, ⚠ for the side that did not offer first** (`docs/adr/0027`, kagima#93).
 *
 * ⚠ **Why this exists: ⚠ `docs/adr/0026` gave the duty to the offerer alone, ⚠ to avoid glare.**
 * ⚠⚠ **Measured on 2026-09-06: ⚠ the offerer was a phone, ⚠ the phone was in the background, ⚠ and
 * the call sat in `failed` for 82.7 seconds while the Host's page was awake the whole time and
 * answering every heartbeat.** ⚠ **Seeing `failed` and being able to act on it are different.**
 *
 * ⚠⚠ **The first wait is the whole mechanism.** ⚠ **It is longer than the offerer's first two
 * attempts put together, ⚠ so a working offerer always goes first and this side never fires.**
 * ⚠ **`test/ice-restart.test.ts` holds that as a property rather than as a pair of numbers.**
 */
export const ANSWERER_RESTART_DELAYS_MS: readonly number[] = [8_000, 4_000, 8_000, 8_000];

/**
 * ⚠ **Which list a side uses.** ⚠ **One place, ⚠ so the two cannot drift apart** (`CLAUDE.md` § 3).
 */
export const restartDelaysFor = (isOfferer: boolean): readonly number[] =>
  isOfferer ? RESTART_DELAYS_MS : ANSWERER_RESTART_DELAYS_MS;

/**
 * ⚠⚠ **What to do with an offer that arrives while one of ours is already in flight.**
 *
 * ⚠ **Both sides may now restart, ⚠ so both may offer at once.** ⚠ **That is glare, ⚠ and
 * `setRemoteDescription` on an offer while `have-local-offer` throws.**
 *
 * ⚠ **Three outcomes, ⚠ kept apart on purpose**
 * (`.claude/rules/evidence.md` § Outcomes are not one outcome).
 */
export type Glare =
  /** ⚠ Nothing of ours is in flight. ⚠ The ordinary path. */
  | "take-it"
  /** ⚠ Ours wins. ⚠ **The side that offered first always wins**, ⚠ so the rule needs no negotiating. */
  | "ignore-it"
  /** ⚠ Ours yields. ⚠ Undo our own offer, ⚠ then answer theirs. */
  | "roll-back-first";

export const onIncomingOffer = (isOfferer: boolean, signalingState: string): Glare =>
  signalingState !== "have-local-offer" ? "take-it" : isOfferer ? "ignore-it" : "roll-back-first";

/**
 * ⚠ **Three ways this ends, ⚠ and they are not one outcome**
 * (`.claude/rules/evidence.md` § Outcomes are not one outcome).
 */
export type RestartOutcome =
  /** ⚠ The connection reported `connected` again. */
  | "recovered"
  /** ⚠ The connection was closed while we were trying. ⚠ **Not a failure to recover.** */
  | "gone"
  /** ⚠ Every attempt was spent and it is still not back. */
  | "exhausted";

/**
 * ⚠ **Try to get the media path back, ⚠ a bounded number of times.**
 *
 * ⚠ **Called once per failure**, ⚠ **and the caller is responsible for not running two at once**
 * — ⚠ **two offers in flight is glare, ⚠ and glare is how a working connection gets broken.**
 */
export const driveRestart = async (
  world: RestartWorld,
  delays: readonly number[] = RESTART_DELAYS_MS,
): Promise<RestartOutcome> => {
  for (const delay of delays) {
    await world.wait(delay);
    const state = world.connectionState();
    // ⚠ It came back. ⚠ Either this put it back or it healed on its own; ⚠ which one is not
    //   ⚠ knowable from here, ⚠ and the answer is the same either way.
    if (state === "connected") return "recovered";
    // ⚠ Somebody hung up. ⚠ Not something to recover from.
    if (state === "closed") return "gone";
    // ⚠⚠ Spending an attempt on a socket that cannot carry it is spending nothing.
    //   ⚠ Wait for the transport rather than burn the bound.
    if (!world.canSignal()) continue;
    try {
      await world.offerAgain();
    } catch {
      // ⚠ Why it would not build is not ours to guess (`src/client/reconnect.ts` says the same).
      //   ⚠ The next turn of the loop looks at the state again, which is the only thing that
      //   ⚠ settles it.
    }
  }
  return "exhausted";
};
