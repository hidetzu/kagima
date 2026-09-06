// ⚠⚠ **kagima's Cloudflare gate.** ⚠ **The contract is `.claude/rules/verification.md`.**
//
// ## Usage
//
//   npm run worker             every case
//   npm run worker -- --list   ⚠ name them without running (⚠ loads no browser, ⚠ starts no Worker)
//
// ⚠ **This starts `wrangler dev --local` and launches Chromium.**
// ⚠ **No account, ⚠ no deploy, ⚠ nothing that costs anything.**
//
// ⚠ **What a green run says**: ⚠ **the code works in workerd, on this machine.**
// ⚠ **What it does NOT say**: ⚠ **anything about Cloudflare's network, ⚠ scheduler or billing.**
import { spawnSync } from "node:child_process";
import { build } from "./build.ts";

const argv = process.argv.slice(2);

// ⚠ One case today. ⚠ Named here so `--list` can say it without loading anything.
const CASES = [
  {
    name: "call",
    sees: "two browsers talking through a Worker and a Durable Object",
  },
] as const;

if (argv.includes("--list")) {
  console.log(`worker: ${CASES.length} cases, none run`);
  for (const c of CASES) console.log(`  ${c.name.padEnd(14)} ${c.sees}`);
  process.exit(0);
}

// ⚠⚠ **Build before the gate runs** (`docs/adr/0016`).
// ⚠ **The Worker serves `dist/`.** ⚠ **A gate run against a stale one measures the previous run.**
console.log(`worker: built ${build().length} files into dist/ first`);
console.log(`worker: running ${CASES.length} of ${CASES.length} cases`);

const result = spawnSync("node", ["--test", "worker-gate/**/*.worker.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH:
      process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? `${process.env["HOME"]}/.cache/ms-playwright`,
  },
});

console.log(
  result.status === 0
    ? `\nworker: ${CASES.length} of ${CASES.length} cases passed`
    : `\nworker: the run failed (exit ${result.status})`,
);
process.exit(result.status ?? 1);
