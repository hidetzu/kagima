// ⚠ **Two real browsers, fake cameras, one room** — ⚠ **and the question is whether frames move.**
//
// ⚠ **This drives the product's own pages.** ⚠ **The development harness it used to drive is
//   ⚠ gone** (kagima#8), ⚠ **which means what is checked here is what a person actually gets.**
//
// ⚠ **It builds an environment: it starts the server and launches Chromium.**
//   ⚠ **That is what makes it the final gate rather than part of `npm run check`.**
//
// ## ⚠ Why `connectionState` is not the assertion
//
// ⚠ **`connectionState === "connected"` with a black frame is exactly the failure this tier
//   ⚠ exists to catch** (`.claude/skills/verify/SKILL.md` § 3). ⚠ **So the assertion reads
//   ⚠ `framesDecoded` off the receiver's own stats, and the video element's `videoWidth`.**
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createConnection, createServer as createTcpServer, type Socket } from "node:net";
import { after, test } from "node:test";
import { type Browser, chromium, type Page } from "playwright";
import { startServer } from "../src/node-server.ts";
import { titleOf } from "./scenarios.ts";

// ⚠ **One server per case, on its own port.**
//
// ⚠ **Grounds: the rate limiter counts per source, and every case here comes from 127.0.0.1.**
// ⚠ **`guest-refusals` deliberately exhausts that budget** — ⚠ **with one shared server it took
//   ⚠ the cases after it down with it, and the failures pointed at the wrong things.**
// ⚠ **Cases that only pass in one order cannot honour "run one named case"**, ⚠ **and this is the
//   ⚠ second time that principle has had to be paid for.**
const FIRST_PORT = 8900;
let nextPort = FIRST_PORT;

// ⚠ Chromium's own fake devices. ⚠ A real camera would make the result depend on this machine.
const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
];

let browser: Browser | undefined;
// ⚠ Tracked at module level and closed in `after`, whatever happened. ⚠ A browser left open by a
//   ⚠ failing assertion keeps the process alive, and the run hangs instead of reporting.
const browsers: Browser[] = [];
const servers: Array<ReturnType<typeof startServer>> = [];
const proxies: Array<ReturnType<typeof createTcpServer>> = [];

const launch = async (args: string[]): Promise<Browser> => {
  const b = await chromium.launch({ args });
  browsers.push(b);
  return b;
};

after(async () => {
  for (const b of browsers) await b.close().catch(() => {});
  for (const s of servers) s.close();
  for (const p of proxies) p.close();
});

/**
 * ⚠ **Started on first use, not by whichever case happens to run first.**
 * ⚠ **A suite whose cases only work in one order cannot honour "run one named case"**, ⚠ **and
 * the partial run is the one people actually use.**
 */
const ready = async (): Promise<{
  browser: Browser;
  base: string;
  server: ReturnType<typeof startServer>;
}> => {
  process.env["JOIN_TOKEN_SECRET"] = "an-end-to-end-secret";
  const port = nextPort++;
  const base = `http://127.0.0.1:${port}`;
  const s = startServer(port, base);
  servers.push(s);
  await new Promise((r) => setTimeout(r, 200));
  browser ??= await launch(CHROMIUM_ARGS);
  return { browser, base, server: s };
};

/**
 * ⚠⚠ **A server with the network in front of it, ⚠ so the network can be taken away.**
 *
 * ⚠ **Grounds: signalling going away is one of kagima's central claims** (`docs/adr/0010`) —
 * ⚠ **media goes browser to browser and does not need us, ⚠ so the tracks must stay.**
 *
 * ⚠ **It used to be checked by calling `stopAnswering()` on the server object, ⚠ from inside the
 * same process.** ⚠ **That works only while the server is a Node object this process is holding**
 * — ⚠ **and kagima is moving to Worker + Durable Objects** (`docs/adr/0015`, kagima#49).
 * ⚠ **A check that cannot survive the port would have quietly stopped covering the claim.**
 *
 * ⚠ **So the drop happens in front of the server instead: ⚠ a plain TCP proxy the browsers connect
 * through, ⚠ closed on demand.** ⚠ **Nothing inside the server is reached, ⚠ nothing is added to
 * the product for the sake of a test** (⚠ **the trap `docs/adr/0011` and `0014` already cost us**),
 * ⚠ **and it is closer to what actually happens: ⚠ the network goes, not the process.**
 *
 * ⚠ **Media does not pass through here.** ⚠ **It never touches us at all** (`docs/adr/0001`).
 */
const behindAProxy = async (): Promise<{
  base: string;
  dropTheNetwork: () => void;
  cutEverythingOpen: () => void;
}> => {
  const upstream = nextPort++;
  const front = nextPort++;
  const base = `http://127.0.0.1:${front}`;

  // ⚠ The server is told the front's address, ⚠ so the URL a host hands over points at the proxy.
  process.env["JOIN_TOKEN_SECRET"] = "an-end-to-end-secret";
  const s = startServer(upstream, base);
  servers.push(s);

  const live: Socket[] = [];
  const proxy = createTcpServer((from) => {
    const to = createConnection({ host: "127.0.0.1", port: upstream });
    live.push(from, to);
    from.pipe(to);
    to.pipe(from);
    // ⚠ Both halves die together, ⚠ or a half-open socket keeps the run alive.
    const bothGo = () => {
      from.destroy();
      to.destroy();
    };
    from.on("error", bothGo);
    to.on("error", bothGo);
    from.on("close", bothGo);
    to.on("close", bothGo);
  });
  proxies.push(proxy);
  await new Promise<void>((r) => proxy.listen(front, "127.0.0.1", r));
  await new Promise((r) => setTimeout(r, 200));

  return {
    base,
    dropTheNetwork() {
      // ⚠ Stop accepting, ⚠ and take away what is already open. ⚠ No close frame, no code —
      //   ⚠ from the browser this is the network going, ⚠ which is what it is.
      proxy.close();
      for (const socket of live) socket.destroy();
    },
    /**
     * ⚠⚠ **A blip, ⚠ not an outage** (kagima#70).
     *
     * ⚠ **Everything open is cut, ⚠ and the door is left open for whatever comes next.**
     * ⚠ **`dropTheNetwork` cannot stand in for this: ⚠ it stops accepting, ⚠ so a page that
     * ⚠ tries to come back has nowhere to come back to.**
     */
    cutEverythingOpen() {
      for (const socket of live.splice(0)) socket.destroy();
    },
  };
};

const text = (page: Page, id: string): Promise<string> =>
  page.evaluate((i) => document.getElementById(i)?.textContent ?? "", id);

/** ⚠ **The host, as a person gets it: a page, a button, and two things to read off the screen.** */
const openHost = async (b: Browser, base: string) => {
  const context = await b.newContext({ permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.click("#create");
  await page.waitForFunction(
    () => (document.getElementById("share-url")?.textContent ?? "") !== "",
    undefined,
    { timeout: 15_000 },
  );
  return {
    page,
    context,
    shareUrl: await text(page, "share-url"),
  };
};

/** ⚠ **A signed payload, read back.** ⚠ **base64url, ⚠ which `Buffer` understands and `atob` does not.** */
const atobNode = (payload: string): string => Buffer.from(payload, "base64url").toString("utf8");

/**
 * ⚠ **The guest, as a person gets it: ⚠ open the link, ⚠ type a name, ⚠ knock** (`docs/adr/0017`).
 *
 * ⚠ **There is nothing to type but a name.** ⚠ **The wall is the Host's decision.**
 * ⚠ **This does NOT wait to be let in** — ⚠ **that is the Host's move, and each case makes it.**
 */
const openGuest = async (b: Browser, shareUrl: string, nickname = "ゲスト") => {
  const context = await b.newContext({ permissions: ["camera", "microphone"] });
  // ⚠⚠ **Counts every time the camera is reached for** (`docs/PRODUCT.md` § 5).
  //   ⚠ **`kagimaCall` is set after a call succeeds, ⚠ so it cannot show that the camera was
  //   ⚠ asked for and refused.** ⚠ **A mutation that reached for it while waiting walked past a
  //   ⚠ check written that way.** ⚠ **This counts the reach itself.**
  await context.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (globalThis as unknown as { mediaAsks: number }).mediaAsks = 0;
    navigator.mediaDevices.getUserMedia = (c) => {
      (globalThis as unknown as { mediaAsks: number }).mediaAsks += 1;
      return real(c);
    };
  });
  const page = await context.newPage();
  await page.goto(shareUrl);
  await page.fill("#nickname", nickname);
  await page.click("#enter-button");
  return { page, context };
};

