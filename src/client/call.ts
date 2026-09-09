// The call, in the browser. ⚠ **This is the only file in kagima that touches media.**
//
// ⚠ **`docs/adr/0001`**: ⚠ **audio and video go browser to browser.**
//   ⚠ **kagima's Application Server never receives a frame, and there is no code path by which
//   ⚠ it could.** ⚠ **`test/no-media-on-the-server.test.ts` asserts that, and breaking it fails.**
//
// ⚠ **This file is type-checked against the DOM, and the server is not** —
//   ⚠ `tsconfig.client.json` vs `tsconfig.json`. ⚠ **The split is structural on purpose:**
//   ⚠ **server code cannot reach for `navigator.mediaDevices` and still type-check.**
//
// ## ⚠ What "connected" is not
//
// ⚠ **`RTCPeerConnection.connectionState === "connected"` with a black frame is exactly the
//   ⚠ failure the final gate exists to catch** (`.claude/skills/verify/SKILL.md` § 3).
// ⚠ **So this exposes what a check needs to read frames**, ⚠ **and never reports success on the
//   ⚠ strength of a state name.**

import { NOTICE_CHANNEL, type Notice, readNotice, writeNotice } from "../call/notice.ts";
import { driveRestart, onIncomingOffer, restartDelaysFor } from "../call/restart.ts";

/**
 * ⚠ **STUN only.** ⚠ **TURN is not here, and adding it is not this file's decision** —
 * ⚠ **it costs money continuously, which makes it the owner's** (`docs/PRODUCT.md` § 6, kagima#16).
 *
 * ⚠ **Someone else's server.** ⚠ **A check that depends on it being up cannot assert our
 * correctness** (`.claude/rules/verification.md`) — ⚠ **so a check records what came back
 * before judging, rather than assuming.**
 */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export type SignalMessage =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
  | { type: "hello"; nickname: string }
  // ⚠ Sent by the server, not by a peer. ⚠ It says the other side's socket went away —
  //   ⚠ which is not the room ending, and the pages keep the two apart.
  | { type: "peer-left" }
  | { type: "bye" };

export type Transport = {
  send(message: SignalMessage): void;
  onMessage(handler: (message: SignalMessage) => void): void;
};

/** ⚠ **What a caller can observe without guessing.** ⚠ Every field is read, never inferred. */
export type CallState = {
  readonly connectionState: RTCPeerConnectionState;
  readonly iceConnectionState: RTCIceConnectionState;
  /** ⚠ **What ICE actually produced**, kept so a report can say it rather than assume it. */
  readonly candidateTypes: readonly string[];
  readonly remoteTrackCount: number;
  /**
   * ⚠ **How many times this side has re-offered with ICE restarted** (kagima#89).
   *
   * ⚠ **Counted after the offer is sent, ⚠ not when one is decided on** — ⚠ **"we tried" and
   * ⚠ "we meant to" are different facts** (`.claude/rules/evidence.md`).
   */
  readonly iceRestarts: number;
};

