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
import { after, test } from "node:test";
import { type Browser, type Page, chromium } from "playwright";
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

const launch = async (args: string[]): Promise<Browser> => {
  const b = await chromium.launch({ args });
  browsers.push(b);
  return b;
};

after(async () => {
  for (const b of browsers) await b.close().catch(() => {});
  for (const s of servers) s.close();
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
    passphrase: await text(page, "passphrase"),
  };
};

/** ⚠ **The guest, the same way: open the link, type the passphrase, type a name, press the button.** */
const openGuest = async (b: Browser, shareUrl: string, passphrase: string, nickname = "ゲスト") => {
  const context = await b.newContext({ permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  await page.goto(shareUrl);
  await page.fill("#passphrase", passphrase);
  await page.fill("#nickname", nickname);
  await page.click("#enter-button");
  return { page, context };
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
  const guest = await openGuest(b, host.shareUrl, host.passphrase, NAME);

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
  // ⚠⚠ The clause. ⚠ A wrong passphrase, a room that never existed, and a room being hammered
  //   ⚠ must read the same. ⚠ The server already answers all three identically; ⚠ this checks
  //   ⚠ that the page does not undo that by explaining the difference in words.
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);

  const said = async (url: string, passphrase: string): Promise<string> => {
    const context = await b.newContext();
    const page = await context.newPage();
    await page.goto(url);
    await page.fill("#passphrase", passphrase);
    await page.fill("#nickname", "だれか");
    await page.click("#enter-button");
    await page.waitForFunction(
      () => (document.getElementById("error")?.textContent ?? "") !== "",
      undefined,
      { timeout: 15_000 },
    );
    const message = await text(page, "error");
    await context.close();
    return message;
  };

  const wrongPassphrase = await said(host.shareUrl, "wrong-wrong-wrong-wrong");
  const unknownRoom = await said(`${base}/r/${"z".repeat(16)}`, "wrong-wrong-wrong-wrong");
  console.log(`  observed: a refused guest was told "${wrongPassphrase}"`);
  assert.equal(
    unknownRoom,
    wrongPassphrase,
    "an unknown room reads differently from a wrong passphrase",
  );

  // ⚠ Past the source limit now — the next attempt is refused by the limiter, not the passphrase.
  //   ⚠ It must still read the same, or the limit firing says "this room exists" out loud.
  for (let i = 0; i < 6; i++) await said(host.shareUrl, "wrong-wrong-wrong-wrong");
  const rateLimited = await said(host.shareUrl, host.passphrase);
  assert.equal(rateLimited, wrongPassphrase, "a rate-limited guest reads differently");

  // ⚠ And none of them opens with what does not work (`CLAUDE.md` § 4-1).
  assert.ok(!/^(できません|失敗|エラー)/.test(wrongPassphrase), wrongPassphrase);
  assert.match(wrongPassphrase, /合言葉/, "the wording does not say what to check");

  await host.context.close();
});

test(titleOf("guest-keeps-nothing"), async () => {
  // ⚠ The passphrase must not survive the page it was typed into: not in the URL, not in
  //   ⚠ history, not in storage, not in a cookie (`.claude/rules/security.md` § 2).
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, host.passphrase, "アン");
  await guest.page.waitForFunction(() => "kagimaCall" in globalThis, undefined, {
    timeout: 15_000,
  });

  const leaked = await guest.page.evaluate((phrase) => {
    const inStorage = [localStorage, sessionStorage].some((s) =>
      Object.keys(s).some((k) => (s.getItem(k) ?? "").includes(phrase)),
    );
    return {
      inLocation: location.href.includes(phrase),
      inStorage,
      inCookies: document.cookie.includes(phrase),
      // ⚠ The field is cleared too — a wrong passphrase sitting in a box is one on the screen.
      stillInTheField: (document.getElementById("passphrase") as HTMLInputElement).value === phrase,
    };
  }, host.passphrase);
  console.log(`  observed: where the passphrase ended up: ${JSON.stringify(leaked)}`);
  assert.deepEqual(leaked, {
    inLocation: false,
    inStorage: false,
    inCookies: false,
    stillInTheField: false,
  });

  await host.context.close();
  await guest.context.close();
});

