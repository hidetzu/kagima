// The one place a line of log is built, and the one place a secret is taken out of it.
//
// ⚠ **`.claude/rules/security.md` § 2**: ⚠ **redact at the boundary that builds the line, not at
//   ⚠ the call site.** ⚠ **A rule every call site has to remember is not a rule, it is a hope.**
//
// ## ⚠ How this actually breaks
//
// ⚠ **Not `log(passphrase)`.** ⚠ **Nobody writes that.**
// ⚠ **It is `log(requestBody)` and `log(err)` with the body hanging off it**, ⚠ **and it looks
//   ⚠ completely reasonable in a diff.**
// ⚠ **So redaction here is not a list of field names to avoid. ⚠ It walks whatever it is handed.**
//
// ## ⚠ Two ways a secret is recognised, and why both are needed
//
// ```text
// by the name of the field   ⚠ { passphrase: "..." }        ⚠ catches a value we do not recognise
// by the shape of the value  ⚠ "sakana-tsuki-arashi-midori" ⚠ catches a value under an innocent name
// ```
//
// ⚠ **Neither alone is enough.** ⚠ **A token under a key called `t` has no recognisable name.**
//
// ⚠ **The shape half used to also catch a passphrase by its word list.** ⚠ **kagima has no
//   ⚠ passphrase any more** (`docs/adr/0017`) — ⚠ **who comes in is the Host's decision.**
// ⚠ **So that half went with it.** ⚠ **The name half stays, ⚠ and it still covers the join token.**
//
// ⚠ **What this cannot do:** ⚠ **it cannot recognise a secret that looks like ordinary text and
//   ⚠ sits under an ordinary name.** ⚠ **That is a real gap, and naming it is not the same as
//   ⚠ closing it** — ⚠ **the wall against that is not passing such a thing in.**

/** ⚠ **What replaces anything recognised.** ⚠ Fixed, so a redaction is obvious in a log. */
export const REDACTED = "[redacted]";

// ⚠ Field names whose value is never printed, whatever it holds.
//   ⚠ Matched loosely on purpose: `joinToken`, `TURN_KEY_API_TOKEN` and `authorization` all hit.
const SECRET_KEY = /pass(phrase|word)|secret|token|credential|authoriz|cookie|api[-_]?key/i;

// ⚠ A join token, by shape: two long base64url runs joined by a dot (`src/token/join-token.ts`).
const looksLikeAToken = (value: string): boolean =>
  /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(value);

/** ⚠ **Applied to every string that reaches a log, wherever it came from.** */
export const scrub = (value: string): string => {
  if (looksLikeAToken(value)) return REDACTED;
  // ⚠ Also inside a longer sentence — this is the `err.message` case, and it is the common one.
  // ⚠ The token shape only. ⚠ The word-list shape went with the passphrase (`docs/adr/0017`).
  return value.replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, REDACTED);
};

/** ⚠ **Deep enough for anything worth logging.** ⚠ Past it, the value is replaced rather than walked. */
const MAX_DEPTH = 6;

/**
 * ⚠ **Walks whatever it is handed.** ⚠ **A whole request body and a whole `Error` both come
 * through here**, ⚠ **because those are what actually get passed.**
 */
export const redact = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (typeof value === "string") return scrub(value);
  if (value === null || typeof value !== "object") return value;
  // ⚠ A cycle would hang the process. ⚠ Losing the process loses every live room (`docs/adr/0005`).
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[deep]";
  seen.add(value);

  if (value instanceof Error) {
    // ⚠ The stack is kept, scrubbed. ⚠ Dropping it makes an incident unreadable, and the thing
    //   ⚠ that leaks is the message, not the frames.
    return {
      name: value.name,
      message: scrub(value.message),
      stack: value.stack === undefined ? undefined : scrub(value.stack),
    };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    // ⚠ By name first: a value we would not recognise is still gone if the key says what it is.
    out[key] = SECRET_KEY.test(key) ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
};

export type Logger = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
};

export type LoggerOptions = {
  /** ⚠ **Where a finished line goes.** ⚠ Injected so a test reads exactly what would be written. */
  readonly write: (line: string) => void;
};

/**
 * ⚠ **The boundary.**
 *
 * ⚠ **`test/log.test.ts` asserts that nothing else under `src/` writes to the console.**
 * ⚠ **Without that, this file is a convenience and not a wall** — ⚠ **and `security.md` says so
 * about itself.**
 */
export const createLogger = (options: LoggerOptions): Logger => {
  const line = (level: string, message: string, fields?: Record<string, unknown>): void => {
    // ⚠ The message is scrubbed too. ⚠ A caller interpolating a value into it is the same leak
    //   ⚠ wearing different clothes.
    const parts = [level, scrub(message)];
    if (fields !== undefined) parts.push(JSON.stringify(redact(fields)));
    options.write(parts.join(" "));
  };
  return {
    info: (message, fields) => line("info", message, fields),
    warn: (message, fields) => line("warn", message, fields),
  };
};

/** ⚠ **The real one.** ⚠ The only place in `src/` allowed to touch the console. */
export const logger: Logger = createLogger({
  // biome-ignore lint/suspicious/noConsole: ⚠ this is the boundary; every other call site is forbidden
  write: (l) => console.log(l),
});