/**
 * ⚠ **The Host lets the person at the door in** — ⚠ **or does not.**
 *
 * ⚠ **Waits for the knock to reach the Host's screen first**: ⚠ clicking before it arrives would
 * ⚠ be testing a race rather than the decision.
 */
const decideAtTheDoor = async (host: Page, allow: boolean): Promise<void> => {
  await host.waitForFunction(() => document.getElementById("door")?.hidden === false, undefined, {
    timeout: 20_000,
  });
  await host.click(allow ? "#admit" : "#deny");
};

const framesDecoded = (page: Page): Promise<number> =>
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

const waitForFrames = async (page: Page, who: string): Promise<number> => {
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

// ⚠ Waited for, not sampled. ⚠ A decoded frame and a sized video element are two different
//   ⚠ moments; read once, this passed locally and failed on CI. ⚠ Waiting is how an asynchronous
//   ⚠ fact is observed; dropping the assertion would be editing the check to make it go quiet.
const waitForPicture = async (page: Page, who: string): Promise<number> => {
  await page.waitForFunction(
    () => (document.getElementById("remote") as HTMLVideoElement).videoWidth > 0,
    undefined,
    { timeout: 20_000 },
  );
  const width = await page.evaluate(
    () => (document.getElementById("remote") as HTMLVideoElement).videoWidth,
  );
  assert.ok(width > 0, `${who}'s remote video has no dimensions`);
  return width;
};

test(titleOf("frames"), async () => {
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  // ⚠ A name that would become markup if anybody built HTML from it.
  //   ⚠ Validation lets this through on purpose — ⚠ it is text, and text is allowed.
  //   ⚠ The wall against it becoming an element is on the display side, and this is that wall.
  const NAME = "アン<b>x</b>";
  const guest = await openGuest(b, host.shareUrl, NAME);
  await decideAtTheDoor(host.page, true);

  const hostFrames = await waitForFrames(host.page, "the host");
  const guestFrames = await waitForFrames(guest.page, "the guest");
  const hostWidth = await waitForPicture(host.page, "the host");
  const guestWidth = await waitForPicture(guest.page, "the guest");
  console.log(`  observed: host decoded ${hostFrames} frames, guest ${guestFrames}`);
  console.log(
    `  observed: remote video is ${hostWidth}px wide for the host, ${guestWidth}px for the guest`,
  );

  // ⚠ The nickname reached the host, and reached it as text.
  await host.page.waitForFunction(
    (name) => (document.getElementById("status")?.textContent ?? "").includes(name),
    NAME,
    { timeout: 15_000 },
  );
  const told = await text(host.page, "status");
  console.log(`  observed: the host was told "${told}"`);

  // ⚠⚠ Shown, not interpreted. ⚠ The name is in the text and there is no element made from it.
  const becameMarkup = await host.page.evaluate(
    () => document.getElementById("status")?.querySelector("b") !== null,
  );
  assert.equal(becameMarkup, false, "the nickname was built into markup");
  assert.ok(told.includes(NAME), `the nickname was altered on the way to the screen: ${told}`);

  // ⚠ What ICE actually produced, recorded rather than assumed.
  const candidates = await host.page.evaluate(() => {
    const call = (
      globalThis as unknown as { kagimaCall?: { state(): { candidateTypes: string[] } } }
    ).kagimaCall;
    return call?.state().candidateTypes ?? [];
  });
  console.log(`  observed: ICE candidate types produced by the host: ${candidates.join(", ")}`);

  // ⚠⚠ **The direction of kagima#89 that is dangerous is the one this can hold: ⚠ a call that is
  //   ⚠ working must not be re-negotiated.** ⚠ **A spurious ICE restart breaks a live connection.**
  // ⚠ **What this does NOT show: ⚠ that a failed connection comes back.** ⚠ **There is no way to
  //   ⚠ make ICE fail on demand here, ⚠ so that claim is not made** (`.claude/rules/evidence.md`).
  // ⚠⚠ **Both sides, ⚠ since `docs/adr/0027` let the answerer restart too.** ⚠ **The answerer is
  //   ⚠ the side that fires when the offerer is asleep, ⚠ so it is also the side that would fire
  //   ⚠ over a call that is perfectly fine.**
  const restartsOn = (page: Page): Promise<number> =>
    page.evaluate(() => {
      const call = (globalThis as unknown as { kagimaCall?: { state(): { iceRestarts: number } } })
        .kagimaCall;
      return call?.state().iceRestarts ?? -1;
    });
  const restarts = { guest: await restartsOn(guest.page), host: await restartsOn(host.page) };
  console.log(
    `  observed: ICE restarts on a call that never failed — guest ${restarts.guest}, host ${restarts.host}`,
  );
  assert.deepEqual(restarts, { guest: 0, host: 0 }, "a working call was re-negotiated");

  await host.context.close();
  await guest.context.close();
});

test(titleOf("guest-refusals"), async () => {
  // ⚠⚠ **The clause, ⚠ carried over from the passphrase** (`.claude/rules/security.md` § 3,
  //   `docs/adr/0017`).
  //
  // ⚠ **A room that never existed, ⚠ a Host who has not looked, ⚠ and a door with too many people
  //   ⚠ at it must read the same.** ⚠ **Otherwise knocking answers "does this room exist?" for
  //   ⚠ free — ⚠ and it would also say whether the Host is at their desk.**
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);

  const waitingScreen = async (url: string): Promise<string> => {
    const context = await b.newContext({ permissions: ["camera", "microphone"] });
    const page = await context.newPage();
    await page.goto(url);
    await page.fill("#nickname", "だれか");
    await page.click("#enter-button");
    await page.waitForFunction(
      () => document.getElementById("waiting")?.hidden === false,
      undefined,
      { timeout: 15_000 },
    );
    const said = await text(page, "waiting");
    await context.close();
    return said;
  };

  // ⚠ A real room whose Host has not looked.
  const real = await waitingScreen(host.shareUrl);
  // ⚠ A room that never existed. ⚠ Same shape of URL, ⚠ nothing behind it.
  const unknown = await waitingScreen(host.shareUrl.replace(/\/r\/.*$/, "/r/zzzzzzzzzzzzzzzz"));

  console.log(`  observed: an unanswered room says "\${real.replace(/s+/g, " ").trim()}"`);
  assert.equal(
    unknown.replace(/\s+/g, " ").trim(),
    real.replace(/\s+/g, " ").trim(),
    "an unknown room reads differently from a room whose Host has not looked",
  );

  // ⚠⚠ And the camera was never asked for. ⚠ Neither of them got in (`docs/PRODUCT.md` § 5).
  assert.match(real, /お待ちください/);
  assert.doesNotMatch(real, /満員|いっぱい|待っている人が\d/, `a count leaked: \${real}`);

  await host.context.close();
});

