// Collecting what a call did, for the field test (`docs/FIELD-TEST.md`).
//
// ⚠ **This exists to be pasted into a public issue.** ⚠ **So it must not be able to carry an
//   ⚠ address**, ⚠ **and the way it manages that is by never reading one.**
//
// ⚠ **Candidate lines are never parsed here.** ⚠ **`getStats()` already separates
//   ⚠ `candidateType` and `protocol` from the address, ⚠ so those two fields are read and the
//   ⚠ rest is left alone.** ⚠ **A parser is how an address gets in** (`src/diagnostics/report.ts`).
//
// ⚠ **The formatting, and the closed vocabulary that backs it, live outside the browser side so
//   ⚠ the fast tier can check them** — ⚠ **`test/diagnostics.test.ts` hands them addresses on
//   ⚠ purpose and confirms none come out.**
import type {
  CandidateFact,
  PairFact,
  Snapshot,
  StatLike,
  Transition,
} from "../diagnostics/report.ts";
import {
  HOLD_TARGET_MS,
  firstFrameAt,
  familyOf,
  formatReport,
  selectedPairIdOf,
} from "../diagnostics/report.ts";

export type Diagnostics = {
  noteSocketClosed(code: number): void;
  /** ⚠ Reads the connection as it is now. ⚠ Never stores anything between calls but the notes. */
  snapshot(): Promise<Snapshot>;
  report(): Promise<string>;
};

/**
 * ⚠ **The safe fields, and nothing else.** ⚠ **Never the raw candidate line.**
 *
 * ⚠⚠ **`familyOf` is the only thing here that sees an address, ⚠ and all it returns is `v4`,
 * `v6` or `?`** (`src/diagnostics/report.ts`). ⚠ **The address is not kept, ⚠ not copied, ⚠ and
 * does not reach the fact this builds.** ⚠ **`test/diagnostics.test.ts` asserts that this file
 * mentions an address nowhere else.**
 */
const factOf = (stat: StatLike | undefined): CandidateFact => ({
  type: stat?.candidateType ?? "other",
  protocol: stat?.protocol ?? "other",
  family: familyOf(stat?.address),
});

export const createDiagnostics = (
  pc: RTCPeerConnection,
  now: () => number = () => performance.now(),
): Diagnostics => {
  const startedAt = now();
  const transitions: Transition[] = [];
  let msToFirstFrame: number | null = null;
  let socketClosed: { code: number; at: number } | null = null;

  const note = (what: string, value: string): void => {
    transitions.push({ at: Math.round(now() - startedAt), what, value });
  };

  // ⚠ The state machines, recorded as they move. ⚠ Read later, they only give the last value,
  //   ⚠ and "it ended up failed" hides whether it was ever connected.
  pc.addEventListener("iceconnectionstatechange", () =>
    note("iceConnectionState", pc.iceConnectionState),
  );
  pc.addEventListener("icegatheringstatechange", () =>
    note("iceGatheringState", pc.iceGatheringState),
  );
  pc.addEventListener("connectionstatechange", () => note("connectionState", pc.connectionState));
  pc.addEventListener("signalingstatechange", () => note("signalingState", pc.signalingState));

  return {
    noteSocketClosed(code) {
      if (socketClosed !== null) return;
      socketClosed = { code, at: Math.round(now() - startedAt) };
      note("socket", "closed");
    },

    async snapshot() {
      const byId = new Map<string, StatLike>();
      const stats: StatLike[] = [];
      let framesDecoded = 0;

      for (const entry of await pc.getStats()) {
        const stat = entry[1] as StatLike;
        stats.push(stat);
        if (stat.id !== undefined) byId.set(stat.id, stat);
        if (stat.type === "inbound-rtp" && stat.kind === "video") {
          framesDecoded = Math.max(framesDecoded, stat.framesDecoded ?? 0);
        }
      }
      // ⚠ Which pair is in use is decided in one place, ⚠ against fixtures
      //   (`src/diagnostics/report.ts`). ⚠ Deciding it inline here is how the two ends of one
      //   ⚠ call came to contradict each other.
      const pairId = selectedPairIdOf(stats);
      const pair = pairId === null ? undefined : byId.get(pairId);

      const localCandidates: CandidateFact[] = [];
      const remoteCandidates: CandidateFact[] = [];
      for (const stat of byId.values()) {
        if (stat.type === "local-candidate") localCandidates.push(factOf(stat));
        if (stat.type === "remote-candidate") remoteCandidates.push(factOf(stat));
      }

      const selected: PairFact | null =
        pair === undefined
          ? null
          : {
              local: factOf(byId.get(pair.localCandidateId ?? "")),
              remote: factOf(byId.get(pair.remoteCandidateId ?? "")),
            };

      // ⚠⚠ **The moment a frame was actually decoded, ⚠ observed here and nowhere else.**
      //
      // ⚠ **This used to hang off the `track` event.** ⚠ **`track` fires when the transceiver is
      //   ⚠ created, ⚠ which is in the middle of negotiation** — ⚠ **a first real observation
      //   ⚠ reported a "first frame" that predated `iceConnectionState -> connected`.**
      // ⚠ **A "time to first frame" that can precede the connection is not measuring a frame.**
      // ⚠ **`framesDecoded` is what the verdict already turns on, ⚠ so it is what the clock
      //   ⚠ turns on too.** ⚠ **Resolution is however often this is called** — ⚠ **the panel
      //   ⚠ refreshes fast enough for the question being asked, and no second timer is started.**
      msToFirstFrame = firstFrameAt(msToFirstFrame, framesDecoded, Math.round(now() - startedAt));

      return {
        localCandidates,
        remoteCandidates,
        selected,
        transitions,
        msToFirstFrame,
        heldMs: msToFirstFrame === null ? null : Math.round(now() - startedAt - msToFirstFrame),
        socketClosed,
        framesDecoded,
      };
    },

    async report() {
      return formatReport(await this.snapshot());
    },
  };
};

export { HOLD_TARGET_MS };
