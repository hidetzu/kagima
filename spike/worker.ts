// ⚠⚠ **A spike, ⚠ not the port** (`CLAUDE.md` § 7: ⚠ **measure before polishing**).
//
// ⚠ **kagima has been writing "not measured here" into ADRs and PR bodies for two days**
//   (`docs/adr/0015`). ⚠ **This exists to turn those into numbers, ⚠ and then be deleted.**
//
// ## ⚠ What it must not become
//
// ⚠ **It is NOT the Worker.** ⚠ **It answers questions; ⚠ it does not carry a room.**
// ⚠ **`docs/adr/0005` and kagima#47 are unsettled, ⚠ and a spike that quietly becomes production
//   ⚠ is how an unsettled question gets answered by accident.**

import { randomToken } from "../src/random.ts";
import { authorizeUpgrade } from "../src/signaling/authorize.ts";
import { issueJoinToken, verifyJoinToken } from "../src/token/join-token.ts";

type Answer = Record<string, unknown>;

const json = (body: Answer): Response =>
  new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ⚠ Q1. ⚠ Does kagima's Web Crypto token work in workerd, ⚠ unchanged?
    if (url.pathname === "/q/token") {
      const at = 1_700_000_000_000;
      const token = await issueJoinToken("abcdefghij123456", "a-secret", at);
      const good = await verifyJoinToken(token, "abcdefghij123456", "a-secret", at);
      const wrongRoom = await verifyJoinToken(token, "zyxwvutsrq654321", "a-secret", at);
      return json({
        issued: token.length > 0,
        acceptsItsOwnRoom: good.ok,
        refusesAnother: wrongRoom.ok === false,
      });
    }

    // ⚠ Q2. ⚠ Does the CSPRNG seam work, ⚠ and is it actually random here?
    if (url.pathname === "/q/random") {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) ids.add(randomToken(16));
      return json({ drawn: 1000, distinct: ids.size, sample: randomToken(16).length });
    }

    // ⚠ Q3. ⚠ Does the handshake rule run unchanged, ⚠ reading a Worker's `Headers`?
    if (url.pathname === "/q/authorize") {
      const at = 1_700_000_000_000;
      const token = await issueJoinToken("abcdefghij123456", "a-secret", at);
      const ok = await authorizeUpgrade(
        "/api/rooms/abcdefghij123456/signal",
        `kagima.token.${token}`,
        "a-secret",
        at,
      );
      const bad = await authorizeUpgrade(
        "/api/rooms/abcdefghij123456/signal",
        request.headers.get("sec-websocket-protocol"),
        "a-secret",
        at,
      );
      return json({ acceptsAValidToken: ok.ok, refusesWhatTheBrowserDidNotSend: bad.ok === false });
    }

    // ⚠⚠ Q4. ⚠ **The one that has been unanswered since 2026-09-05**
    //   (`docs/adr/0015` § まだ測っていないこと).
    // ⚠ **Can a Worker's server-side WebSocket send a protocol-level ping?**
    // ⚠ **`ws` can. ⚠ If this one cannot, ⚠ `SignalingSocket.ping` needs a different answer here.**
    if (url.pathname === "/api/echo") {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response("expected a websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();

      const has = (name: string): boolean =>
        typeof (server as unknown as Record<string, unknown>)[name] === "function";

      server.addEventListener("message", (event: MessageEvent) => {
        if (String(event.data) === "what-can-you-do") {
          server.send(
            JSON.stringify({
              // ⚠ Read off the object itself. ⚠ Never asserted from documentation.
              ping: has("ping"),
              pong: has("pong"),
              send: has("send"),
              close: has("close"),
              // ⚠ What it actually is, ⚠ so "absent" and "not a function" are told apart.
              pingType: typeof (server as unknown as Record<string, unknown>)["ping"],
              names: Object.getOwnPropertyNames(Object.getPrototypeOf(server)).sort(),
            }),
          );
          return;
        }
        server.send(`echo:${String(event.data)}`);
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // ⚠⚠ Q5. ⚠ **`session.ts` runs its heartbeat on `setInterval`.**
    // ⚠ **If a Worker refuses one inside a request handler, ⚠ the session does not run here at
    //   ⚠ all**, ⚠ **and that is a bigger finding than the ping.**
    if (url.pathname === "/q/timers") {
      const answer: Answer = { setInterval: typeof setInterval, setTimeout: typeof setTimeout };
      try {
        let beats = 0;
        const id = setInterval(() => {
          beats += 1;
        }, 10);
        await new Promise((r) => setTimeout(r, 120));
        clearInterval(id);
        answer["itActuallyFired"] = beats;
        // ⚠ `unref` is Node's. ⚠ `session.ts` calls it with `?.`, ⚠ so its absence must be fine.
        answer["hasUnref"] = typeof (id as unknown as { unref?: unknown })?.unref === "function";
      } catch (e) {
        answer["threw"] = String(e);
      }
      return json(answer);
    }

    return new Response("spike", { status: 404 });
  },
};