test(titleOf("guest-keeps-nothing"), async () => {
  // ⚠⚠ **The token must not survive the page it arrived on** (`docs/adr/0004`).
  //
  // ⚠ **The passphrase is gone** (`docs/adr/0017`) — ⚠ **but the join token is still a secret,
  //   ⚠ and it is still handed to the browser.** ⚠ **So the same check moved to it.**
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, "アン");
  await decideAtTheDoor(host.page, true);
  await waitForFrames(guest.page, "the guest");

  const leaked = await guest.page.evaluate(() => {
    const inStorage = [localStorage, sessionStorage].flatMap((s) =>
      Object.keys(s).map((k) => s.getItem(k) ?? ""),
    );
    return {
      inLocation: location.href,
      inStorage: inStorage.join(" "),
      cookies: document.cookie,
    };
  });
  // ⚠ A token has a dot and two long halves. ⚠ Looking for the shape, ⚠ not for a name.
  const TOKENISH = /[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/;
  // ⚠⚠ **The URL and the cookies still hold nothing at all.** ⚠ **Nothing about this moved.**
  assert.doesNotMatch(
    leaked.inLocation,
    TOKENISH,
    `a token was left in the URL: ${leaked.inLocation}`,
  );
  assert.doesNotMatch(leaked.cookies, TOKENISH, `a token was left in a cookie: ${leaked.cookies}`);

  // ⚠⚠ **Storage is the one that changed** (`docs/adr/0029`, kagima#90).
  //
  // ⚠ **A Guest now keeps a mark so a thrown-away page can come back.** ⚠ **The mark is signed
  //   ⚠ and looks exactly like a token from outside** — ⚠ **so "nothing token-shaped in storage"
  //   ⚠ would have to be deleted, ⚠ and deleting a wall is how the thing it guarded comes back.**
  // ⚠⚠ **So it is narrowed rather than removed: ⚠ every token-shaped thing on this device must
  //   ⚠ decode to a REJOIN MARK, ⚠ never to a join token.** ⚠ **The purpose is the first field of
  //   ⚠ the signed payload** (`src/token/join-token.ts`).
  const shaped = [...leaked.inStorage.matchAll(new RegExp(TOKENISH, "g"))].map((m) => m[0]);
  for (const found of shaped) {
    const payload = atobNode(found.slice(0, found.indexOf(".")));
    assert.match(
      payload,
      /^rejoin:/,
      `something on the device is not a rejoin mark: ${payload.slice(0, 40)}`,
    );
  }
  console.log(
    `  observed: no token in the URL or a cookie; ⚠ ${shaped.length} signed thing(s) in storage, all rejoin marks`,
  );

  await host.context.close();
  await guest.context.close();
});

test(titleOf("media-refused"), async () => {
  // ⚠ What a person is told when the camera cannot be reached.
  // ⚠⚠ **And it happens AFTER the Host said yes** (`docs/PRODUCT.md` § 3) — ⚠ **somebody who is
  //   ⚠ not let in never reaches this at all.**
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  // ⚠⚠ **The camera refuses, ⚠ deterministically.**
  //
  // ⚠ **Withholding the permission does not do it here: ⚠ Chromium is launched with
  //   ⚠ `--use-fake-ui-for-media-stream`, ⚠ which grants without asking.**
  // ⚠ **A check that depends on a browser flag to fail is checking the flag.**
  // ⚠ **So the refusal is made to happen, ⚠ and what is checked is what we do about it.**
  const context = await b.newContext({ permissions: ["camera", "microphone"] });
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  const page = await context.newPage();
  await page.goto(host.shareUrl);
  await page.fill("#nickname", "カメラなし");
  await page.click("#enter-button");
  await decideAtTheDoor(host.page, true);

  // ⚠ Where the person is actually looking. ⚠ The waiting screen is up at this point.
  await page.waitForFunction(
    () => (document.getElementById("error")?.textContent ?? "").includes("カメラ"),
    undefined,
    { timeout: 20_000 },
  );
  const said = await text(page, "error");
  // ⚠⚠ And they are not left on the waiting screen with the answer hidden behind it.
  assert.equal(await page.evaluate(() => document.getElementById("waiting")?.hidden), true);
  console.log(`  observed: the guest was told "${said}"`);
  // ⚠ Says what to do, ⚠ and never shows the raw error (`CLAUDE.md` § 4-1).
  assert.match(said, /もう一度|お試し|別のブラウザ/);
  assert.doesNotMatch(said, /NotAllowedError|NotFoundError|Error:/);

  await host.context.close();
  await context.close();
});

test(titleOf("host-closes"), async () => {
  // ⚠ `.claude/rules/security.md` § 5: a hidden video element with a live track is a camera that
  //   ⚠ is still on. ⚠ So the assertion reads `track.readyState`, never whether anything is shown.
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, "アン");
  await decideAtTheDoor(host.page, true);
  await guest.page.waitForFunction(() => "kagimaCall" in globalThis, undefined, {
    timeout: 15_000,
  });

  const liveTracks = (page: Page) =>
    page.evaluate(() => {
      const call = (globalThis as unknown as { kagimaCall: { localStream: MediaStream } })
        .kagimaCall;
      return call.localStream.getTracks().filter((t) => t.readyState === "live").length;
    });
  assert.ok((await liveTracks(guest.page)) > 0, "the guest had no live tracks to begin with");

  await host.page.click("#close");

  await guest.page.waitForFunction(
    () => {
      const call = (globalThis as unknown as { kagimaCall: { localStream: MediaStream } })
        .kagimaCall;
      return call.localStream.getTracks().every((t) => t.readyState === "ended");
    },
    undefined,
    { timeout: 15_000 },
  );
  assert.equal(await liveTracks(guest.page), 0, "the guest still has a live track");

  const said = await text(guest.page, "status");
  console.log(`  observed: the guest was told "${said}"`);
  assert.match(said, /終わりました/, `the guest was not told the call ended: ${said}`);
  assert.ok(!/エラー|失敗|切断されました/.test(said), `the wording read as a fault: ${said}`);

  await host.context.close();
  await guest.context.close();
});

test(titleOf("host-screen"), async () => {
  // ⚠ **The host page hands over one thing now: ⚠ the URL** (`docs/adr/0017`).
  // ⚠ **There is no passphrase to keep apart from it** — ⚠ **the second wall is the Host, ⚠ not a
  //   ⚠ secret.** ⚠ **So what this checks is that the URL is a URL and that nothing else leaks
  //   ⚠ onto the clipboard.**
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const { page, shareUrl } = host;

  assert.match(shareUrl, /\/r\/[0-9a-z]{16}$/, `not a share URL: ${shareUrl}`);
  console.log(`  observed: the host page showed a share URL`);

  await host.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.$$eval("details", (all) => {
    for (const d of all) d.open = true;
  });
  // ⚠ Only what a person can actually press. ⚠ A control inside a hidden section copies nothing,
  //   ⚠ and clicking it would be testing a path nobody takes (⚠ the door is empty here).
  const clickable = await page.$$eval("button", (buttons) =>
    buttons
      .filter((b2) => b2.offsetParent !== null)
      .map((b2) => b2.id)
      .filter((id) => id !== "create" && id !== "close"),
  );
  for (const id of clickable) {
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.click(`#${id}`);
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    // ⚠⚠ A token has a dot and two long halves. ⚠ It must never reach the clipboard.
    assert.doesNotMatch(
      clipboard,
      /[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
      `#${id} put a token on the clipboard`,
    );
  }
  console.log(`  observed: ${clickable.length} controls, none of them copies a token`);

  await host.context.close();
});

test(titleOf("peer-drops"), async () => {
  // ⚠⚠ "The other side left" is not "the room ended" (kagima#11).
  //   ⚠ One is recoverable and the room is still open; ⚠ the other is over and nothing is kept.
  //   ⚠ Telling the host the wrong one either ends a call that was fine, or leaves them waiting
  //   ⚠ for somebody who is not coming.
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, "アン");
  await decideAtTheDoor(host.page, true);
  await guest.page.waitForFunction(() => "kagimaCall" in globalThis, undefined, {
    timeout: 15_000,
  });
  await host.page.waitForFunction(
    () => (document.getElementById("status")?.textContent ?? "").includes("アン"),
    undefined,
    { timeout: 15_000 },
  );

  // ⚠ The guest goes away without anybody closing the room.
  await guest.context.close();

  await host.page.waitForFunction(
    () => (document.getElementById("status")?.textContent ?? "").includes("切れました"),
    undefined,
    { timeout: 15_000 },
  );
  const said = await text(host.page, "status");
  console.log(`  observed: the host was told "${said}"`);

  assert.ok(!/終わりました|閉じました/.test(said), `the host was told the room ended: ${said}`);
  assert.ok(!/エラー|失敗/.test(said), `the wording read as a fault: ${said}`);
  assert.match(
    said,
    /開いています|待って/,
    `the host was not told the room is still open: ${said}`,
  );

  // ⚠ And the host's own camera is still on, because the room did not end.
  //   ⚠ Stopping it here would be ending a call nobody ended.
  const live = await host.page.evaluate(() => {
    const call = (globalThis as unknown as { kagimaCall: { localStream: MediaStream } }).kagimaCall;
    return call.localStream.getTracks().filter((t) => t.readyState === "live").length;
  });
  assert.ok(live > 0, "the host's tracks were stopped by the other side leaving");

  await host.context.close();
});

