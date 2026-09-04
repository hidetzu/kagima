// Measure what ICE actually produces from wherever this is run.
//
// ⚠ **This is decision material for kagima#16, and it is NOT the decision.**
//   ⚠ **Whether to allow a TURN relay is the owner's** (`docs/PRODUCT.md` § 6).
//
// ## ⚠ What this measures, and what it does not
//
// ```text
// measures       whether a STUN server answers from this network, and how often
// measures       what candidate types the browser produces here
// ⚠ does NOT     what fraction of guests cannot reach a host peer to peer
// ```
//
// ⚠ **The second one is the question kagima#16 actually turns on, and it cannot be measured
//   ⚠ from one machine.** ⚠ **Two peers on one host share a network; ⚠ there is no NAT between
//   ⚠ them to fail to traverse.**
// ⚠ **Running this and calling the result "the reach rate" would be exactly the mistake the
//   ⚠ issue warns about** — ⚠ **a number from another scope is a lie about this one**
//   (`.claude/rules/evidence.md`).
//
// ⚠ **What it IS good for: a server-reflexive candidate is a precondition for connecting across
//   ⚠ a NAT at all.** ⚠ **If STUN does not answer here, P2P across a NAT cannot work from here,
//   ⚠ and that is worth knowing before anybody argues about relays.**
//
// ## Usage
//
//   node measure/ice.ts                # the default number of rounds
//   node measure/ice.ts --rounds=20
//
// ⚠ **It changes nothing.** ⚠ **It starts a server, opens a page, and reads.**
import { chromium } from "playwright";
import { ICE_SERVERS } from "../src/client/call.ts";
import { startServer } from "../src/server.ts";

const PORT = 8970;
const BASE = `http://127.0.0.1:${PORT}`;

const arg = (name: string, fallback: number): number => {
  const raw = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  const value = raw === undefined ? Number.NaN : Number(raw.slice(name.length + 3));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

const ROUNDS = arg("rounds", 10);
/** ⚠ **How long one gathering attempt is given.** ⚠ Longer than any answer worth waiting for. */
const GATHER_MS = 8_000;

type Round = {
  readonly types: readonly string[];
  readonly gotSrflx: boolean;
  readonly msToSrflx: number | null;
  readonly completed: boolean;
};

const main = async (): Promise<void> => {
  process.env["JOIN_TOKEN_SECRET"] = "a-measurement-secret";
  const server = startServer(PORT, BASE);
  await new Promise((r) => setTimeout(r, 200));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await (await browser.newContext()).newPage();
  // ⚠ A real page, because `about:blank` is not a secure context and the APIs are absent there.
  await page.goto(`${BASE}/`);

  const gather = (iceServers: RTCIceServer[], timeoutMs: number): Promise<Round> =>
    page.evaluate(
      async ([servers, budget]) => {
        const pc = new RTCPeerConnection({ iceServers: servers as RTCIceServer[] });
        // ⚠ A data channel, not media. ⚠ Nothing here needs a camera, and asking for one would
        //   ⚠ make the measurement depend on a permission prompt.
        pc.createDataChannel("probe");
        const started = performance.now();
        const types: string[] = [];
        let msToSrflx: number | null = null;

        const done = new Promise<boolean>((resolve) => {
          const finish = (completed: boolean) => resolve(completed);
          pc.addEventListener("icegatheringstatechange", () => {
            if (pc.iceGatheringState === "complete") finish(true);
          });
          setTimeout(() => finish(false), budget as number);
        });

        pc.addEventListener("icecandidate", (event) => {
          if (event.candidate === null) return;
          const type = /\btyp (\w+)/.exec(event.candidate.candidate)?.[1];
          if (type === undefined) return;
          types.push(type);
          if (type === "srflx" && msToSrflx === null) msToSrflx = performance.now() - started;
        });

        await pc.setLocalDescription(await pc.createOffer());
        const completed = await done;
        pc.close();
        return { types, gotSrflx: types.includes("srflx"), msToSrflx, completed };
      },
      [iceServers, timeoutMs] as const,
    );

  // ⚠ Read from the product's own configuration, not typed again here — ⚠ measuring a different
  //   ⚠ STUN server than the one kagima uses would answer a question nobody asked.
  // ⚠ Imported here rather than fetched inside the page: ⚠ the page's URL for it is a browser
  //   ⚠ path that `tsc` cannot resolve, ⚠ and a cast to silence that would be a second copy of
  //   ⚠ the same decision wearing a type.
  const iceServers = ICE_SERVERS;

  console.log(`measure-ice: ${ROUNDS} rounds, ${GATHER_MS}ms each`);
  console.log(`  ⚠ this measures STUN reachability from wherever this ran.`);
  console.log(`  ⚠ it does NOT measure how many guests fail to connect peer to peer.`);
  console.log(`  ice servers under test: ${JSON.stringify(iceServers)}`);
  console.log(`  when: ${new Date().toISOString()}`);
  console.log("");

  // ⚠ The control first. ⚠ Without it, "we got host candidates" says nothing about whether the
  //   ⚠ STUN server was reached — ⚠ host candidates appear with no STUN server at all.
  const control = await gather([], 2_000);
  console.log(`  control (no ice servers): ${control.types.join(", ") || "none"}`);
  console.log("");

  const rounds: Round[] = [];
  for (let i = 0; i < ROUNDS; i++) rounds.push(await gather(iceServers, GATHER_MS));

  const withSrflx = rounds.filter((r) => r.gotSrflx);
  const completed = rounds.filter((r) => r.completed);
  const times = withSrflx
    .map((r) => r.msToSrflx ?? 0)
    .sort((a, b) => a - b)
    .map((t) => Math.round(t));

  console.log(`  rounds run:                       ${rounds.length}`);
  console.log(`  rounds that got a srflx candidate: ${withSrflx.length}`);
  console.log(`  rounds where gathering completed:  ${completed.length}`);
  if (times.length > 0) {
    // ⚠ Values that were actually observed. ⚠ Never interpolated (`.claude/rules/evidence.md`).
    console.log(
      `  ms to first srflx (observed):      min ${times[0]} / max ${times[times.length - 1]}`,
    );
  } else {
    console.log(`  ms to first srflx:                 ⚠ none observed`);
  }
  const seen = new Map<string, number>();
  for (const r of rounds) for (const t of r.types) seen.set(t, (seen.get(t) ?? 0) + 1);
  console.log(
    `  candidate types seen:             ${[...seen].map(([t, n]) => `${t}×${n}`).join(", ")}`,
  );
  console.log("");
  console.log(`How to read this`);
  console.log(`  ! a srflx candidate is a PRECONDITION for crossing a NAT, not proof of it.`);
  console.log(`  ! this ran from one network. ! another network can differ completely.`);
  console.log(`  ! the number kagima#16 turns on is not here, and cannot be taken from here.`);

  await browser.close();
  server.close();
};

await main();
