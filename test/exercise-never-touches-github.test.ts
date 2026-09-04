// ⚠ **The check that costs two issues' worth of grounds.**
//
// ⚠ **What happened (2026-09-04):** ⚠ **`CLAUDE_DEV_TELEMETRY_DIR` was set to keep a verification
//   ⚠ out of the real record.** ⚠ **It did exactly that, and nothing else** — ⚠ **the labels went
//   ⚠ onto two real issues, one of which had already been judged unfit for them.**
//   ⚠ **The variable redirects the record; ⚠ it never redirected GitHub, and the name read as
//   ⚠ though it did.**
//
// ⚠ **The tool now refuses.** ⚠ **A refusal with no check is a promise**
//   (`.claude/rules/security.md` says the same about redaction), ⚠ **so this is the wall.**
//
// ## ⚠ How this checks "it did not touch GitHub"
//
// ⚠ **Not by reading the source.** ⚠ **By putting a `gh` on `PATH` that records being called and
//   ⚠ then refusing** — ⚠ **so "GitHub was not touched" becomes an observable absence rather than
//   ⚠ an assumption about which lines run.**
//
// ⚠ **And with a positive control**: ⚠ **the same stub must be reached when the guard is not the
//   ⚠ thing stopping it.** ⚠ **Without that, this file would pass if the tool failed for any other
//   ⚠ reason at all** (`.claude/rules/verification.md`: ⚠ it failed ≠ it failed for the reason
//   ⚠ intended).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/** ⚠ **A `gh` that reaches nothing and says it was reached.** */
const stubDir = (): { dir: string; calledAt: string } => {
  const dir = mkdtempSync(join(tmpdir(), "kagima-gh-stub-"));
  const calledAt = join(dir, "gh-was-called");
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh\n: > "${calledAt}"\necho "the stub gh refuses" >&2\nexit 1\n`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  return { dir, calledAt };
};

const verdictFile = (dir: string, body: string): string => {
  const p = join(dir, "verdict.md");
  writeFileSync(p, body);
  return p;
};

const runTool = (dir: string, args: string[], env: Record<string, string>) =>
  spawnSync("node", [".claude/tools/ready-for-ai.mjs", ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env["PATH"] ?? ""}`, ...env },
  });

const YES = "Ready for AI: YES\n";

test("⚠⚠ with the record redirected, the tool refuses and never reaches gh", () => {
  const { dir, calledAt } = stubDir();
  const result = runTool(dir, ["--issue", "11", "--verdict-file", verdictFile(dir, YES)], {
    CLAUDE_DEV_TELEMETRY_DIR: dir,
  });

  assert.equal(result.status, 1, `expected a refusal, got ${result.status}: ${result.stderr}`);
  assert.match(result.stderr, /an exercise must not label a real issue/);
  // ⚠ The whole point. ⚠ Not "it exited 1" — ⚠ "nothing outside this process was asked anything".
  assert.equal(
    existsSync(calledAt),
    false,
    "the tool called gh despite the record being redirected",
  );
});

test("⚠ the same run with --dry-run does reach gh (⚠ the positive control)", () => {
  // ⚠ Without this, the case above would pass if the tool had simply failed to start.
  //   ⚠ It proves the stub is reachable, and that the guard is what stopped it.
  const { dir, calledAt } = stubDir();
  const result = runTool(
    dir,
    ["--issue", "11", "--verdict-file", verdictFile(dir, YES), "--dry-run"],
    { CLAUDE_DEV_TELEMETRY_DIR: dir },
  );

  assert.equal(existsSync(calledAt), true, "the stub gh was never reached — the control is broken");
  // ⚠ `--dry-run` still reads; it is the writing that it refuses. ⚠ The stub refuses every read,
  //   ⚠ so the tool fails here — ⚠ that failure is the control working, not the tool misbehaving.
  assert.notEqual(result.status, 0);
});

test("⚠ with no redirect, the guard does not fire (⚠ it guards, it does not block)", () => {
  // ⚠ A guard that always refuses would also pass the first case, and would break every real run.
  const { dir } = stubDir();
  const result = runTool(dir, ["--issue", "11", "--verdict-file", verdictFile(dir, YES)], {});
  assert.doesNotMatch(
    result.stderr,
    /an exercise must not label a real issue/,
    "the guard fired without the record being redirected",
  );
});
