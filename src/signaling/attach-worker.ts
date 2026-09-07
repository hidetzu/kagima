// ⚠⚠ **The Cloudflare adapter.** ⚠ **Everything here exists because a Worker has `WebSocketPair`
//   ⚠ and not `ws`.**
//
// ```text
// authorize.ts     ⚠ whether a handshake becomes a way in     ⚠ platform-free
// session.ts       ⚠ what one connected participant does      ⚠ platform-free
// socket.ts        ⚠ the shape both platforms reduce to       ⚠ platform-free
// attach.ts        ⚠ ws + node:http
// attach-worker.ts ⚠ WebSocketPair + a 101 Response           ← ⚠ this file
// ```
//
// ⚠ **Nothing here decides anything** (`CLAUDE.md` § 3). ⚠ **The two adapters answer the same
//   ⚠ question in two runtimes; ⚠ neither answers a question the core already answers.**
import { authorizeUpgrade } from "./authorize.ts";
import { TOKEN_PROTOCOL_PREFIX } from "./protocol.ts";
import type { Sessions } from "./session.ts";
import type { SignalingSocket } from "./socket.ts";

/**
 * ⚠ **What this adapter uses of a Worker's WebSocket, ⚠ named in our own words.**
 *
 * ⚠ **Four things.** ⚠ **`ping` is not among them** — ⚠ **a Worker's server-side socket has none,
 * ⚠ and the heartbeat stopped needing one** (`docs/adr/0020`).
 */
export type WorkerSocket = {
  accept(): void;
  send(line: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, handler: (event: never) => void): void;
};

/** ⚠ **What a Worker's `WebSocketPair` is, ⚠ as far as this file is concerned.** */
export type WorkerSocketPair = { 0: unknown; 1: WorkerSocket };

/**
 * ⚠ **The runtime's own pair, ⚠ named here rather than imported.**
 *
 * ⚠ **Cloudflare's generated types clash with Node's on other names** (`src/room-object.ts` says
 * why), ⚠ **so this project names what it uses.** ⚠ **If the shape were wrong, ⚠ `wrangler dev`
 * would say so.**
 */
declare const WebSocketPair: { new (): WorkerSocketPair };

/** ⚠ **Makes one.** ⚠ **The one place that touches the global**, ⚠ so a check can pass its own. */
export const workerSocketPair = (): WorkerSocketPair => new WebSocketPair();

/**
 * ⚠ **One Worker socket, ⚠ seen as the one shape signalling talks to** (`./socket.ts`).
 *
 * ⚠ **Every difference between a Worker's WebSocket and any other lives in this function.**
 * ⚠ **A message arrives as `string` or as bytes; ⚠ the session is handed text, ⚠ or told it was
 * binary and nothing else.**
 */
export const asSignalingSocket = (ws: WorkerSocket): SignalingSocket => ({
  send: (line) => ws.send(line),
  close: (code, reason) => ws.close(code, reason),
  on: (handlers) => {
    ws.addEventListener("close", () => handlers.onClose());
    ws.addEventListener("error", () => handlers.onClose());
    ws.addEventListener("message", (event: never) => {
      const data = (event as unknown as { data: unknown }).data;
      // ⚠ Binary is answered without the content ever being decoded (`./socket.ts`).
      if (typeof data === "string") handlers.onText(data);
      else handlers.onBinary();
    });
  },
});

export type UpgradeOptions = {
  readonly sessions: Sessions;
  readonly secret: string;
  readonly now?: () => number;
  /** ⚠ **How a Worker makes a pair.** ⚠ Injected so a check does not need workerd. */
  readonly pair: () => WorkerSocketPair;
};

/**
 * ⚠⚠ **A handshake, ⚠ or the one refusal.**
 *
 * ⚠ **Every refusal is the same refusal** (`.claude/rules/security.md` § 3) — ⚠ **a bad token,
 * ⚠ a token for another room, ⚠ an expired one, ⚠ and a path that is not ours are one answer.**
 * ⚠ **`authorizeUpgrade` never rejects, ⚠ so there is no path here that leaves a socket open
 * with nobody owning it.**
 *
 * ⚠ **The subprotocol is echoed back** — ⚠ **a browser closes the connection itself otherwise.**
 */
export const upgrade = async (request: Request, options: UpgradeOptions): Promise<Response> => {
  const now = options.now ?? Date.now;
  const url = new URL(request.url);
  const offered = request.headers.get("sec-websocket-protocol");

  const checked = await authorizeUpgrade(url.pathname, offered, options.secret, now());
  if (!checked.ok) {
    return new Response(null, { status: 401 });
  }

  const pair = options.pair();
  const server = pair[1];
  server.accept();
  options.sessions.open(asSignalingSocket(server), checked.roomId, checked.sessionId, checked.role);

  // ⚠ Echoed verbatim, which means the token appears in the response header too — ⚠ only to the
  //   ⚠ client that just sent it, over the same TLS connection (`src/signaling/attach.ts`).
  const headers = new Headers();
  const ours = (offered ?? "")
    .split(",")
    .map((p) => p.trim())
    .find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX));
  if (ours !== undefined) headers.set("sec-websocket-protocol", ours);

  return new Response(null, { status: 101, webSocket: pair[0], headers } as ResponseInit);
};
