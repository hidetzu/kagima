// ⚠⚠ **kagima on Cloudflare, ⚠ exercised the way it is actually used** (`docs/adr/0015`).
//
// ⚠ **`npm run e2e` builds a Node server and drives Chromium.** ⚠ **This does the same against
//   ⚠ `wrangler dev --local`** — ⚠ **a real Worker, ⚠ a real Durable Object, ⚠ a real
//   ⚠ `WebSocketPair`.**
//
// ## ⚠ Why this exists at all
//
// ⚠ **`docs/adr/0015` said the port must not lower what can be verified.** ⚠ **Without this,
//   ⚠ every claim about Cloudflare would rest on somebody having run it by hand once.**
//
// ## ⚠ What it cannot show
//
// ⚠ **`--local` is workerd on this machine.** ⚠ **It is not Cloudflare's network, ⚠ not their
//   ⚠ scheduler, ⚠ and not their billing.** ⚠ **A green run here says the code works in the
//   ⚠ runtime, ⚠ and nothing about the platform it will run on.**
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, test } from "node:test";
import { type Browser, chromium, type Page } from "playwright";
import { issueSession, SESSION_COOKIE } from "../src/auth/session.ts";

const PORT = 8971;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * ⚠⚠ **The gate** (`docs/adr/0030`). ⚠ **Only the Host's page and making a room.**
 *
 * ⚠ **It stopped being a shared secret on 2026-09-08.** ⚠ **The person who makes a room signs in
 * with Google** — ⚠ **which no local check can do, ⚠ and must not try** (`.claude/rules/verification.md`:
 * ⚠ **a check whose result depends on a third party being up cannot assert our correctness**).
 *
 * ⚠⚠ **So the check mints the session itself, ⚠ with the same secret the Worker is given.**
 * ⚠ **What that proves: ⚠ the gate is ON, ⚠ a valid session passes it, ⚠ and the Guest half never
 * meets it.** ⚠ **What it does NOT prove: ⚠ anything about Google** — ⚠ **that half is
 * `test/sign-in.test.ts`, ⚠ against fixtures.**
 */
const SIGNING_SECRET = "a-worker-gate-secret";

const started: Array<{ kill: () => void }> = [];
const browsers: Browser[] = [];

after(async () => {
  for (const b of browsers) await b.close().catch(() => {});
  for (const s of started) s.kill();
});