export type Call = {
  readonly pc: RTCPeerConnection;
  readonly localStream: MediaStream;
  readonly remoteStream: MediaStream;
  /**
   * ⚠⚠ **What the other side is showing us** (`docs/adr/0033`).
   *
   * ⚠ **Kept apart from `remoteStream` on purpose**: ⚠ **the face and the screen are two
   * different things to look at, ⚠ and putting both in one stream would make one replace the
   * other in a single `<video>`.**
   * ⚠ **`docs/PRODUCT.md` § 1: ⚠ 顔を見ながら話し、⚠ 同じ画面を見て。** ⚠ **Both, ⚠ at once.**
   */
  readonly remoteShareStream: MediaStream;
  /**
   * ⚠ **Put a screen into the call.** ⚠ **The picker is the browser's own** — ⚠ **kagima adds no
   * consent screen of its own and never sees what was chosen.**
   *
   * ⚠ **No renegotiation happens here** (`docs/adr/0033`): ⚠ **the m= section was settled when the
   * call was built, ⚠ so this is a `replaceTrack` on a sender that is already negotiated.**
   */
  startSharing(get?: () => Promise<MediaStream>): Promise<void>;
  /**
   * ⚠ **Stops the track, ⚠ not just the display** (`.claude/rules/security.md` § 5),
   * ⚠ **and tells the other side** — ⚠ **nothing in the media path says a share ended.**
   */
  stopSharing(): void;
  sharing(): boolean;
  /**
   * ⚠⚠ **Whether the other side's screen is carrying frames right now** (`docs/adr/0033`).
   *
   * ⚠ **Not "is there a track".** ⚠ **The second m= section is open from the moment the call is
   * built, ⚠ so a track is there the whole time and says nothing.**
   *
   * ⚠ **Starting and stopping are read from two different places, ⚠ and that is not tidiness:**
   * ⚠ **`unmute` — the W3C's own word for media arriving — ⚠ says a share started;**
   * ⚠ **nothing in the media path says one ended** (`src/call/notice.ts`), ⚠ **so the other side
   * has to say so.**
   * ⚠ **Called once with the state as it is now, ⚠ then again on every change.**
   */
  onShared(handler: (showing: boolean) => void): void;
  /**
   * ⚠ **Whether this side is showing its own screen right now.**
   *
   * ⚠ **The browser's own "stop sharing" bar ends a share without the page being asked**, ⚠ **so a
   * button labelled from what the page last did goes stale.** ⚠ **Called once with the state as it
   * is now, ⚠ then again on every change, ⚠ whoever caused it.**
   */
  onSharing(handler: (sharing: boolean) => void): void;
  /** ⚠ **The offerer starts negotiation.** ⚠ Both sides answering, or neither, is a deadlock. */
  start(): Promise<void>;
  state(): CallState;
  /** ⚠ **Stops the tracks, not just the display** (kagima#10 owns the room-level version). */
  hangUp(): void;
};

export type CallOptions = {
  readonly transport: Transport;
  /** ⚠ **Exactly one side offers.** ⚠ Decided by the app, not negotiated here. */
  readonly isOfferer: boolean;
  readonly iceServers?: RTCIceServer[];
  /** ⚠ Injected so a check can run without a camera. ⚠ The default is the real one. */
  readonly getMedia?: () => Promise<MediaStream>;
  /**
   * ⚠⚠ **Whether an offer sent right now would actually leave this page** (kagima#89).
   *
   * ⚠ **The page owns the socket, ⚠ not this file.** ⚠ **Defaulting to "yes" keeps every existing
   * caller behaving exactly as it did** — ⚠ **and a caller that does not pass it gets a recovery
   * that may spend attempts into a closed socket, ⚠ which is why both pages pass it.**
   */
  readonly canSignal?: () => boolean;
  /** ⚠ Injected so a check does not wait out real seconds. */
  readonly wait?: (ms: number) => Promise<void>;
  /** ⚠ **The bound on recovery attempts.** ⚠ Its length is the bound (`src/call/restart.ts`). */
  readonly restartDelaysMs?: readonly number[];
};

/** ⚠ **The only call to `getUserMedia` in kagima.** ⚠ It asks for both, because a call is both. */
export const defaultGetMedia = (): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({ audio: true, video: true });

/**
 * ⚠ **The only call to `getDisplayMedia` in kagima** (`docs/adr/0033`).
 *
 * ⚠ **Audio is not asked for.** ⚠ **A shared screen's sound is not what "同じものを見る" is
 * about, ⚠ and asking for it would take more than the feature needs**
 * (`docs/PRODUCT.md` § 5: ⚠ **the least that works**).
 */
const defaultGetDisplay = (): Promise<MediaStream> =>
  navigator.mediaDevices.getDisplayMedia({ video: true });

/**
 * ⚠ **Why permission failure is separated from everything else.**
 *
 * ⚠ **"could not connect", "the other person has not arrived" and "you did not allow the camera"
 * are three different things**, ⚠ **and telling the user the wrong one either scares them off or
 * hands an attacker a fact** (`CLAUDE.md` § 4-1).
 */
