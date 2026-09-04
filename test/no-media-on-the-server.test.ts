// ⚠ **The claim: kagima's Application Server has no code path that could receive a frame**
//   (`docs/adr/0001`, sharpened by the owner on 2026-09-04).
//
// ⚠ **What this check defends, exactly:** ⚠ **"our server does not receive media".**
// ⚠ **What it does NOT defend:** ⚠ **"the media is nowhere".**
//   ⚠ **The other browser has it, and what that browser does is outside anything we can assert**
//   (`.claude/rules/evidence.md`).
// ⚠ **Do not let a report read this as the stronger claim.**
//
// ⚠ **The type split does most of the work already** — ⚠ `tsconfig.json` excludes `src/client`
//   ⚠ and has no DOM lib, ⚠ so server code cannot reach `navigator.mediaDevices` and type-check.
// ⚠ **This is the belt to that pair of braces**, ⚠ **and it also covers what a comment or a
//   ⚠ dynamic import could sneak past the type checker.**
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const CLIENT = join("src", "client");

const serverFiles = async (dir = "src"): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    // ⚠ The browser's own code is the one place media belongs.
    if (p === CLIENT) continue;
    if (e.isDirectory()) out.push(...(await serverFiles(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
};

// ⚠ Names that only exist to move or hold media. ⚠ Strings, so a rename does not slip past.
const MEDIA = [
  "getUserMedia",
  "getDisplayMedia",
  "RTCPeerConnection",
  "RTCRtpReceiver",
  "MediaStream",
  "MediaRecorder",
  "mediaDevices",
  "addTrack",
  "ontrack",
];

test("⚠⚠ no server file names anything that could carry a media track", async () => {
  const offenders: string[] = [];
  for (const file of await serverFiles()) {
    const code = (await readFile(file, "utf8"))
      // ⚠ Comments stripped first, or this finds the sentences describing it (`CLAUDE.md` § 5).
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const name of MEDIA) {
      if (code.includes(name)) offenders.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [], `the server names a media API: ${offenders.join(", ")}`);
});

test("⚠ no server file imports the browser's call code", async () => {
  // ⚠ Importing it would drag the media path into the process even if nothing called it.
  const offenders: string[] = [];
  for (const file of await serverFiles()) {
    const code = await readFile(file, "utf8");
    // ⚠ `src/static.ts` names those files as strings to serve them; ⚠ serving a file is not
    //   ⚠ importing it, and the served bytes never enter this process's module graph.
    if (/^\s*import[^;]*from\s+["'][^"']*client\/(call|transport)\.ts["']/m.test(code)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the server imports the browser's call code: ${offenders.join(", ")}`,
  );
});