/** ⚠ **A real Worker.** ⚠ **No account, ⚠ no deploy, ⚠ nothing that costs anything.** */
const theWorker = async (): Promise<void> => {
  const child = spawn(
    "node_modules/.bin/wrangler",
    [
      "dev",
      "--local",
      "--port",
      String(PORT),
      "--ip",
      "127.0.0.1",
      "--var",
      `PUBLIC_BASE_URL:${BASE}`,
      "--var",
      `JOIN_TOKEN_SECRET:${SIGNING_SECRET}`,
      // ⚠⚠ **The door before the door, ⚠ on** (`docs/adr/0030`). ⚠ **A run with it off would
      //   ⚠ prove nothing about it, ⚠ and the Guest half is the claim.**
      // ⚠ **The gate exists exactly when signing in does** (`src/worker.ts`), ⚠ **so these two
      //   ⚠ turn it on.** ⚠ **Neither is ever used: ⚠ nothing here talks to Google.**
      "--var",
      "GOOGLE_CLIENT_ID:a-client-id-nothing-here-uses",
      "--var",
      "GOOGLE_CLIENT_SECRET:a-client-secret-nothing-here-uses",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  started.push({ kill: () => child.kill() });

  const said: string[] = [];
  child.stdout.on("data", (d: Buffer) => said.push(d.toString()));
  child.stderr.on("data", (d: Buffer) => said.push(d.toString()));

  // ⚠ Waited for, ⚠ not slept through. ⚠ A fixed sleep is how a check becomes flaky.
  //
  // ⚠⚠ **Answering is up.** ⚠ **This waited for `ok` until 2026-09-06, ⚠ and the gate made `/`
  //   ⚠ answer 401** (`docs/adr/0024`) — ⚠ **so a Worker that was running looked like one that
  //   ⚠ never started, ⚠ for 50 seconds, ⚠ and then said so.**
  // ⚠ **"Is it up" and "did I get in" are different questions.**
  for (let i = 0; i < 200; i++) {
    try {
      await fetch(`${BASE}/`);
      return;
    } catch {
      // ⚠ Not up yet. ⚠ Saying why would be guessing.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(`the Worker did not start:\n${said.join("")}`);
};

const framesOf = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const call = (globalThis as unknown as { kagimaCall?: { pc: RTCPeerConnection } }).kagimaCall;
    if (call === undefined) return -1;
    let n = 0;
    for (const report of await call.pc.getStats()) {
      const stat = report[1] as { type?: string; kind?: string; framesDecoded?: number };
      if (stat.type === "inbound-rtp" && stat.kind === "video") {
        n = Math.max(n, stat.framesDecoded ?? 0);
      }
    }
    return n;
  });

test("⚠⚠ two browsers talking through a Worker and a Durable Object", async () => {
  await theWorker();

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  browsers.push(browser);

  // ⚠⚠ **The gate is real** (`docs/adr/0030`). ⚠ **Asserted before anything is opened, ⚠ so a
  //   ⚠ run that forgot to turn it on cannot look like a run that passed it.**
  //
  // ⚠ **A browser is sent to sign in; ⚠ anything else is refused** (`src/gate.ts`) — ⚠ **a caller
  //   ⚠ that is not a browser cannot follow a redirect to a consent screen.**
  // ⚠ **`redirect: "manual"`, ⚠ or `fetch` would follow it to Google and this would measure
  //   ⚠ somebody else's uptime** (`.claude/rules/verification.md`).
  const sentToSignIn = await fetch(`${BASE}/`, { redirect: "manual" });
  assert.equal(sentToSignIn.status, 302, "GET / is not behind the gate");
  assert.equal(sentToSignIn.headers.get("location"), "/auth/google");
  const refused = await fetch(`${BASE}/api/rooms`, { method: "POST", redirect: "manual" });
  assert.equal(refused.status, 401, "POST /api/rooms is not behind the gate");
  console.log("  observed: making a room is behind the gate");

  const hostContext = await browser.newContext({
    permissions: ["camera", "microphone"],
    // ⚠ The Host has it. ⚠ A browser would be asked; ⚠ here it is handed over.
    // ⚠ Signed here rather than obtained from Google — ⚠ see `SIGNING_SECRET` above.
    storageState: {
      cookies: [
        {
          name: SESSION_COOKIE,
          value: await issueSession("a-host@example.test", SIGNING_SECRET, Date.now()),
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax" as const,
        },
      ],
      origins: [],
    },
  });
  const host = await hostContext.newPage();
  host.on("pageerror", (e) => assert.fail(`the host page threw: ${e.message}`));
  await host.goto(BASE, { waitUntil: "domcontentloaded" });
  await host.click("#create");
  await host.waitForFunction(
    () => (document.getElementById("share-url")?.textContent ?? "") !== "",
    undefined,
    { timeout: 30_000 },
  );
  const shareUrl = await host.evaluate(
    () => document.getElementById("share-url")?.textContent ?? "",
  );
  console.log(`  observed: the Worker handed over ${shareUrl.replace(/\/r\/.*/, "/r/…")}`);

  // ⚠⚠ **The Guest has nothing** (`docs/adr/0024`, `docs/adr/0017`).
  //
  // ⚠ **No credentials on this context at all.** ⚠ **If the gate ever moved in front of the room
  //   ⚠ page or the knock, ⚠ this browser would stop at a 401 and the case would fail** —
  //   ⚠ **which is the point.**
  const guestContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  const guest = await guestContext.newPage();
  guest.on("pageerror", (e) => assert.fail(`the guest page threw: ${e.message}`));
  await guest.goto(shareUrl, { waitUntil: "domcontentloaded" });
  await guest.fill("#nickname", "アン");
  await guest.click("#enter-button");

  // ⚠⚠ **The door, ⚠ inside a Durable Object** (`docs/adr/0022`).
  await host.waitForFunction(() => document.getElementById("door")?.hidden === false, undefined, {
    timeout: 30_000,
  });
  console.log(
    `  observed: the door showed "${await host.evaluate(() => document.getElementById("door-who")?.textContent ?? "")}"`,
  );
  await host.click("#admit");

  // ⚠⚠ **Frames, ⚠ not `connectionState`** — ⚠ **a connection that answers and decodes nothing
  //   ⚠ is not a call** (`.claude/skills/verify/SKILL.md` § 3).
  let seen = { host: 0, guest: 0 };
  for (let i = 0; i < 120; i++) {
    seen = { host: await framesOf(host), guest: await framesOf(guest) };
    if (seen.host > 0 && seen.guest > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`  observed: frames decoded host=${seen.host} guest=${seen.guest}`);
  assert.ok(
    seen.host > 0 && seen.guest > 0,
    `no frames through the Worker: ${JSON.stringify(seen)}`,
  );

  // ⚠ And the name crossed the Durable Object and arrived as text.
  const said = await host.evaluate(() => document.getElementById("status")?.textContent ?? "");
  console.log(`  observed: the host was told "${said}"`);
  assert.match(said, /アン/, `the host was not told who came in: ${said}`);

  await hostContext.close();
  await guestContext.close();
});
