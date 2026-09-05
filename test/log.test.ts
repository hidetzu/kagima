// ⚠ **What is under test is that a secret cannot reach a log line.**
//
// ⚠ **Two halves, and both are needed:**
//   ⚠ **the boundary takes secrets out**, ⚠ **and nothing bypasses the boundary.**
// ⚠ **Either one alone is a promise, not a wall** (`.claude/rules/security.md` § 2).
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { test } from "node:test";
import { REDACTED, createLogger, redact, scrub } from "../src/log.ts";
import { generatePassphrase } from "../src/passphrase/passphrase.ts";
import { issueJoinToken } from "../src/token/join-token.ts";

const lines: string[] = [];
const log = createLogger({ write: (l) => lines.push(l) });
const capture = (fn: () => void): string => {
  lines.length = 0;
  fn();
  return lines.join("\n");
};

const PASSPHRASE = generatePassphrase();
// ⚠ Awaited at module scope. ⚠ Minting a token is asynchronous now, ⚠ because Web Crypto is
//   (`docs/adr/0015`). ⚠ Node runs a module's top-level await before anything imports it.
const TOKEN = await issueJoinToken("some-room", "some-secret", Date.now());

// ── the boundary takes secrets out ──────────────────────────────────────────

test("⚠ a passphrase under any field name is taken out", () => {
  // ⚠ By shape, not by name. ⚠ The name here says nothing.
  const said = capture(() => log.info("a join failed", { what: PASSPHRASE }));
  assert.ok(!said.includes(PASSPHRASE), said);
  assert.ok(said.includes(REDACTED));
});

test("⚠ a field whose NAME says secret is taken out whatever it holds", () => {
  // ⚠ By name, not by shape. ⚠ This catches a value we would not recognise.
  const said = capture(() =>
    log.info("config", { JOIN_TOKEN_SECRET: "an-ordinary-looking-string" }),
  );
  assert.ok(!said.includes("an-ordinary-looking-string"), said);
});

test("⚠ a join token is taken out", () => {
  const said = capture(() => log.info("issued", { t: TOKEN }));
  assert.ok(!said.includes(TOKEN), said);
});

test("⚠⚠ the whole request body, passed whole, is safe", () => {
  // ⚠ This is how it actually breaks. ⚠ Nobody writes log(passphrase); people write log(body).
  const body = { passphrase: PASSPHRASE, nickname: "someone", roomId: "abc" };
  const said = capture(() => log.info("bad join", { body }));
  assert.ok(!said.includes(PASSPHRASE), said);
  assert.ok(said.includes("someone"), "an innocent field was lost");
});

test("⚠⚠ the whole error, passed whole, is safe", () => {
  // ⚠ The other way it breaks. ⚠ The passphrase is inside the message, under no field name at all.
  const err = new Error(`could not join with ${PASSPHRASE}`);
  const said = capture(() => log.warn("join threw", { err }));
  assert.ok(!said.includes(PASSPHRASE), said);
  assert.ok(said.includes("Error"), "the error's name was lost");
});

test("⚠ a secret interpolated into the message itself is taken out", () => {
  // ⚠ Scrubbing only the fields would leave the most obvious hole open.
  const said = capture(() => log.info(`tried ${PASSPHRASE}`));
  assert.ok(!said.includes(PASSPHRASE), said);
});

test("⚠ a secret nested several levels down is taken out", () => {
  const said = capture(() => log.info("deep", { a: { b: { c: [{ passphrase: PASSPHRASE }] } } }));
  assert.ok(!said.includes(PASSPHRASE), said);
});

test("⚠ a cycle does not hang the process", () => {
  // ⚠ Losing the process loses every live room (`docs/adr/0005`).
  const a: Record<string, unknown> = { name: "a" };
  a["self"] = a;
  const said = capture(() => log.info("cycle", { a }));
  assert.ok(said.includes("[circular]"), said);
});

test("ordinary text survives", () => {
  // ⚠ A redactor that eats everything is not usable, and an unusable one gets bypassed.
  const said = capture(() =>
    log.info("kagima is listening", { baseUrl: "http://localhost:8787", port: 8787 }),
  );
  assert.ok(said.includes("http://localhost:8787"), said);
  assert.ok(said.includes("8787"), said);
});

test("⚠ a failed-join line can say that it failed without saying what was tried", () => {
  const said = capture(() => log.info("join refused", { roomId: "abcdefgh12345678" }));
  assert.ok(said.includes("join refused"));
  assert.ok(!said.includes(PASSPHRASE));
});

test("scrub and redact are the same rule, reachable on their own", () => {
  assert.equal(scrub(PASSPHRASE), REDACTED);
  assert.equal(scrub(TOKEN), REDACTED);
  assert.deepEqual(redact({ secret: "x" }), { secret: REDACTED });
});

// ── ⚠ nothing bypasses the boundary ─────────────────────────────────────────

const sourceFiles = async (dir = "src"): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = joinPath(dir, e.name);
    if (e.isDirectory()) out.push(...(await sourceFiles(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
};

test("⚠⚠ only src/log.ts writes to the console", async () => {
  // ⚠ Without this, log.ts is a convenience rather than a wall — anyone can just call console.log
  //   ⚠ and the redaction never runs. ⚠ `security.md` § 2 says a rule every call site must
  //   ⚠ remember is not a rule.
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    if (file === "src/log.ts") continue;
    const code = (await readFile(file, "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    if (/\bconsole\s*\.\s*\w+\s*\(/.test(code)) offenders.push(`${file} (console)`);
    if (/\bprocess\s*\.\s*std(out|err)\s*\.\s*write\s*\(/.test(code))
      offenders.push(`${file} (stdout)`);
  }
  assert.deepEqual(offenders, [], `output bypasses the log boundary in: ${offenders.join(", ")}`);
});
