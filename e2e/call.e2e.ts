// ⚠ **Two real browsers, fake cameras, one room** — ⚠ **and the question is whether frames move.**
//
// ⚠ **This is not `npm run check`.** ⚠ **It builds an environment: it starts the server and
//   ⚠ launches Chromium.** ⚠ **That makes it the final gate, and it lives outside `test/` so the
//   ⚠ fast tier does not accidentally launch a browser** (`.claude/skills/verify/SKILL.md`).
//
// ⚠ **It is not yet a named tier entry point.** ⚠ **kagima#13 owns turning it into `npm run e2e`
//   ⚠ with the partial-run obligations and a place in CI.** ⚠ **Until then this runs by hand, and
//   ⚠ a run by hand is evidence about the moment it ran and nothing more.**
//
//   node --test 'e2e/**/*.e2e.ts'
//
// ## ⚠ Why `connectionState` is not the assertion
//
// ⚠ **`connectionState === "connected"` with a black frame is exactly the failure this tier
//   ⚠ exists to catch.** ⚠ **So the assertion reads `framesDecoded` off the receiver's own stats,
//   ⚠ and the video element's `videoWidth`** — ⚠ **two things that cannot both be true of a
//   ⚠ connection that carries nothing.**
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server.ts";

const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;

// ⚠ Chromium's own fake devices. ⚠ A real camera would make the result depend on this machine.
const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
];

let browser: Browser | undefined;
// ⚠ Tracked at module level and closed in `after`, whatever happened.
//   ⚠ A browser left open by a failing assertion keeps the process alive, and the run hangs
//   ⚠ instead of reporting the failure — ⚠ the same harness defect kagima#6 already paid for once.
const browsers: Browser[] = [];
let server: ReturnType<typeof startServer> | undefined;

const launch = async (args: string[]): Promise<Browser> => {
  const b = await chromium.launch({ args });
  browsers.push(b);
  return b;
};

after(async () => {
  for (const b of browsers) await b.close().catch(() => {});
  server?.closeAllConnections();
  server?.close();
});

test("⚠⚠ two browsers in one room actually exchange frames", async () => {
  // ⚠ The server under test is the one just started, on a port nothing else is using
  //   (`.claude/rules/verification.md` — ⚠ a leftover dev server measures the previous run).
  process.env["JOIN_TOKEN_SECRET"] = "an-end-to-end-secret";
  server = startServer(PORT, BASE);
  await new Promise((r) => setTimeout(r, 200));

  const room = (await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json()) as {
    roomId: string;
    passphrase: string;
  };
  const tokenFor = async (): Promise<string> => {
    const res = await fetch(`${BASE}/api/rooms/${room.roomId}/join`, {
      method: "POST",
      body: JSON.stringify({ passphrase: room.passphrase }),
    });
    return ((await res.json()) as { token: string }).token;
  };

  browser = await launch(CHROMIUM_ARGS);
  const open = async (token: string, offerer: boolean) => {
    const context = await browser!.newContext({ permissions: ["camera", "microphone"] });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(
      `${BASE}/dev-call.html?room=${room.roomId}&token=${encodeURIComponent(token)}&offer=${offerer ? 1 : 0}`,
    );
    return { page, errors };
  };

  // ⚠ The guest joins first and waits; the host offers. ⚠ Both offering, or neither, is a deadlock.
  const guest = await open(await tokenFor(), false);
  const host = await open(await tokenFor(), true);

  // ⚠ What is waited for is frames, not a state name.
  const framesDecoded = async (page: (typeof host)["page"]): Promise<number> =>
    page.evaluate(async () => {
      const call = (globalThis as unknown as { kagimaCall?: { pc: RTCPeerConnection } }).kagimaCall;
      if (call === undefined) return -1;
      let frames = 0;
      for (const report of await call.pc.getStats()) {
        const stat = report[1] as { type?: string; kind?: string; framesDecoded?: number };
        if (stat.type === "inbound-rtp" && stat.kind === "video") {
          frames = Math.max(frames, stat.framesDecoded ?? 0);
        }
      }
      return frames;
    });

  const waitForFrames = async (page: (typeof host)["page"], who: string): Promise<number> => {
    for (let i = 0; i < 100; i++) {
      const frames = await framesDecoded(page);
      if (frames > 0) return frames;
      await new Promise((r) => setTimeout(r, 200));
    }
    // ⚠ Say what was observed, not "it failed". ⚠ Zero frames with a live connection is the
    //   ⚠ specific failure worth naming.
    const state = await page.evaluate(() => {
      const call = (globalThis as unknown as { kagimaCall?: { state(): unknown } }).kagimaCall;
      return call?.state() ?? "no call on the page";
    });
    assert.fail(`${who} decoded no frames. state: ${JSON.stringify(state)}`);
  };

  const hostFrames = await waitForFrames(host.page, "host");
  const guestFrames = await waitForFrames(guest.page, "guest");
  assert.ok(hostFrames > 0, "the host decoded no frames");
  assert.ok(guestFrames > 0, "the guest decoded no frames");

  // ⚠ A second, independent way of seeing the same thing. ⚠ A connection carrying nothing cannot
  //   ⚠ make both true.
  const remoteWidth = async (page: (typeof host)["page"]) =>
    page.evaluate(() => (document.getElementById("remote") as HTMLVideoElement).videoWidth);
  assert.ok((await remoteWidth(host.page)) > 0, "the host's remote video has no dimensions");
  assert.ok((await remoteWidth(guest.page)) > 0, "the guest's remote video has no dimensions");

  // ⚠ What ICE actually produced, recorded rather than assumed
  //   (`.claude/rules/verification.md` — ⚠ never assert what the other side will do).
  const candidates = await host.page.evaluate(() => {
    const call = (
      globalThis as unknown as {
        kagimaCall?: { state(): { candidateTypes: string[] } };
      }
    ).kagimaCall;
    return call?.state().candidateTypes ?? [];
  });
  console.log(`  observed: host decoded ${hostFrames} frames, guest ${guestFrames}`);
  console.log(`  observed: ICE candidate types produced by the host: ${candidates.join(", ")}`);

  assert.deepEqual(host.errors, [], `the host page threw: ${host.errors.join("; ")}`);
  assert.deepEqual(guest.errors, [], `the guest page threw: ${guest.errors.join("; ")}`);
});

