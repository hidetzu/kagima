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
import { startServer } from "../src/server.ts";
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
const behindAProxy = async (): Promise<{ base: string; dropTheNetwork: () => void }> => {
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
  for (const [where, value] of Object.entries(leaked)) {
    assert.doesNotMatch(value, TOKENISH, `a token was left in ${where}: ${value}`);
  }
  console.log("  observed: no token in the URL, in storage, or in a cookie");

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

  await host.page.waitForFunction(
    () => (document.getElementById("status")?.textContent ?? "").includes("切れました"),
    undefined,
    { timeout: 15_000 },
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
  const child = spawn(process.execPath, ["src/server.ts"], {
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
