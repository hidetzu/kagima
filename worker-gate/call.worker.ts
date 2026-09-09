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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { type Browser, chromium, type Page } from "playwright";
import { issueSession, SESSION_COOKIE } from "../src/auth/session.ts";
import { LIMITS, WORDING } from "../src/quota/ledger.ts";

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
let running = false;
const theWorker = async (): Promise<void> => {
  // ⚠ One Worker for the whole file. ⚠ A second would fight the first for the port, ⚠ and the
  //   ⚠ failure would look like the code rather than like the check.
  if (running) return;
  running = true;
  const child = spawn(
    "node_modules/.bin/wrangler",
    [
      "dev",
      "--local",
      // ⚠⚠ **A state directory of its own, ⚠ made fresh for this run**
      //   (`.claude/rules/verification.md`: ⚠ **a leftover environment measures the previous run**).
      // ⚠ **`wrangler dev --local` keeps Durable Object storage between runs by default** —
      //   ⚠ **so the day's ledger, ⚠ and every room row in it, ⚠ would carry over.**
      // ⚠ **Measured 2026-09-09: ⚠ it did, ⚠ and the cap on how many rooms are open was already
      //   ⚠ half spent before the check began.**
      "--persist-to",
      mkdtempSync(join(tmpdir(), "kagima-worker-gate-")),
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

/** ⚠ **The session the Host would have.** ⚠ **Signed here; ⚠ nothing talks to Google.** */
const asTheHost = async (): Promise<string> =>
  `${SESSION_COOKIE}=${await issueSession("a-host@example.test", SIGNING_SECRET, Date.now())}`;

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

  // ⚠⚠ **Closed before leaving.** ⚠ **A room left open holds a place in the day's budget**
  //   (`docs/adr/0031`), ⚠ **and the next case counts places.**
  await host.click("#close");
  await hostContext.close();
  await guestContext.close();
});

test("⚠⚠ the day's budget stops a new room, and lets go when one ends", async () => {
  // ⚠⚠ **`docs/adr/0031`.** ⚠ **A Durable Object is what makes "read, add, write" atomic** —
  //   ⚠ **so this has to run against a real one.** ⚠ **The arithmetic itself is
  //   ⚠ `test/ledger.test.ts`, ⚠ which needs no object.**
  //
  // ⚠⚠ **What this case can reach: ⚠ the cap on how many rooms are open at once.**
  //   ⚠ **What it cannot: ⚠ the 60 room-minutes and the 20 room-hours** — ⚠ **both need hours of
  //   ⚠ wall-clock, ⚠ and there is no way to seed the ledger that is not a way in.**
  //   ⚠ **Those two are asserted as arithmetic and nowhere else, ⚠ and `docs/SPEC.md` says so.**
  await theWorker();
  const cookie = await asTheHost();

  const make = () => fetch(`${BASE}/api/rooms`, { method: "POST", headers: { cookie } });

  const mine: Array<{ roomId: string; hostKey: string }> = [];
  let refused: Response | null = null;
  // ⚠ The call case above leaves a room open, ⚠ so the number that fits here is not the cap.
  //   ⚠ What is asserted is that a refusal arrives, ⚠ not how many rooms preceded it.
  for (let i = 0; i < LIMITS.openRooms + 2; i++) {
    const answer = await make();
    if (answer.status === 429) {
      refused = answer;
      break;
    }
    assert.equal(answer.status, 201, `making a room answered ${answer.status}`);
    mine.push((await answer.json()) as { roomId: string; hostKey: string });
  }

  assert.ok(refused !== null, "the cap on how many rooms are open never refused anything");
  // ⚠⚠ **Exactly the cap.** ⚠ **The case above closes its room, ⚠ and the state directory is
  //   ⚠ this run's own** — ⚠ **so this number is the cap and not "whatever was left over".**
  assert.equal(
    mine.length,
    LIMITS.openRooms,
    `${mine.length} rooms fitted, and the cap is ${LIMITS.openRooms}`,
  );
  assert.deepEqual(await refused.json(), { refused: "busy" });
  console.log(`  observed: ${mine.length} rooms were made, and then one was refused`);

  // ⚠⚠ **The words a person reads** (`docs/adr/0031`, Owner 決定 2026-09-08).
  //   ⚠ **A 429 on the wire is not the claim; ⚠ what the screen says is.**
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  browsers.push(browser);
  const context = await browser.newContext({
    storageState: {
      cookies: [
        {
          name: SESSION_COOKIE,
          value: cookie.slice(SESSION_COOKIE.length + 1),
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
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.click("#create");
  await page.waitForFunction(
    (want) => document.getElementById("cannot-open")?.textContent === want,
    WORDING.busy,
    { timeout: 30_000 },
  );
  // ⚠ ⚠ そして 部屋は できていない ― ⚠ 文言だけ出して 作っていては 意味がない。
  assert.equal(
    await page.evaluate(() => document.getElementById("share-url")?.textContent ?? ""),
    "",
    "a room was made anyway, and the sentence was shown over it",
  );
  console.log(`  observed: the screen said "${WORDING.busy}"`);

  // ⚠⚠ **And it lets go.** ⚠ **Closing a room has to take its row out of the ledger, ⚠ or the cap
  //   ⚠ would only ever go one way** — ⚠ **which is the report path, ⚠ end to end.**
  const first = mine[0] as { roomId: string; hostKey: string };
  const closed = await fetch(`${BASE}/api/rooms/${first.roomId}`, {
    method: "DELETE",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ hostKey: first.hostKey }),
  });
  assert.equal(closed.status, 200, "the room did not close");

  const again = await make();
  assert.equal(again.status, 201, "a room ending did not give its place back");
  mine.push((await again.json()) as { roomId: string; hostKey: string });
  console.log("  observed: a room ending gave its place back");

  await context.close();
  for (const room of mine) {
    await fetch(`${BASE}/api/rooms/${room.roomId}`, {
      method: "DELETE",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ hostKey: room.hostKey }),
    }).catch(() => {});
  }
});