export type MediaFailure = "denied" | "no-device" | "unavailable";

export const classifyMediaError = (error: unknown): MediaFailure => {
  const name = (error as { name?: string } | null)?.name ?? "";
  // ⚠ The browser's own vocabulary, borrowed exactly (`CLAUDE.md` § 4).
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-device";
  return "unavailable";
};

export const createCall = async (options: CallOptions): Promise<Call> => {
  const pc = new RTCPeerConnection({ iceServers: options.iceServers ?? ICE_SERVERS });
  const remoteStream = new MediaStream();
  const candidateTypes: string[] = [];

  // ⚠ Candidates that arrive before the remote description has to be kept, not dropped.
  //   ⚠ Dropping them looked harmless and made the connection fail with tracks present,
  //   ⚠ ICE candidates gathered, and connectionState "failed" — ⚠ found by the browser check,
  //   ⚠ invisible to every unit test, because no unit test has an ICE agent in it.
  const pendingCandidates: RTCIceCandidateInit[] = [];
  const flushCandidates = async (): Promise<void> => {
    while (pendingCandidates.length > 0) {
      const candidate = pendingCandidates.shift();
      if (candidate !== undefined) await pc.addIceCandidate(candidate);
    }
  };

  const localStream = await (options.getMedia ?? defaultGetMedia)();
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

  // ⚠⚠ **Which transceivers carry the face.** ⚠ **Read now, ⚠ before anything else is added** —
  //   ⚠ **so "the screen" can be defined as "the video that is not one of these", ⚠ without
  //   ⚠ depending on an object we happen to hold.**
  const faceTransceivers = new Set(pc.getTransceivers());

  // ⚠⚠ **The second video, ⚠ negotiated before anybody asks for it** (`docs/adr/0033`).
  //
  // ⚠ **Adding it when sharing starts would need a renegotiation right then** — ⚠ **and the side
  //   ⚠ that starts sharing is not always the side that offers** (`public/room.html` decides that
  //   ⚠ once). ⚠ **Making the answerer offer would touch `docs/adr/0026` and `0027` at the same
  //   ⚠ time, ⚠ which is two ADRs for one feature.**
  // ⚠ **So it is negotiated once, with everything else, ⚠ and sits empty until it is used.**
  //
  // ⚠⚠ **Only the offerer creates it, ⚠ and that is not a simplification.**
  //   ⚠ **RFC 8829 § 5.10: ⚠ applying a remote offer associates an m= section only with a
  //   ⚠ transceiver "created by addTrack".** ⚠ **One made by `addTransceiver` is never matched** —
  //   ⚠ **the answerer's own would sit unassociated for ever while the browser made a fresh
  //   ⚠ `recvonly` one beside it, ⚠ and `replaceTrack` onto the orphan would leave the page.**
  //   ⚠ **Measured on 2026-09-09: ⚠ the answerer ended up with mids `0/1//2`.**
  // ⚠ **So the answerer adopts the m= section the offer brings** (see the `offer` case below).
  // ⚠ **The cost is one unused m-line.** ⚠ **`sendrecv`: ⚠ either side may be the one who shows.**
  if (options.isOfferer) pc.addTransceiver("video", { direction: "sendrecv" });

  /** ⚠ **The screen's transceiver: ⚠ the video that is not a face.** ⚠ Absent until negotiated. */
  const shareTransceiver = (): RTCRtpTransceiver | undefined =>
    pc
      .getTransceivers()
      .find((t) => !faceTransceivers.has(t) && t.receiver.track?.kind === "video");

  const remoteShareStream = new MediaStream();
  const shareStream = new MediaStream();

  const sharingHandlers: ((sharing: boolean) => void)[] = [];
  const sharingNow = (): boolean => shareStream.getVideoTracks().length > 0;
  const tellSharing = (): void => {
    const sharing = sharingNow();
    for (const handler of sharingHandlers) handler(sharing);
  };

  const sharedHandlers: ((showing: boolean) => void)[] = [];
  /**
   * ⚠⚠ **What the other side last said about its own screen.** ⚠ `null` until it has said anything.
   *
   * ⚠ **Measured on 2026-09-09, Chromium: ⚠ `replaceTrack(null)` on the sending side does NOT
   * ⚠ mute the receiving track.** ⚠ **The `<video>` froze on the last frame and stayed there for
   * ⚠ the 30 s the check waited.** ⚠ **So "they stopped showing" cannot be read off the media —
   * ⚠ it has to be said.**
   */
  let toldShowing: boolean | null = null;
  const showingShared = (): boolean =>
    (toldShowing ?? true) &&
    remoteShareStream.getVideoTracks().some((t) => !t.muted && t.readyState === "live");
  const tellShared = (): void => {
    const showing = showingShared();
    for (const handler of sharedHandlers) handler(showing);
  };

  // ⚠⚠ **"I am showing my screen now" goes browser to browser, ⚠ never through our server**
  //   (`docs/adr/0033`, `CLAUDE.md` § 3: ⚠ **the control plane carries who may join, ⚠ and never
  //   ⚠ what they say**). ⚠ **Sending it over the signalling socket would hand kagima's own server
  //   ⚠ a new fact about the call it has no business holding.**
  // ⚠ **Only the offerer creates the channel** — ⚠ **the answerer is handed the same one, ⚠ which
  //   ⚠ is the one shape that needs no second negotiation.**
  let notices: RTCDataChannel | null = null;
  const wireNotices = (channel: RTCDataChannel): void => {
    channel.addEventListener("message", (event) => {
      // ⚠ It came from the other browser. ⚠ Anything may arrive; ⚠ nothing here trusts a shape.
      // ⚠ **A later notice may overwrite an earlier one, ⚠ and that is correct here**: ⚠ a default
      //   ⚠ `RTCDataChannel` is ordered and reliable, ⚠ so arrival order is send order.
      const said = readNotice(event.data);
      if (said === null) return;
      toldShowing = said.showing;
      tellShared();
    });
  };
  const say = (notice: Notice): void => {
    if (notices?.readyState !== "open") return;
    notices.send(writeNotice(notice));
  };
  if (options.isOfferer) {
    notices = pc.createDataChannel(NOTICE_CHANNEL);
    wireNotices(notices);
  }
  pc.addEventListener("datachannel", (event) => {
    if (event.channel.label !== NOTICE_CHANNEL) return;
    notices = event.channel;
    wireNotices(notices);
  });

  pc.addEventListener("track", (event) => {
    // ⚠⚠ **Which of the two videos this is, ⚠ decided by the transceiver rather than by order.**
    //   ⚠ **The face's transceivers were read before anything else existed, ⚠ so anything else
    //   ⚠ is the screen** — ⚠ **and that holds whether this side made the m= section or adopted it.**
    if (!faceTransceivers.has(event.transceiver)) {
      remoteShareStream.addTrack(event.track);
      // ⚠ `addtrack` does not fire for a track a script adds — ⚠ the event belongs to the browser
      //   ⚠ adding one. ⚠ So the pages are told here, ⚠ where it actually happened.
      for (const name of ["unmute", "mute", "ended"]) {
        event.track.addEventListener(name, tellShared);
      }
      tellShared();
      return;
    }
    for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
      remoteStream.addTrack(track);
    }
  });

  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate === null) return;
    // ⚠ Recorded before it is used, so a report can say what ICE produced rather than assume it.
    const type = /\btyp (\w+)/.exec(event.candidate.candidate)?.[1];
    if (type !== undefined) candidateTypes.push(type);
    options.transport.send({
      type: "candidate",
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex,
    });
  });

  options.transport.onMessage(async (message) => {
    switch (message.type) {
      case "offer": {
        // ⚠⚠ **Both sides may restart now** (`docs/adr/0027`), ⚠ **so both may offer at once.**
        //   ⚠ **The side that offered first wins, ⚠ and the other undoes its own offer** — ⚠ a
        //   ⚠ fixed rule rather than a negotiated one (`src/call/restart.ts`).
        const glare = onIncomingOffer(options.isOfferer, pc.signalingState as string);
        // ⚠ Ours is in flight and ours wins. ⚠ Theirs will be rolled back on their side.
        if (glare === "ignore-it") return;
        if (glare === "roll-back-first") await pc.setLocalDescription({ type: "rollback" });
        await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
        await flushCandidates();
        // ⚠⚠ **Adopt the screen's m= section, ⚠ and answer it `sendrecv`.**
        //   ⚠ **The browser made it `recvonly`, ⚠ which would let this side watch and never show.**
        //   ⚠ **Saying `sendrecv` now costs no renegotiation — ⚠ the answer has not been made yet.**
        const share = shareTransceiver();
        if (share !== undefined && share.direction !== "sendrecv") share.direction = "sendrecv";
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        options.transport.send({ type: "answer", sdp: answer.sdp ?? "" });
        return;
      }
      case "answer": {
        // ⚠ An answer that arrives when we are not expecting one is late, not current.
        //   ⚠ Applying it would overwrite a negotiation that has moved on
        //   (`.claude/skills/change-review/SKILL.md` § 4).
        if (pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
        await flushCandidates();
        return;
      }
      case "candidate": {
        const candidate: RTCIceCandidateInit = {
          candidate: message.candidate,
          sdpMid: message.sdpMid,
          sdpMLineIndex: message.sdpMLineIndex,
        };
        // ⚠ Early is not wrong. ⚠ A candidate can legitimately arrive before the description it
        //   ⚠ belongs to, and `addIceCandidate` rejects it in that state.
        //   ⚠ Holding it costs nothing; dropping it costs the connection.
        if (pc.remoteDescription === null) {
          pendingCandidates.push(candidate);
          return;
        }
        await pc.addIceCandidate(candidate);
        return;
      }
      case "hello":
      case "peer-left":
      case "bye":
        // ⚠ Not this module's business. ⚠ The page listens for `hello` itself; ⚠ the call carries
        //   ⚠ media and negotiation, and nothing about who anyone is.
        return;
    }
  });

  // ⚠⚠ **Getting the media path back when it fails and the signalling path has not**
  //   (`docs/adr/0026`, kagima#89).
  //
  // ⚠ **Measured on 2026-09-06: ⚠ a real call sat in `failed` for 48.6 seconds while both ends'
  //   ⚠ signalling sockets stayed open and answered every heartbeat.** ⚠ **Everything needed to
  //   ⚠ re-negotiate was on both machines, ⚠ and nothing reached for it.**
  //
  // ⚠ **`failed` rather than `disconnected`**: ⚠ **`disconnected` heals on its own, ⚠ and acting
  //   ⚠ on it would tear down connections that were about to be fine.**
  // ⚠ **Only the offerer restarts**, ⚠ **for the same reason only the offerer starts: ⚠ two
  //   ⚠ offers in flight is glare.** ⚠ **The offerer sees `failed` too — ⚠ it is one connection.**
  //   ⚠ **The case this cannot cover is the offerer's page being gone, ⚠ which is kagima#90.**
  let iceRestarts = 0;
  // ⚠ **One sequence at a time, ⚠ and once spent it is not re-armed until the call is back.**
  //   ⚠ **Without this, ⚠ every `connectionstatechange` would start another sequence.**
  let recovering = false;
  let spent = false;
  const world = {
    connectionState: () => pc.connectionState as string,
    canSignal: options.canSignal ?? (() => true),
    wait: options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    offerAgain: async () => {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      options.transport.send({ type: "offer", sdp: offer.sdp ?? "" });
      // ⚠ After the send. ⚠ Counting before it would count an offer that never left.
      iceRestarts += 1;
    },
  };
  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState !== "failed") return;
    // ⚠⚠ **Not the offerer only** (`docs/adr/0027`, kagima#93). ⚠ **On 2026-09-06 the offerer was
    //   ⚠ a backgrounded phone and the call sat in `failed` for 82.7 seconds while this side was
    //   ⚠ awake.** ⚠ **The answerer simply waits longer, ⚠ so a working offerer still goes first.**
    if (recovering || spent) return;
    recovering = true;
    const delays = options.restartDelaysMs ?? restartDelaysFor(options.isOfferer);
    void driveRestart(world, delays).then((outcome) => {
      // ⚠ `gone` is not a failure to recover — ⚠ somebody hung up. ⚠ Neither re-arms anything.
      if (outcome === "exhausted") spent = true;
      recovering = false;
    });
  });

  return {
    pc,
    localStream,
    remoteStream,
    async start() {
      if (!options.isOfferer) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      options.transport.send({ type: "offer", sdp: offer.sdp ?? "" });
    },
    state() {
      return {
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        candidateTypes: [...candidateTypes],
        remoteTrackCount: remoteStream.getTracks().length,
        iceRestarts,
      };
    },
    remoteShareStream,

    async startSharing(get) {
      const display = await (get ?? defaultGetDisplay)();
      const [video] = display.getVideoTracks();
      if (video === undefined) return;
      // ⚠⚠ **Nothing to put it on yet.** ⚠ **On the answering side the m= section arrives with the
      //   ⚠ offer, ⚠ so there is a short window where the page is up and this is not.**
      //   ⚠ **Half-starting would leave this side believing it is showing while nothing leaves** —
      //   ⚠ **so the track is stopped (⚠ the sharing bar goes out) and nothing changes.**
      //   ⚠ **The button still says 画面を共有する, ⚠ so pressing it again is the whole recovery.**
      if (shareTransceiver() === undefined) {
        video.stop();
        return;
      }
      // ⚠ The browser's own "stop sharing" bar ends the track without telling this page in any
      //   ⚠ other way. ⚠ Listening to it is how the two stay in step.
      video.addEventListener("ended", () => {
        for (const track of shareStream.getTracks()) shareStream.removeTrack(track);
        void shareTransceiver()?.sender.replaceTrack(null);
        say({ showing: false });
        tellSharing();
      });
      shareStream.addTrack(video);
      // ⚠ Negotiated already, ⚠ or not at all. ⚠ Nothing here starts a negotiation.
      await shareTransceiver()?.sender.replaceTrack(video);
      say({ showing: true });
      tellSharing();
    },

    stopSharing() {
      // ⚠ Stopped, ⚠ not merely detached. ⚠ The browser's sharing bar is the only thing the
      //   ⚠ person can see, ⚠ and it must go out (`.claude/rules/security.md` § 5).
      for (const track of shareStream.getTracks()) {
        track.stop();
        shareStream.removeTrack(track);
      }
      void shareTransceiver()?.sender.replaceTrack(null);
      // ⚠⚠ **The other side is told.** ⚠ **Nothing in the media path says a share ended, ⚠ so
      //   ⚠ without this their `<video>` keeps the last frame of a screen that is no longer shared.**
      say({ showing: false });
      tellSharing();
    },

    sharing() {
      return sharingNow();
    },

    onShared(handler) {
      sharedHandlers.push(handler);
      handler(showingShared());
    },

    onSharing(handler) {
      sharingHandlers.push(handler);
      handler(sharingNow());
    },

    hangUp() {
      // ⚠ Stop the tracks, not just the display. ⚠ A hidden video element with a live track is
      //   ⚠ a camera that is still on, and the tally light is all the user can see
      //   (`.claude/rules/security.md` § 5).
      for (const track of localStream.getTracks()) track.stop();
      for (const track of remoteStream.getTracks()) track.stop();
      // ⚠ The shared screen is the same claim. ⚠ The browser's sharing bar must go out too.
      for (const track of shareStream.getTracks()) track.stop();
      for (const track of remoteShareStream.getTracks()) track.stop();
      pc.close();
    },
  };
};