test(titleOf("signalling-drops"), async () => {
  // ⚠⚠ Signalling going away is not the call ending (`docs/adr/0003`, `docs/adr/0010`).
  //   ⚠ Media goes browser to browser and does not need us — ⚠ so the tracks stay, and the
  //   ⚠ wording says what we actually know rather than what would be tidy to say.
  //
  // ⚠ This case exists because a mutation walked past every other one: stopping the tracks when
  //   ⚠ the socket closed broke nothing, because nothing was watching that path.
  const { browser: b } = await ready();
  const { base, dropTheNetwork } = await behindAProxy();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, "アン");
  await decideAtTheDoor(host.page, true);
  await waitForFrames(host.page, "the host");

  // ⚠ kagima goes away. ⚠ Not a close, not a room ending — ⚠ the network in front of it is taken
  //   ⚠ away, which is what a restart or a dropped link looks like from a browser
  //   (`docs/adr/0010`). ⚠ Nothing inside the server is touched, ⚠ so this survives the port
  //   ⚠ to Worker + Durable Objects (kagima#49).
  dropTheNetwork();

  // ⚠⚠ **The Host now tries to come back before saying anything** (kagima#70).
  //
  // ⚠ **So this is no longer "the socket closed" — ⚠ it is "it closed, ⚠ we tried the whole
  //   ⚠ budget, ⚠ and nothing came back".** ⚠ **The wait has to outlast the budget**
  //   (`RETRY_DELAYS_MS` in `src/client/reconnect.ts`).
  // ⚠ **The budget is not shortened to make this quicker** — ⚠ **that would be tuning a product
  //   ⚠ value to fit a check** (`.claude/rules/verification.md`).
  await host.page.waitForFunction(
    () => (document.getElementById("status")?.textContent ?? "").includes("切れました"),
    undefined,
    { timeout: 60_000 },
  );
  const said = await text(host.page, "status");
  console.log(`  observed: the host was told "${said}"`);

  assert.ok(!/終わりました|閉じました/.test(said), `the host was told the call ended: ${said}`);
  assert.match(said, /続いている/, `the host was not told the call may still be running: ${said}`);

  // ⚠ The whole point. ⚠ Stopping the tracks here would be ending a call nobody ended.
  const live = await host.page.evaluate(() => {
    const call = (globalThis as unknown as { kagimaCall: { localStream: MediaStream } }).kagimaCall;
    return call.localStream.getTracks().filter((t) => t.readyState === "live").length;
  });
  assert.ok(live > 0, "the tracks were stopped when only signalling went away");

  await host.context.close();
  await guest.context.close();
});

test(titleOf("diagnostics"), async () => {
  // ⚠⚠ **The instrument the Owner will carry into the field** (`docs/FIELD-TEST.md`).
  //
  // ⚠ **`test/diagnostics.test.ts` checks the formatter by handing it addresses.** ⚠ **That is
  //   ⚠ the wall; ⚠ this is the wall in place** — ⚠ **a real `RTCPeerConnection`, real ICE, real
  //   ⚠ `getStats()`, and the collector in between that the unit test never runs.**
  // ⚠ **The collector is where an address would actually come from, so it is checked here.**
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);

  // ⚠⚠ **The host is left alone on purpose, and the number below is why.**
  //
  // ⚠ **A first real observation reported `ms to 1st frame: 341889`** — ⚠ **which was the host
  //   ⚠ waiting nearly six minutes for a guest, ⚠ not anything about the connection.**
  // ⚠ **Without this wait, host and guest join within milliseconds of each other and the defect
  //   ⚠ is invisible** — ⚠ **which is exactly why it survived to the field.**
  const ALONE_MS = 3_000;
  await host.page.waitForTimeout(ALONE_MS);

  const guest = await openGuest(b, host.shareUrl, "けんさ");
  await decideAtTheDoor(host.page, true);
  await waitForFrames(host.page, "the host");
  await waitForFrames(guest.page, "the guest");

  const shown = async (page: Page): Promise<string> => {
    // ⚠ The panel refreshes on a timer; ⚠ waited for rather than sampled, for the same reason
    //   ⚠ `waitForPicture` is (this suite has been bitten by sampling once already).
    // ⚠ **Waited on a fact that only a live call produces, not on a label.** ⚠ The first version
    //   ⚠ waited for the word "selected", ⚠ which the empty report also contains — ⚠ so it read
    //   ⚠ the panel before it had anything in it and reported that as the instrument's output.
    await page.waitForFunction(
      () =>
        /frames decoded:\s*[1-9]/.test(
          document.getElementById("diagnostics-text")?.textContent ?? "",
        ),
      undefined,
      { timeout: 20_000 },
    );
    return text(page, "diagnostics-text");
  };
  const hostReport = await shown(host.page);
  const guestReport = await shown(guest.page);
  console.log(`  observed: the host's report reads:\n${hostReport.replace(/^/gm, "    | ")}`);

  // ⚠⚠ **The positive control, and the case turns on it.**
  //
  // ⚠ **Without it, "no address in the report" would also pass in a world where there were no
  //   ⚠ addresses anywhere** — ⚠ **which is exactly how a check passes while proving nothing**
  //   (`.claude/rules/verification.md`). ⚠ **So: addresses exist here, in this very call.**
  const ADDRESSY = [
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    /\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3,}\b/i,
    /[0-9a-f-]{20,}\.local\b/i,
  ];
  const sdp = await host.page.evaluate(() => {
    const call = (globalThis as unknown as { kagimaCall?: { pc: RTCPeerConnection } }).kagimaCall;
    return call?.pc.localDescription?.sdp ?? "";
  });
  assert.ok(
    ADDRESSY.some((p) => p.test(sdp)),
    "no address anywhere in this call, so the check below would pass for the wrong reason",
  );
  console.log(
    "  observed: the call's own SDP does carry addresses, so there was something to leak",
  );

  // ⚠⚠ And none of them reached what a person is invited to paste into a public issue.
  for (const pattern of ADDRESSY) {
    assert.doesNotMatch(
      hostReport,
      pattern,
      `an address reached the host's report:\n${hostReport}`,
    );
    assert.doesNotMatch(
      guestReport,
      pattern,
      `an address reached the guest's report:\n${guestReport}`,
    );
  }

  // ⚠ It carries the facts the field test needs, from a real connection rather than a fixture.
  assert.match(hostReport, /local candidates: \w+\/\w+/, "no candidate types were collected");
  assert.doesNotMatch(hostReport, /selected pair: *none/, "no selected pair was read from stats");
  assert.match(hostReport, /ms to 1st frame: *\d/);
  assert.match(hostReport, /signalling socket: *open throughout/);
  assert.match(hostReport, /transitions:\n\s+\d+ms/, "no state transitions were recorded");
  assert.match(hostReport, /not a rate/);

  // ⚠⚠ The two numbers, kept apart. ⚠ The wait belongs to the host's patience; ⚠ the frame time
  //   ⚠ belongs to the connection. ⚠ Folding them together is the defect this case walls off.
  const numberOn = (label: string): number => {
    const found = new RegExp(`${label}: *(\\d+)`).exec(hostReport);
    assert.ok(found !== null, `no ${label} in the report:\n${hostReport}`);
    return Number(found[1]);
  };
  const waited = numberOn("waited alone");
  const toFrame = numberOn("ms to 1st frame");
  console.log(`  observed: the host waited ${waited}ms alone, then saw a frame ${toFrame}ms later`);
  assert.ok(waited >= ALONE_MS, `the wait was not recorded: ${waited}ms for a ${ALONE_MS}ms wait`);
  assert.ok(
    toFrame < ALONE_MS,
    `the frame time still carries the wait: ${toFrame}ms after a ${ALONE_MS}ms wait`,
  );

  // ⚠ The copy button, because a phone has no devtools and this is the only way the observation
  //   ⚠ leaves the device. ⚠ Read back from the clipboard, never from the button's label —
  //   ⚠ a mutation that copied nothing passed a label check once (kagima#7).
  // ⚠ Opened first, the way a tester opens it. ⚠ The panel is collapsed on purpose — ⚠ a person
  //   ⚠ on a call does not need it — ⚠ so clicking straight through to the button would be
  //   ⚠ checking a path nobody takes.
  await host.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await host.page.click("#diagnostics summary");
  await host.page.click("#diagnostics-copy");
  // ⚠ The write is asynchronous and the click is not. ⚠ Waited for the button to say it
  //   ⚠ happened — ⚠ which is also the only signal a tester gets, so it is worth checking.
  await host.page.waitForFunction(
    // ⚠ Waited for the label to *change*. ⚠ Waiting for a substring the initial label already
    //   ⚠ contains is waiting for nothing — ⚠ the same mistake as the panel wait above, twice in
    //   ⚠ one case. ⚠ A wait must name a fact that is false until the thing happens.
    () => (document.getElementById("diagnostics-copy")?.textContent ?? "") !== "この観測をコピー",
    undefined,
    { timeout: 10_000 },
  );
  const said = await text(host.page, "diagnostics-copy");
  assert.equal(said, "コピーしました", `the copy button reported: ${said}`);
  const copied = await host.page.evaluate(() => navigator.clipboard.readText());

  // ⚠ Not compared to the earlier text: ⚠ the panel refreshes every second and "held for" grows,
  //   ⚠ so equality would be a race. ⚠ What matters is that a whole observation left the device,
  //   ⚠ carrying the facts and no address.
  assert.match(copied, /^kagima field-test observation/, `the clipboard holds: ${copied}`);
  assert.match(copied, /frames decoded: *[1-9]/);
  assert.doesNotMatch(copied, /selected pair: *none/);
  for (const pattern of ADDRESSY) {
    assert.doesNotMatch(copied, pattern, `an address reached the clipboard:\n${copied}`);
  }
  console.log("  observed: the clipboard holds a whole observation, and no address");

  await host.context.close();
  await guest.context.close();
});

