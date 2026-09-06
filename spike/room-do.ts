// ⚠⚠ **A spike, ⚠ not the port** (`spike/README.md`).
//
// ⚠ **One question**: ⚠ **when the last socket closes, ⚠ how long does a Durable Object keep
//   ⚠ what it was holding in memory?**
//
// ⚠ **`docs/adr/0015` measured this on 2026-09-05** — ⚠ **8 s alive, ⚠ 15 s gone** — ⚠ **but that
//   ⚠ was the passphrase era, ⚠ before `docs/adr/0017` made the Host hold a socket open.**
// ⚠ **And today's real-device measurement changed what matters**: ⚠ **a backgrounded tab is
//   ⚠ discarded in about 73 s** (kagima#75), ⚠ **so the Host's socket goes away on its own.**
//
// ⚠ **What is being measured is therefore: ⚠ Host's socket closes → ⚠ how long until the room
//   ⚠ is gone.** ⚠ **`ROOM_IDLE_MS` is 20 minutes and has nothing to do with it.**

export class RoomSpike {
  /** ⚠ **In memory only.** ⚠ **Nothing is written** — ⚠ **that is the thing being measured.** */
  private room: { readonly at: number } | null = null;
  private sockets = 0;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const say = (body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });

    // ⚠ Make a room. ⚠ Held in memory, ⚠ like kagima holds it now.
    if (url.pathname.endsWith("/make")) {
      this.room = { at: Date.now() };
      return say({ made: true, storageKeys: [...(await this.state.storage.list()).keys()].length });
    }

    // ⚠⚠ The other half of the question: ⚠ if we DO write, ⚠ does it survive?
    // ⚠ **`docs/adr/0005` says nothing is written.** ⚠ **This measures what writing would buy** —
    //   ⚠ **so the choice is made against a number rather than against a guess.**
    if (url.pathname.endsWith("/make-written")) {
      await this.state.storage.put("room", { at: Date.now() });
      return say({ made: true, storageKeys: [...(await this.state.storage.list()).keys()].length });
    }

    if (url.pathname.endsWith("/read-written")) {
      const held = (await this.state.storage.get("room")) as { at: number } | undefined;
      return say({
        room: held === undefined ? null : { ageMs: Date.now() - held.at },
        sockets: this.sockets,
        storageKeys: [...(await this.state.storage.list()).keys()].length,
      });
    }

    // ⚠ Is it still there? ⚠ This is the whole measurement.
    if (url.pathname.endsWith("/read")) {
      return say({
        room: this.room === null ? null : { ageMs: Date.now() - this.room.at },
        sockets: this.sockets,
        storageKeys: [...(await this.state.storage.list()).keys()].length,
      });
    }

    // ⚠ A socket, ⚠ accepted the way kagima accepts one.
    if (url.pathname.endsWith("/socket")) {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      this.sockets += 1;
      server.addEventListener("close", () => {
        this.sockets -= 1;
      });
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("spike", { status: 404 });
  }

  constructor(private state: DurableObjectState) {}
}
