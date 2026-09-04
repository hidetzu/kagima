// ⚠ **The tier that gets skipped** (`.claude/rules/verification.md`).
//
// ⚠ **The other end here is something we did not write.** ⚠ **Twice over: two browser engines,
//   ⚠ neither of them ours, disagreeing with each other in ways neither is wrong about.**
//
// ⚠ **Everything else kagima checks runs in Chromium.** ⚠ **A green run there is evidence about
//   ⚠ Chromium, and `npm run e2e` says so.** ⚠ **This is the one that says anything else.**
//
// ## ⚠ What a failure here means, and what it does not
//
// ⚠ **It is still a `FAIL`.** ⚠ **It is NOT automatically evidence that our code broke**
//   (`.claude/rules/verification.md`: ⚠ **split the failure before blaming yourself**).
// ⚠ **So this records what each side actually did before saying anything about why.**
//
// ## ⚠ What this cannot show
//
// ⚠ **Two engines on one machine, over loopback, with fake cameras.**
// ⚠ **It says nothing about a real network, a real camera, or a NAT** (kagima#16).
// ⚠ **It says nothing about a third engine.** ⚠ **WebKit has never been run here.**
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { type Browser, type Page, chromium, firefox } from "playwright";
import { startServer } from "../src/server.ts";
import { titleOf } from "./scenarios.ts";

const PORT = 8960;
const BASE = `http://127.0.0.1:${PORT}`;

// ⚠ Chromium takes flags; ⚠ Firefox takes preferences. ⚠ They are not the same mechanism, and
//   ⚠ assuming one works on the other is how this tier quietly becomes a Chromium test twice.
const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
];
const FIREFOX_PREFS = {
  "media.navigator.streams.fake": true,
  "media.navigator.permission.disabled": true,
};

const browsers: Browser[] = [];
let server: ReturnType<typeof startServer> | undefined;

after(async () => {
  for (const b of browsers) await b.close().catch(() => {});
  server?.close();
});

const ready = async () => {
  if (server === undefined) {
    process.env["JOIN_TOKEN_SECRET"] = "an-external-tier-secret";
    server = startServer(PORT, BASE);
    await new Promise((r) => setTimeout(r, 200));
  }
  const chrome = await chromium.launch({ args: CHROMIUM_ARGS });
  const fox = await firefox.launch({ firefoxUserPrefs: FIREFOX_PREFS });
  browsers.push(chrome, fox);
  return { chrome, fox };
};

const text = (page: Page, id: string): Promise<string> =>
  page.evaluate((i) => document.getElementById(i)?.textContent ?? "", id);

/** ⚠ **What the page can tell us about its own call.** ⚠ Read, never assumed. */
const callState = (page: Page) =>
  page.evaluate(async () => {
    const call = (
      globalThis as unknown as {
        kagimaCall?: { pc: RTCPeerConnection; state(): unknown };
      }
    ).kagimaCall;
    if (call === undefined) return { present: false as const };
    let framesDecoded = 0;
    let bytesReceived = 0;
    for (const report of await call.pc.getStats()) {
      const stat = report[1] as {
        type?: string;
        kind?: string;
        framesDecoded?: number;
        bytesReceived?: number;
      };
      if (stat.type === "inbound-rtp" && stat.kind === "video") {
        framesDecoded = Math.max(framesDecoded, stat.framesDecoded ?? 0);
        bytesReceived = Math.max(bytesReceived, stat.bytesReceived ?? 0);
      }
    }
    return { present: true as const, framesDecoded, bytesReceived, reported: call.state() };
  });