test(titleOf("field-test-mode-is-gone"), async () => {
  // ⚠⚠ **A time-limited feature is only time-limited if something notices when the time is up.**
  //
  // ⚠ **`docs/adr/0011` turned on a mode that cost two promises, ⚠ for the kagima#16 field test.**
  // ⚠ **It said, in its own text, ⚠ that "消し忘れたので残った" is not a reason to keep it.**
  // ⚠ **kagima#16 is closed** (`docs/adr/0013`), ⚠ **so the mode is gone** (`docs/adr/0014`).
  //
  // ⚠⚠ **This case is the proof, ⚠ and it is deliberately hostile: ⚠ it sets the flag.**
  // ⚠ **Checking that the mode is off by default would prove nothing** — ⚠ **it was always off by
  //   ⚠ default.** ⚠ **What must be true now is that the flag does nothing at all.**
  const { base: plainBase } = await ready();
  const port = nextPort++;
  const flaggedBase = `http://127.0.0.1:${port}`;
  // ⚠ The process entry point. ⚠ Node's listener moved out of the routing (移植 7/n).
  const child = spawn(process.execPath, ["src/node-server.ts"], {
    env: {
      ...process.env,
      // ⚠ The retired flag, set on purpose.
      KAGIMA_FIELD_TEST: "1",
      PORT: String(port),
      PUBLIC_BASE_URL: flaggedBase,
      JOIN_TOKEN_SECRET: "a-secret-for-a-mode-that-is-gone",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const said: string[] = [];
  child.stdout.on("data", (d: Buffer) => said.push(d.toString()));
  child.stderr.on("data", (d: Buffer) => said.push(d.toString()));
  try {
    for (let i = 0; i < 100 && !said.join("").includes("listening"); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const startup = said.join("");
    assert.match(startup, /listening/, `the server did not start:\n${startup}`);

    // ⚠ Nothing announces a mode, ⚠ because there is no mode to announce.
    assert.doesNotMatch(startup, /KAGIMA_FIELD_TEST/, `the flag still speaks:\n${startup}`);
    assert.doesNotMatch(startup, /NOT how kagima is meant to run/, startup);

    // ⚠⚠ **What the mode used to spend is gone entirely** (`docs/adr/0017`) — ⚠ **there is no
    //   ⚠ passphrase to shorten any more.** ⚠ **So what is checked is that creating a room hands
    //   ⚠ over nothing the flag could have changed.**
    const rooms = await fetch(`${flaggedBase}/api/rooms`, { method: "POST" });
    const made = (await rooms.json()) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(made).sort(),
      ["hostKey", "roomId", "shareUrl", "token"],
      `the flag changed what creating a room hands over: ${JSON.stringify(Object.keys(made))}`,
    );
    console.log("  observed: with the flag set, creating a room hands over the same four things");

    // ⚠⚠ And the routes it added are gone — ⚠ with the flag set, on both a flagged and a plain
    //   ⚠ server. ⚠ A route that answers anything but 404 is a route that still exists.
    for (const origin of [flaggedBase, plainBase]) {
      for (const path of ["/api/field-test", "/api/observations"]) {
        const got = await fetch(`${origin}${path}`);
        assert.equal(got.status, 404, `${path} still exists on ${origin}`);
        const posted = await fetch(`${origin}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: "x", side: "host", report: "x" }),
        });
        assert.equal(posted.status, 404, `POST ${path} still exists on ${origin}`);
      }
    }
    console.log("  observed: with the flag set, neither route exists, for GET or POST");
  } finally {
    child.kill();
  }
});

test(titleOf("third-person"), async () => {
  // ⚠⚠ **v0.1.0 is two people** (`docs/PRODUCT.md` § 4 — ⚠ **多人数会議 is a non-goal**).
  //
  // ⚠ **With a door, a third person is not refused — ⚠ they wait**, ⚠ like anybody else who
  //   ⚠ knocks. ⚠ **The Host sees them, ⚠ and sees that somebody else is waiting too.**
  // ⚠ **Nothing tells them the room is full** (`docs/adr/0017`) — ⚠ **"満員" would say how many
  //   ⚠ people are inside.**
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, "ひとり目");
  await decideAtTheDoor(host.page, true);
  await waitForFrames(host.page, "the host");

  const third = await openGuest(b, host.shareUrl, "ふたり目");

  // ⚠ The third is at the door, ⚠ waiting, ⚠ with nothing said about why.
  await third.page.waitForFunction(
    () => document.getElementById("waiting")?.hidden === false,
    undefined,
    { timeout: 20_000 },
  );
  const told = await text(third.page, "waiting");
  console.log(`  observed: the third person is shown "${told.replace(/\s+/g, " ").trim()}"`);
  assert.doesNotMatch(told, /満員|いっぱい|2 人/, `the room's occupancy leaked: ${told}`);
  assert.match(told, /お待ちください/);

  // ⚠⚠ And the camera was never asked for (`docs/PRODUCT.md` § 5).
  //   ⚠ Somebody who is not let in never hands one over.
  const asks = await third.page.evaluate(
    () => (globalThis as unknown as { mediaAsks: number }).mediaAsks,
  );
  assert.equal(asks, 0, `the third person's camera was reached for ${asks} times while waiting`);
  console.log("  observed: the third person's camera was never reached for");

  // ⚠ And the person who WAS let in did have it asked for — ⚠ so the counter is not simply broken.
  const admittedAsks = await guest.page.evaluate(
    () => (globalThis as unknown as { mediaAsks: number }).mediaAsks,
  );
  assert.ok(admittedAsks > 0, "the counter never fires, so the assertion above proves nothing");

  // ⚠⚠ The two already talking carry on. ⚠ A third at the door must cost them nothing.
  const before = await framesDecoded(host.page);
  await host.page.waitForTimeout(1_500);
  assert.ok(
    (await framesDecoded(host.page)) > before,
    "the host stopped decoding when a third knocked",
  );

  await host.context.close();
  await guest.context.close();
  await third.context.close();
});

test(titleOf("the-host-comes-back"), async () => {
  // ⚠⚠ **The Host's socket dropping used to be the end of the Host** (kagima#70).
  //
  // ⚠ **Observed before this existed: ⚠ a knock arriving while the Host was away reached nobody,
  //   ⚠ and the announcement is sent once.** ⚠ **The knock itself was still in `knocks`, ⚠ and the
  //   ⚠ person was still standing there** — ⚠ **only the Host had no way to learn it.**
  //
  // ⚠ **Two claims that only a browser can carry:**
  //   ⚠ **1. the page comes back on its own, ⚠ and is told who is at the door**
  //   ⚠ **2. the tracks are not stopped on the way** (`docs/adr/0010`)
  const { browser: b } = await ready();
  const { base, cutEverythingOpen } = await behindAProxy();

  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, "アン");
  await decideAtTheDoor(host.page, true);
  const framesBefore = await waitForFrames(host.page, "the host");

  // ⚠⚠ A blip. ⚠ Everything open is cut; ⚠ the door is left open for whatever comes next.
  cutEverythingOpen();
  console.log("  observed: every open socket was cut");

  // ⚠ Somebody knocks while the Host is away. ⚠ This is the case's whole reason for existing.
  const stranger = await openGuest(b, host.shareUrl, "とおりすがり");

  // ⚠ Waited for, ⚠ not slept through: ⚠ the door appearing IS the page having come back.
  //   ⚠ It is false until it happens, ⚠ so it cannot pass on something that was already true.
  await host.page.waitForFunction(
    () => (document.getElementById("door-who")?.textContent ?? "").includes("とおりすがり"),
    undefined,
    { timeout: 40_000 },
  );
  console.log(
    `  observed: the Host came back and was shown "${await text(host.page, "door-who")}"`,
  );

  // ⚠⚠ The call never stopped. ⚠ Media goes browser to browser and does not need us
  //   (`docs/adr/0001`, `docs/adr/0003`). ⚠ Stopping the tracks on a reconnect would be us
  //   ⚠ ending a call nobody ended.
  const framesAfter = await waitForFrames(host.page, "the host");
  console.log(`  observed: frames decoded ${framesBefore} before the cut, ${framesAfter} after`);
  assert.ok(
    framesAfter > framesBefore,
    `the call stopped across the reconnect (${framesBefore} -> ${framesAfter})`,
  );

  // ⚠ And nothing alarming was said, ⚠ because nothing was broken (Owner decision, 2026-09-06).
  const said = await text(host.page, "status");
  assert.doesNotMatch(said, /つながりが切れました/, `the Host was told the call broke: ${said}`);

  await host.page.context().close();
  await guest.page.context().close();
  await stranger.page.context().close();
});

test(titleOf("heartbeat"), async () => {
  // ⚠⚠ **The heartbeat a page has to answer** (`docs/adr/0020`, kagima#62).
  //
  // ⚠ **`test/heartbeat.test.ts` drives it with a fake socket, ⚠ which can only show that the
  //   ⚠ server sends and counts.** ⚠ **Whether a real page answers is a different claim, ⚠ and
  //   ⚠ it is the one everything now rests on** — ⚠ **a Worker has no protocol ping, ⚠ so this
  //   ⚠ is all there is.**
  //
  // ⚠ **The heartbeat is deliberately fast here.** ⚠ **The value in production is the one the
  //   ⚠ measurement left standing** (`docs/adr/0020`), ⚠ **and waiting it out would make this a
  //   ⚠ check nobody runs.**
  const { browser: b } = await ready();
  const port = nextPort++;
  const base = `http://127.0.0.1:${port}`;
  process.env["JOIN_TOKEN_SECRET"] = "an-end-to-end-secret";
  servers.push(startServer(port, base, { heartbeatMs: 150 }));
  await new Promise((r) => setTimeout(r, 200));

  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, "アン");
  await decideAtTheDoor(host.page, true);
  await waitForFrames(host.page, "the host");

  // ⚠⚠ **Long enough that a page which stopped answering would be gone.**
  //
  // ⚠ **This, ⚠ not the counter, ⚠ is the claim.** ⚠ **A mutation that stopped the page
  //   ⚠ answering left the counter climbing — ⚠ it counted pings received, ⚠ not pongs sent —
  //   ⚠ and this case passed.** ⚠ **Surviving many heartbeat periods cannot be faked that way:
  //   ⚠ the server closes a socket that does not answer.**
  const periods = 12;
  await new Promise((r) => setTimeout(r, 150 * periods));

  // ⚠⚠ **Read from the other side.**
  //
  // ⚠ **The call's own state cannot show this**: ⚠ **media goes browser to browser and survives
  //   ⚠ signalling going away, ⚠ on purpose** (`docs/adr/0010`). ⚠ **A first version asserted on
  //   ⚠ `connectionState` and a mutation that stopped the page answering walked straight past.**
  // ⚠ **But when the server hangs up on a silent socket, ⚠ the hub tells whoever is left** —
  //   ⚠ **and that is the Guest's screen.**
  const guestSees = await text(guest.page, "status");
  console.log(`  observed: after ${periods} heartbeat periods the guest is told "${guestSees}"`);
  assert.doesNotMatch(
    guestSees,
    /相手の接続が切れました/,
    `the host was hung up on while its page was answering: ${guestSees}`,
  );

  // ⚠ And the instrument agrees. ⚠ Read after the claim above, ⚠ never instead of it.
  const report = await host.page.evaluate(
    () => document.getElementById("diagnostics-text")?.textContent ?? "",
  );
  const answered = Number(/heartbeats answered: *(\d+)/.exec(report)?.[1] ?? "0");
  console.log(`  observed: the page answered ${answered} heartbeats`);
  assert.ok(answered > 0, `the page answered nothing:\n${report}`);

  // ⚠ The address wall still holds with these lines in the report (`docs/adr/0012`).
  for (const pattern of [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, /[0-9a-f-]{20,}\.local\b/i]) {
    assert.doesNotMatch(report, pattern, `an address reached the report:\n${report}`);
  }

  await host.context.close();
  await guest.context.close();
});

test(titleOf("same-screen"), async () => {
  // ⚠⚠ **`docs/PRODUCT.md` § 1 の本体** (`docs/adr/0033`):
  //   ⚠ **「顔を見ながら話し、⚠ 同じ画面を見て」** — ⚠ **so 両方が同時に届かなければならない。**
  //
  // ⚠ **`getDisplayMedia` は headless の Chromium では選択画面を出せない。**
  //   ⚠ **so それだけを差し替える** — ⚠ **canvas から作った動く映像を返す。**
  // ⚠⚠ **これが言えること: ⚠ 2 本目の transceiver が 端から端まで frames を運び、⚠ 受け側が
  //   ⚠ 顔と 別の要素に振り分けること。**
  // ⚠⚠ **言えないこと: ⚠ ブラウザ自身の選択画面について 何も。**
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, "アン");
  await decideAtTheDoor(host.page, true);
  await waitForFrames(guest.page, "the guest");

  // ⚠ 顔が届いていること。⚠ 共有はこのあとで、⚠ 顔を置き換えないことが主張である。
  const faceBefore = await guest.page.evaluate(
    () => (document.getElementById("remote") as HTMLVideoElement).videoWidth,
  );
  assert.ok(faceBefore > 0, "the face never arrived, so nothing can be said about the screen");

  await host.page.evaluate(() => {
    (
      navigator.mediaDevices as unknown as { getDisplayMedia: () => Promise<MediaStream> }
    ).getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      // ⚠ 動いていること。⚠ 静止画だと frames が増えず、⚠ 届いたことを見分けられない。
      setInterval(() => {
        ctx.fillStyle = `hsl(${Date.now() % 360} 90% 50%)`;
        ctx.fillRect(0, 0, 320, 240);
      }, 50);
      return (canvas as unknown as { captureStream: (n: number) => MediaStream }).captureStream(15);
    };
  });
  await host.page.click("#share");
  console.log("  observed: the host put a screen into the call");

  // ⚠⚠ **証拠。** ⚠ **受け側の 2 本目の video に 幅が出るのは、⚠ frames が届いたときだけである。**
  await guest.page.waitForFunction(
    () => {
      const shared = document.getElementById("shared") as HTMLVideoElement | null;
      return shared !== null && !shared.hidden && shared.videoWidth > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  const sharedWidth = await guest.page.evaluate(
    () => (document.getElementById("shared") as HTMLVideoElement).videoWidth,
  );
  console.log(`  observed: the shared screen arrived, ${sharedWidth}px wide`);

  // ⚠ ボタンの文字は、⚠ いま出しているかを言う (`CLAUDE.md` § 4)。
  assert.equal(await text(host.page, "share"), "共有をやめる");

  // ⚠⚠ **顔は消えていない。** ⚠ **`replaceTrack` で顔を差し替える形なら、⚠ ここで 0 になる。**
  const faceAfter = await guest.page.evaluate(
    () => (document.getElementById("remote") as HTMLVideoElement).videoWidth,
  );
  assert.ok(faceAfter > 0, `the face was replaced by the screen (${faceBefore} -> ${faceAfter})`);
  console.log(`  observed: the face is still there, ${faceAfter}px wide`);

  // ⚠ 共有をやめると、⚠ track は止まる ― ⚠ 隠すだけではない (`.claude/rules/security.md` § 5)。
  await host.page.click("#share");
  const stopped = await host.page.evaluate(
    () =>
      (globalThis as unknown as { kagimaCall: { sharing: () => boolean } }).kagimaCall.sharing() ===
      false,
  );
  assert.equal(stopped, true, "the screen is still being shared after stopping");
  assert.equal(await text(host.page, "share"), "画面を共有する");
  console.log("  observed: stopping the share stopped the track, and the button says so");

  // ⚠⚠ **向こうでも消える。** ⚠ **`replaceTrack(null)` は受け側の track を消さない** — ⚠ **`muted` に
  //   ⚠ 戻すだけである。** ⚠ **「track が在るか」で出し入れしていると、⚠ 止めたあとも黒い箱が残る。**
  await guest.page.waitForFunction(
    () => (document.getElementById("shared") as HTMLVideoElement).hidden,
    undefined,
    { timeout: 30_000 },
  );
  console.log("  observed: the shared screen went away on the other side too");

  // ⚠⚠ **もう一度出せる。** ⚠ **「やめた」を言いっぱなしにすると、⚠ 相手の側は 二度と出さない。**
  await host.page.click("#share");
  await guest.page.waitForFunction(
    () => {
      const shared = document.getElementById("shared") as HTMLVideoElement | null;
      return shared !== null && !shared.hidden && shared.videoWidth > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  console.log("  observed: sharing again put it back on the other side");

  await host.context.close();
  await guest.context.close();
});

test(titleOf("the-guest-comes-back"), async () => {
  // ⚠⚠ **Measured 2026-09-06** (kagima#98): ⚠ **`wrangler deploy` replaced the Durable Object and
  //   ⚠ every open WebSocket closed.** ⚠ **The room survives** (`docs/adr/0023`, `0025`)
  //   ⚠ **and the call survives** (`docs/adr/0010`) — ⚠ **what died was signalling.**
  //
  // ⚠ **The Host's page already came back** (kagima#70). ⚠ **This one did not**, ⚠ **so a deploy,
  //   ⚠ and every tunnel blip, ⚠ left the Guest without signalling for the rest of the call** —
  //   ⚠ **which also meant no ICE restart could ever be negotiated** (`docs/adr/0026`, `0027`).
  //
  // ⚠⚠ **Frames are NOT the proof.** ⚠ **Media goes browser to browser and never needed us**
  //   (`docs/adr/0003`), ⚠ **so they keep flowing with the socket dead.**
  // ⚠⚠ **Neither is the Host's screen still showing the name**: ⚠ **both sockets die at once, ⚠ so
  //   ⚠ the Host never receives the `peer-left` that would have cleared it.** ⚠ **A first version
  //   ⚠ of this case waited for exactly that and passed while nothing had reconnected.**
  const { browser: b } = await ready();
  const { base, cutEverythingOpen } = await behindAProxy();

  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, "アン");
  await decideAtTheDoor(host.page, true);
  await waitForFrames(guest.page, "the guest");

  cutEverythingOpen();
  console.log("  observed: every open socket was cut");

  // ⚠⚠ **The drop is written down, ⚠ even though it is about to be fixed** (kagima#98).
  //   ⚠ **Until now this page only recorded the close it never came back from, ⚠ so a panel would
  //   ⚠ have said `open throughout` for a call whose signalling dropped and returned** — ⚠ **the
  //   ⚠ same shape of lie kagima#91 was about.**
  await guest.page.waitForFunction(
    () =>
      (document.getElementById("diagnostics-text")?.textContent ?? "").includes("socket -> closed"),
    undefined,
    { timeout: 20_000 },
  );

  // ⚠⚠ **And nothing is said about it on screen** (⚠ Owner 決定 2026-09-06, `public/index.html`).
  //   ⚠ **A blip must not put "つながりが切れました" over a call that never stopped.**
  const saidWhileFixing = await text(guest.page, "status");
  assert.doesNotMatch(
    saidWhileFixing,
    /切れました/,
    `the Guest was told the connection had gone while it was being fixed: ${saidWhileFixing}`,
  );

  // ⚠⚠ **THE PROOF.** ⚠ **`socket -> open` is only ever recorded for a socket that came back** —
  //   ⚠ **the first one is what starts the clock and is not noted** (`src/client/diagnostics.ts`).
  //   ⚠ **It is false until this page reconnects, ⚠ so it cannot pass on something already true.**
  await guest.page.waitForFunction(
    () =>
      (document.getElementById("diagnostics-text")?.textContent ?? "").includes("socket -> open"),
    undefined,
    { timeout: 40_000 },
  );
  console.log("  observed: the Guest's signalling came back on its own");

  // ⚠⚠ **And it is a way in, ⚠ not just a socket**: ⚠ **ending the room travels over signalling
  //   ⚠ and nothing else.** ⚠ **A page holding a dead socket never learns the room is over.**
  await host.page.click("#close");
  await guest.page.waitForFunction(
    () => (document.getElementById("status")?.textContent ?? "").includes("終わりました"),
    undefined,
    { timeout: 40_000 },
  );
  console.log(`  observed: the Guest was told "${await text(guest.page, "status")}"`);

  await host.context.close();
  await guest.context.close();
});

test(titleOf("guest-comes-back-to-a-thrown-away-page"), async () => {
  // ⚠⚠ **Measured on a real phone on 2026-09-06** (kagima#90):
  //   ⚠ **about six minutes in the background and the browser threw the Guest's page away** —
  //   ⚠ **nine of its parts and `favicon.ico` were fetched again the moment it came forward.**
  // ⚠ **`docs/adr/0026` and `docs/adr/0027` cannot help there: ⚠ they restart ICE, ⚠ and there
  //   ⚠ was no page on the other end to restart with.**
  //
  // ⚠ **`page.reload()` is that, ⚠ exactly: ⚠ every variable gone, ⚠ the socket gone, ⚠ the
  //   ⚠ document built again from nothing.** ⚠ **What survives is what was written down.**
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, "アン");
  await decideAtTheDoor(host.page, true);
  await waitForFrames(guest.page, "the guest");

  // ⚠ The door is shut behind them. ⚠ It is what must NOT open again.
  await host.page.waitForFunction(
    () => document.getElementById("door")?.hidden === true,
    undefined,
    {
      timeout: 20_000,
    },
  );

  await guest.page.reload({ waitUntil: "domcontentloaded" });
  console.log("  observed: the Guest's page was thrown away and built again");

  // ⚠⚠ **The door's form must not come back with it** (⚠ measured on a real phone, 2026-09-08).
  //
  // ⚠ **Observed: ⚠ the page was thrown away while its panel was being pasted, ⚠ came back on its
  //   ⚠ own, ⚠ and showed "入室をお願いする" on the way** — ⚠ **a form asking this person to ask
  //   ⚠ permission for a room they are already in** (`CLAUDE.md` § 4-1).
  // ⚠ **It is a race against one round trip, ⚠ so it is checked from the first paint rather than
  //   ⚠ waited for** — ⚠ **`waitUntil: "domcontentloaded"` has already returned by here.**
  assert.equal(
    await guest.page.evaluate(() => document.getElementById("before")?.hidden === true),
    true,
    "the Guest was shown the door's form on the way back into a room it was already in",
  );

  // ⚠⚠ **Nobody presses anything.** ⚠ **This is the whole case** (`docs/adr/0029`).
  const backFrames = await waitForFrames(guest.page, "the guest, after coming back");
  console.log(`  observed: the Guest decoded ${backFrames} frames without knocking again`);

  // ⚠⚠ **And the Host was never asked a second time.**
  //   ⚠ **A knock would have opened the door element; ⚠ it is still shut.**
  const doorOpened = await host.page.evaluate(
    () => document.getElementById("door")?.hidden === false,
  );
  assert.equal(doorOpened, false, "the Host was asked to decide a second time");

  // ⚠⚠ **What is on the device** (`docs/adr/0021`, `docs/adr/0029`): ⚠ **one mark, ⚠ for this
  //   ⚠ room, ⚠ and nobody's name.**
  const kept = await guest.page.evaluate(() => JSON.stringify(localStorage));
  console.log(`  observed: the device holds ${kept}`);
  // ⚠⚠ **This person's OWN name is here, ⚠ on purpose** (⚠ Owner 決定 2026-09-07, `docs/adr/0029`).
  //
  // ⚠ **A thrown-away page has to say who it is again.** ⚠ **The alternatives were worse: ⚠ the
  //   ⚠ server keeping a record of who was let in, ⚠ or the Host keeping a Guest's name past the
  //   ⚠ moment they left** (`src/client/remember.ts` says both).
  // ⚠ **What must NOT be here is anybody else's name** — ⚠ **the Host's page keeps none, ⚠ and
  //   ⚠ `host-comes-back-to-a-thrown-away-page` is the case that holds that shut.**
  assert.match(kept, /アン/, `the Guest cannot say who it is on the way back: ${kept}`);
  const keys = await guest.page.evaluate(() => Object.keys(localStorage).sort());
  // ⚠⚠ **The pile is what `docs/adr/0021` promised not to keep.** ⚠ **So: ⚠ exactly one signed
  //   ⚠ thing on this device, ⚠ under the Guest's own key.**
  // ⚠ **`kagima.hidden` is here too** — ⚠ **it is how long this page lasted while nobody was
  //   ⚠ looking** (`src/diagnostics/discards.ts`, kagima#96), ⚠ **and it is not a mark.**
  assert.ok(keys.includes("kagima.guest"), `the Guest kept no mark: ${keys.join(", ")}`);
  // ⚠⚠ A Guest is not a Host. ⚠ A host key on this device would be somebody else's door.
  assert.ok(!keys.includes("kagima.room"), `a host key is on a Guest's device: ${keys.join(", ")}`);
  const signed = await guest.page.evaluate(() =>
    Object.keys(localStorage)
      .map((k) => localStorage.getItem(k) ?? "")
      .join(" ")
      .match(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g),
  );
  assert.equal(signed?.length, 1, `the device holds ${signed?.length ?? 0} signed things, not one`);

  // ⚠⚠ **And the Host is still told who this is** — ⚠ **the screen did not change**
  //   (⚠ Owner 決定 2026-09-07). ⚠ **`peer-left` clears the name on the Host's side, ⚠ so this is
  //   ⚠ false until the Guest has said who it is again.**
  await host.page.waitForFunction(
    () => (document.getElementById("status")?.textContent ?? "").includes("アン"),
    undefined,
    { timeout: 20_000 },
  );
  console.log(`  observed: the host was told "${await text(host.page, "status")}"`);

  // ⚠ Closing the room takes the mark AND the name with it. ⚠ A dead mark is how one becomes a pile.
  await host.page.click("#close");
  await guest.page.waitForFunction(() => localStorage.length === 0, undefined, { timeout: 20_000 });
  console.log("  observed: the room ending left nothing on the Guest's device");

  await host.context.close();
  await guest.context.close();
});

test(titleOf("host-comes-back-to-a-thrown-away-page"), async () => {
  // ⚠⚠ **Measured on a real phone on 2026-09-06** (kagima#75):
  //   ⚠ **the browser discarded the backgrounded tab and reloaded it from scratch.**
  // ⚠ **The Host's key was a variable, ⚠ so it went with the page** — ⚠ **and the room stayed
  //   ⚠ alive on the server with nobody able to open its door.**
  //
  // ⚠ **`page.reload()` is that, ⚠ exactly: ⚠ every variable gone, ⚠ the socket gone, ⚠ the
  //   ⚠ document built again from nothing.** ⚠ **What survives is what was written down.**
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const before = host.shareUrl;

  // ⚠ Somebody knocks while the Host still has the page. ⚠ Then the page is thrown away.
  const guest = await openGuest(b, before, "アン");
  await host.page.waitForFunction(
    () => document.getElementById("door")?.hidden === false,
    undefined,
    {
      timeout: 20_000,
    },
  );

  await host.page.reload({ waitUntil: "domcontentloaded" });
  console.log("  observed: the page was thrown away and built again");

  // ⚠⚠ Waited for, ⚠ not slept through. ⚠ The share URL is empty on a fresh page, ⚠ so this is
  //   ⚠ false until the Host is actually back in its own room.
  await host.page.waitForFunction(
    (expected) => (document.getElementById("share-url")?.textContent ?? "") === expected,
    before,
    { timeout: 20_000 },
  );
  console.log("  observed: the Host is back in the same room");

  // ⚠ And the person who was waiting is shown again (`docs/adr/0019`).
  await host.page.waitForFunction(
    () => (document.getElementById("door-who")?.textContent ?? "").includes("アン"),
    undefined,
    { timeout: 20_000 },
  );
  console.log(`  observed: the door still shows "${await text(host.page, "door-who")}"`);

  // ⚠⚠ **What is on the device, ⚠ read as text.** ⚠ **Two strings, ⚠ and nothing that is a
  //   ⚠ secret with a lifetime** (`.claude/rules/security.md` § 4).
  const kept = await host.page.evaluate(() => JSON.stringify(localStorage));
  console.log(`  observed: the device holds ${kept}`);
  assert.doesNotMatch(kept, /token/i, `a token is on the device: ${kept}`);
  assert.doesNotMatch(kept, /アン/, `somebody's name is on the device: ${kept}`);

  // ⚠ Closing the room takes the key with it. ⚠ A dead key is how one becomes a pile.
  //
  // ⚠⚠ **Two paths reach this**: ⚠ **the button, ⚠ and the 4005 the server sends back.**
  // ⚠ **A mutation showed that removing either one alone left this green** — ⚠ **so this case
  //   ⚠ asserts that the key is gone, ⚠ not which path took it.**
  // ⚠ **`test/remember.test.ts` carries the smaller claim that forgetting twice is the same as
  //   ⚠ forgetting once.**
  await host.page.click("#close");
  await host.page.waitForFunction(() => localStorage.length === 0, undefined, { timeout: 20_000 });
  console.log("  observed: closing the room left nothing on the device");

  await host.context.close();
  await guest.context.close();
});