test("⚠ a media failure says what to do, and never shows the raw error", async () => {
  // ⚠ "you did not allow the camera" is not "could not connect" and is not "nobody is here yet"
  //   (`CLAUDE.md` § 4-1). ⚠ Telling the user the wrong one either scares them off or hands an
  //   ⚠ attacker a fact. ⚠ So the refusal path is driven for real, in a browser that refuses.
  const room = (await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json()) as {
    roomId: string;
    passphrase: string;
  };
  const token = (
    (await (
      await fetch(`${BASE}/api/rooms/${room.roomId}/join`, {
        method: "POST",
        body: JSON.stringify({ passphrase: room.passphrase }),
      })
    ).json()) as { token: string }
  ).token;

  // ⚠ A second browser, launched WITHOUT `--use-fake-ui-for-media-stream`.
  //   ⚠ That flag auto-grants at the browser level, so a context's permissions cannot override it —
  //   ⚠ the first attempt at this test granted the camera and the page said "in the call".
  //   ⚠ The fake DEVICE flag stays, so this still needs no real camera.
  const denying = await launch(["--no-sandbox", "--use-fake-device-for-media-stream"]);
  const context = await denying.newContext({ permissions: [] });
  const page = await context.newPage();
  await page.goto(
    `${BASE}/dev-call.html?room=${room.roomId}&token=${encodeURIComponent(token)}&offer=1`,
  );

  await page.waitForFunction(
    () => (document.getElementById("status")?.textContent ?? "idle") !== "idle",
    undefined,
    { timeout: 15_000 },
  );
  const said = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  console.log(`  observed: the page said "${said}"`);

  // ⚠ What it must NOT say is as important as what it says.
  //   ⚠ This environment produces "NotSupportedError" rather than "NotAllowedError", so the
  //   ⚠ `denied` branch specifically is NOT verified here — ⚠ what IS verified is the contract
  //   ⚠ every branch has to meet. ⚠ Saying which is which is the point.
  assert.ok(
    !/Not supported|TypeError|undefined/.test(said),
    `the raw error reached the user: ${said}`,
  );
  assert.ok(!/^could not connect/i.test(said), `the wording blamed the connection: ${said}`);
  assert.match(said, /camera|microphone/i, `the wording did not name what to do: ${said}`);
  assert.match(
    said,
    /reload|another browser|connect one/i,
    `the wording did not say what to do next: ${said}`,
  );
  await context.close();
});