test(titleOf("chromium-to-firefox"), async () => {
  const { chrome, fox } = await ready();

  // ⚠⚠ The tier's whole reason for existing, asserted before anything else.
  //
  // ⚠ A mutation swapped firefox for a second chromium and this case passed — ⚠ it printed
  //   ⚠ "firefox 151.0.7922.34" and nobody was watching. ⚠ The external tier would have become
  //   ⚠ the final gate run twice, ⚠ and a check that agrees only with itself has proved nothing
  //   (`.claude/rules/verification.md`).
  // ⚠ So the engines are read from the browsers themselves, not from the variable names.
  const hostEngine = chrome.browserType().name();
  const guestEngine = fox.browserType().name();
  assert.notEqual(
    hostEngine,
    guestEngine,
    "both ends are the same engine — this is not the external tier",
  );
  assert.equal(hostEngine, "chromium");
  assert.equal(guestEngine, "firefox");

  // ⚠ Said before anything is judged, so the report names what was actually run
  //   (`.claude/rules/evidence.md`: ⚠ a measurement records when, where and how).
  console.log(`  observed: ${hostEngine} ${chrome.version()} as the host`);
  console.log(`  observed: ${guestEngine} ${fox.version()} as the guest`);
  console.log(
    `  observed: run at ${new Date().toISOString()}, both on this machine, over loopback`,
  );

  const hostContext = await chrome.newContext({ permissions: ["camera", "microphone"] });
  const host = await hostContext.newPage();
  await host.goto(`${BASE}/`);
  await host.click("#create");
  await host.waitForFunction(
    () => (document.getElementById("share-url")?.textContent ?? "") !== "",
    undefined,
    { timeout: 20_000 },
  );
  const shareUrl = await text(host, "share-url");
  const passphrase = await text(host, "passphrase");

  // ⚠ Firefox grants by preference, not by Playwright permission — see FIREFOX_PREFS.
  const guestContext = await fox.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(shareUrl);
  await guest.fill("#passphrase", passphrase);
  await guest.fill("#nickname", "きつね");
  await guest.click("#enter-button");

  // ⚠ Waited for on both sides, then read. ⚠ Never asserted from one side about the other.
  const waitForFrames = async (page: Page, who: string) => {
    for (let i = 0; i < 150; i++) {
      const state = await callState(page);
      if (state.present && state.framesDecoded > 0) return state;
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ...(await callState(page)), who };
  };

  const hostState = await waitForFrames(host, "chromium (host)");
  const guestState = await waitForFrames(guest, "firefox (guest)");

  console.log(`  observed: chromium decoded ${hostState.framesDecoded ?? "-"} frames`);
  console.log(`  observed: firefox decoded ${guestState.framesDecoded ?? "-"} frames`);

  // ⚠ Which side did not do what, said plainly, before any conclusion about why.
  //   ⚠ "It failed" is not a report; ⚠ "chromium decoded 0 while firefox decoded 41" is.
  const sides = [
    { who: "chromium (host)", state: hostState },
    { who: "firefox (guest)", state: guestState },
  ];
  const silent = sides.filter((s) => (s.state.framesDecoded ?? 0) === 0);
  if (silent.length > 0) {
    const detail = sides.map((s) => `${s.who}: ${JSON.stringify(s.state)}`).join("\n      ");
    assert.fail(
      `no frames on ${silent.map((s) => s.who).join(" and ")}.\n` +
        `      ⚠ this is a FAIL, ⚠ and it is not by itself evidence that our code broke.\n` +
        `      ⚠ what each side reported:\n      ${detail}`,
    );
  }

  // ⚠ Both ends, because "it worked" in one direction is a different claim.
  //   ⚠ The `silent` check above already failed on a zero; ⚠ these two say the claim out loud
  //   ⚠ rather than leaving it implied by an earlier branch.
  assert.ok((hostState.framesDecoded ?? 0) > 0, "chromium decoded nothing");
  assert.ok((guestState.framesDecoded ?? 0) > 0, "firefox decoded nothing");

  // ⚠ What ICE produced, recorded rather than assumed. ⚠ Never asserted — ⚠ what the other side
  //   ⚠ offers is not ours to require (`.claude/rules/verification.md`).
  const candidateTypes = await host.evaluate(() => {
    const call = (
      globalThis as unknown as { kagimaCall?: { state(): { candidateTypes: string[] } } }
    ).kagimaCall;
    return call?.state().candidateTypes ?? [];
  });
  console.log(
    `  observed: ICE candidate types the host produced: ${candidateTypes.join(", ") || "none"}`,
  );

  // ⚠ The name crossed engines and arrived as text, not as markup.
  await host.waitForFunction(
    () => (document.getElementById("status")?.textContent ?? "").includes("きつね"),
    undefined,
    { timeout: 20_000 },
  );
  console.log(`  observed: chromium was told "${await text(host, "status")}"`);

  await hostContext.close();
  await guestContext.close();
});