test(titleOf("media-refused"), async () => {
  const { browser: b, base } = await ready();
  // ⚠ A second browser, launched WITHOUT `--use-fake-ui-for-media-stream`.
  //   ⚠ That flag auto-grants at the browser level, so a context's permissions cannot override it.
  const denying = await launch(["--no-sandbox", "--use-fake-device-for-media-stream"]);
  const host = await openHost(b, base);

  const context = await denying.newContext({ permissions: [] });
  const page = await context.newPage();
  await page.goto(host.shareUrl);
  await page.fill("#passphrase", host.passphrase);
  await page.fill("#nickname", "だれか");
  await page.click("#enter-button");
  await page.waitForFunction(
    () => (document.getElementById("error")?.textContent ?? "") !== "",
    undefined,
    { timeout: 15_000 },
  );

  const said = await text(page, "error");
  console.log(`  observed: the page said "${said}"`);
  // ⚠ This environment produces NotSupportedError rather than NotAllowedError, so the `denied`
  //   ⚠ branch specifically is NOT verified here — ⚠ what IS verified is the contract every
  //   ⚠ branch has to meet. ⚠ Saying which is which is the point.
  assert.ok(
    !/Not supported|TypeError|undefined/.test(said),
    `the raw error reached the user: ${said}`,
  );
  assert.match(said, /カメラ|マイク/, `the wording did not name what to do: ${said}`);

  await context.close();
  await host.context.close();
});

test(titleOf("host-closes"), async () => {
  // ⚠ `.claude/rules/security.md` § 5: a hidden video element with a live track is a camera that
  //   ⚠ is still on. ⚠ So the assertion reads `track.readyState`, never whether anything is shown.
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, host.passphrase, "アン");
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
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const { page, shareUrl, passphrase } = host;

  console.log(
    `  observed: the host page showed a URL and a passphrase (${passphrase.split("-").length} words)`,
  );
  assert.match(shareUrl, /\/r\/[0-9a-z]{16}$/, `not a share URL: ${shareUrl}`);
  assert.ok(!shareUrl.includes(passphrase), "the passphrase is inside the share URL");

  // ⚠ Nothing that copies both. ⚠ Read off the clipboard, not off the labels — ⚠ a mutation that
  //   ⚠ added a working "copy both" button walked straight past the label version of this.
  await host.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const clickable = await page.$$eval("button", (buttons) =>
    buttons.map((b2) => b2.id).filter((id) => id !== "create" && id !== "close"),
  );
  assert.ok(clickable.length > 0, "no copy controls to check");
  for (const id of clickable) {
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.click(`#${id}`);
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(
      clipboard.includes(passphrase) && clipboard.includes("/r/"),
      false,
      `#${id} put both the URL and the passphrase on the clipboard: ${clipboard}`,
    );
  }
  console.log(`  observed: ${clickable.length} copy controls, none of them copies both`);

  const leaked = await page.evaluate((phrase) => {
    const inStorage = [localStorage, sessionStorage].some((s) =>
      Object.keys(s).some((k) => (s.getItem(k) ?? "").includes(phrase)),
    );
    return {
      inLocation: location.href.includes(phrase),
      inStorage,
      cookies: document.cookie.includes(phrase),
    };
  }, passphrase);
  assert.deepEqual(leaked, { inLocation: false, inStorage: false, cookies: false });

  const said = await text(page, "status");
  console.log(`  observed: while waiting, the host page said "${said}"`);
  // ⚠ `ませんでした` catches the page's own failure wording, which an earlier version of this
  //   ⚠ assertion let through: ⚠ the host had failed to open the room and this case still passed.
  //   ⚠ A check that accepts an error message as "waiting" is not checking the waiting state.
  assert.ok(
    !/ませんでした|できません|失敗|エラー|切断/.test(said),
    `the waiting state read as a fault: ${said}`,
  );
  assert.match(
    said,
    /待って|つながり|入りました/,
    `the waiting state did not say what is happening: ${said}`,
  );

  await host.context.close();
});

test(titleOf("peer-drops"), async () => {
  // ⚠⚠ "The other side left" is not "the room ended" (kagima#11).
  //   ⚠ One is recoverable and the room is still open; ⚠ the other is over and nothing is kept.
  //   ⚠ Telling the host the wrong one either ends a call that was fine, or leaves them waiting
  //   ⚠ for somebody who is not coming.
  const { browser: b, base } = await ready();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, host.passphrase, "アン");
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
  const { browser: b, base, server: s } = await ready();
  const host = await openHost(b, base);
  const guest = await openGuest(b, host.shareUrl, host.passphrase, "アン");
  await waitForFrames(host.page, "the host");

  // ⚠ kagima goes away. ⚠ Not a close, not a room ending — ⚠ the process simply stops answering,
  //   ⚠ which is what a restart looks like from a browser (`docs/adr/0010`).
  s.stopAnswering();

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
