// ⚠⚠ **A signalling transport that comes back** (kagima#70).
//
// ⚠ **`connectSignaling` opens one socket and that is all it does.** ⚠ **When that socket goes
//   ⚠ away, the Host is out of their own room** — ⚠ **and the knocks that arrive while they are
//   ⚠ gone reach nobody** (`docs/adr/0018`: ⚠ **only the Host hears a knock**).
//
// ## ⚠ Why the object's identity matters
//
// ⚠ **`createCall({ transport })` keeps the object it was handed.** ⚠ **Swapping in a new
//   ⚠ transport would leave the call talking to a socket nobody is listening to** — ⚠ **and it
//   ⚠ would fail silently, ⚠ because sending into a closed socket throws nothing useful.**
// ⚠ **So this object is created once and the socket underneath it is replaced.**
//
// ## ⚠ What it must not do
//
// ⚠ **Never stop the tracks** (`docs/adr/0010`). ⚠ **Signalling going away is not the call
//   ⚠ ending: ⚠ media goes browser to browser and does not need us.**
// ⚠ **Never retry forever.** ⚠ **An unbounded retry is an attack on us and on somebody's battery.**
// ⚠ **Never retry a close that says the room is over, ⚠ or that we were refused** — ⚠ **those do
//   ⚠ not become true by asking again.**
import type { SignalMessage, Transport } from "./call.ts";
import { connectSignaling, type SocketTransport } from "./transport.ts";

/**
 * ⚠ **Close codes that are answers, ⚠ not accidents.**
 *
 * ⚠ **Asking again cannot change any of them**, ⚠ **so asking again is only noise:**
 *
 * ```text
 * 4001  ⚠ refused at the door        ⚠ the token will not become valid
 * 4002  ⚠ the room already has two   ⚠ retrying would hammer a full room
 * 4003  ⚠ we sent something bad      ⚠ ours to fix, not to repeat
 * 4005  ⚠ the room is over           ⚠ there is nothing to come back to
 * 1000  ⚠ we closed it on purpose
 * ```
 *
 * ⚠ **`4004` (silent) is deliberately NOT here.** ⚠ **That is exactly the one worth coming back
 * from** — ⚠ **and it is the one kagima#62 will start producing.**
 */
export const FINAL_CLOSE_CODES: readonly number[] = [1000, 4001, 4002, 4003, 4005];

/**
 * ⚠ **How long to wait before each attempt, in order.**
 *
 * ⚠⚠ **These are chosen values, ⚠ not measured ones** (`.claude/rules/evidence.md`).
 * ⚠ **Nobody has measured how long a page is away when somebody switches apps to paste a URL.**
 * ⚠ **The shape is: ⚠ try quickly twice, ⚠ then back off, ⚠ then give up rather than grind.**
 * ⚠ **The length of this list is the bound.**
 */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1_000, 2_000, 4_000, 8_000, 8_000];

export type Reconnecting = Transport & {
  /** ⚠ **The socket in use right now**, ⚠ or `null` while between attempts. */
  currentSocket(): WebSocket | null;
  /** ⚠ **Called after every socket that opens, ⚠ including the first.** */
  onOpen(handler: () => void): void;
  /**
   * ⚠ **Called once, ⚠ when there is no coming back.**
   *
   * ⚠ **Either a close code that is an answer, ⚠ or the retries ran out.**
   * ⚠ **`code` is the last one seen** — ⚠ **the page decides what to say, ⚠ not this file**
   * (`CLAUDE.md` § 4).
   */
  onGaveUp(handler: (code: number) => void): void;
  /** ⚠ **Stop, on purpose.** ⚠ No further attempts, ⚠ and `onGaveUp` does not fire. */
  close(): void;
};

export type ReconnectingOptions = {
  /**
   * ⚠ **A fresh way in, ⚠ asked for on every attempt.**
   *
   * ⚠ **Not a token held in a variable** — ⚠ **a join token is short-lived, ⚠ and the one that
   * worked a minute ago is exactly the one that will not work now** (`docs/adr/0018`).
   */
  readonly token: () => Promise<string>;
  readonly roomId: string;
  readonly origin?: string;
  readonly delaysMs?: readonly number[];
  /** ⚠ Injected so a check does not wait out real seconds. */
  readonly wait?: (ms: number) => Promise<void>;
  readonly connect?: (roomId: string, token: string, origin?: string) => Promise<SocketTransport>;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const connectReconnecting = async (options: ReconnectingOptions): Promise<Reconnecting> => {
  const delays = options.delaysMs ?? RETRY_DELAYS_MS;
  const wait = options.wait ?? sleep;
  const connect = options.connect ?? connectSignaling;

  const messageHandlers: Array<(m: SignalMessage) => void> = [];
  const openHandlers: Array<() => void> = [];
  const gaveUpHandlers: Array<(code: number) => void> = [];

  let socket: SocketTransport | null = null;
  let stopped = false;
  let gaveUp = false;

  const giveUp = (code: number): void => {
    if (gaveUp || stopped) return;
    gaveUp = true;
    for (const h of gaveUpHandlers) h(code);
  };

  /** ⚠ Attach to whatever socket we have now. ⚠ The handler lists outlive every socket. */
  const adopt = (fresh: SocketTransport): void => {
    socket = fresh;
    fresh.onMessage((m) => {
      for (const h of messageHandlers) h(m);
    });
    fresh.socket.addEventListener("close", (event) => {
      socket = null;
      if (stopped) return;
      // ⚠ An answer, not an accident. ⚠ Asking again cannot change it.
      if (FINAL_CLOSE_CODES.includes(event.code)) return giveUp(event.code);
      void retry(event.code);
    });
    for (const h of openHandlers) h();
  };

  const retry = async (lastCode: number): Promise<void> => {
    for (const delay of delays) {
      if (stopped) return;
      await wait(delay);
      if (stopped) return;
      try {
        // ⚠ A fresh token every attempt. ⚠ The old one may well have expired while we waited.
        adopt(await connect(options.roomId, await options.token(), options.origin));
        return;
      } catch {
        // ⚠ Nothing is said here. ⚠ Why it failed is not ours to guess, and the caller learns
        //   ⚠ the one thing that matters — that we stopped — from `onGaveUp`.
      }
    }
    giveUp(lastCode);
  };

  adopt(await connect(options.roomId, await options.token(), options.origin));

  return {
    send: (message) => socket?.send(message),
    onMessage: (h) => void messageHandlers.push(h),
    onOpen: (h) => void openHandlers.push(h),
    onGaveUp: (h) => void gaveUpHandlers.push(h),
    currentSocket: () => socket?.socket ?? null,
    close: () => {
      stopped = true;
      socket?.close();
    },
  };
};
