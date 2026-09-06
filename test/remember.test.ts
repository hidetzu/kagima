// ⚠⚠ **The one thing kagima keeps on a device** (`docs/adr/0021`, kagima#75).
//
// ⚠ **Measured on a real phone on 2026-09-06: ⚠ the browser discarded the backgrounded tab and
//   ⚠ reloaded it.** ⚠ **The Host's key was a variable, ⚠ so the room stayed alive on the server
//   ⚠ with nobody able to open its door.**
//
// ⚠ **`docs/PRODUCT.md` § 5 promises no way to identify a user over time.** ⚠ **One room's key is
//   ⚠ not that** — ⚠ **but a pile of them would be.** ⚠ **So the size of the pile is a wall.**
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { forget, recall, remember } from "../src/client/remember.ts";

/** ⚠ A storage that behaves like the browser's, ⚠ including being able to refuse. */
const fakeStorage = (options: { readonly throws?: boolean } = {}) => {
  const held = new Map<string, string>();
  const guard = () => {
    if (options.throws) throw new Error("this browser is not keeping anything");
  };
  return {
    held,
    as: {
      getItem: (k: string) => {
        guard();
        return held.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        guard();
        held.set(k, v);
      },
      removeItem: (k: string) => {
        guard();
        held.delete(k);
      },
      clear: () => held.clear(),
      key: () => null,
      get length() {
        return held.size;
      },
    } as unknown as Storage,
  };
};

const install = (s: Storage | undefined) => {
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
};

beforeEach(() => install(fakeStorage().as));

test("⚠ what was written down comes back", () => {
  remember({ roomId: "abcdefghij123456", hostKey: "a-host-key" });
  assert.deepEqual(recall(), { roomId: "abcdefghij123456", hostKey: "a-host-key" });
});

test("⚠⚠ exactly two strings are kept, and nothing else", () => {
  // ⚠⚠ **The claim `docs/PRODUCT.md` § 5 turns on.** ⚠ **A join token would take away the one
  //   ⚠ property it has** (`.claude/rules/security.md` § 4: ⚠ **short-lived**).
  // ⚠ **A nickname belongs to whoever knocked, ⚠ not to the Host.**
  const fake = fakeStorage();
  install(fake.as);
  // ⚠ Handed in on purpose. ⚠ A caller passing the whole room object is the likely mistake,
  //   ⚠ and it must not be the one that writes a token down.
  const wholeRoom = {
    roomId: "abcdefghij123456",
    hostKey: "a-host-key",
    token: "a-join-token",
    nickname: "アン",
    shareUrl: "https://example.test/r/x",
  };
  remember(wholeRoom);

  const written = [...fake.held.values()].join("");
  console.log(`  observed: what is written is ${written}`);
  assert.doesNotMatch(written, /a-join-token/, "a join token was written down");
  assert.doesNotMatch(written, /アン/, "somebody's name was written down");
  assert.doesNotMatch(written, /example\.test/, "an address was written down");
  assert.deepEqual(Object.keys(JSON.parse(written) as object).sort(), ["hostKey", "roomId"]);
});

test("⚠⚠ it never becomes a pile", () => {
  // ⚠ **A record of how many rooms this device has made is close to the thing we promised not
  //   ⚠ to have** (`docs/PRODUCT.md` § 5: ⚠ **利用者を継続的に識別する手段を持たない**).
  const fake = fakeStorage();
  install(fake.as);
  for (let i = 0; i < 5; i++) remember({ roomId: `room-${i}`, hostKey: `key-${i}` });

  console.log(`  observed: ${fake.held.size} entries after 5 rooms`);
  assert.equal(fake.held.size, 1, "the keys are piling up");
  assert.equal(recall()?.roomId, "room-4", "the newest room is not the one kept");
});

test("⚠ forgetting leaves nothing", () => {
  const fake = fakeStorage();
  install(fake.as);
  remember({ roomId: "abcdefghij123456", hostKey: "a-host-key" });
  forget();
  assert.equal(recall(), null);
  assert.equal(fake.held.size, 0, "something was left behind");
});

test("⚠⚠ a shape we did not write is treated as absent, and removed", () => {
  // ⚠ **Not ours to interpret.** ⚠ **And leaving it there means reading it again next time.**
  for (const junk of ['{"roomId":1,"hostKey":"k"}', '{"roomId":"r"}', "not json", '""', "{}"]) {
    const fake = fakeStorage();
    install(fake.as);
    fake.held.set("kagima.room", junk);
    assert.equal(recall(), null, `${junk} was read as a room`);
    assert.equal(fake.held.size, 0, `${junk} was left behind`);
  }
});

test("⚠⚠ a browser where even reaching for storage throws is not an error", () => {
  // ⚠⚠ **Some browsers throw on the property itself, ⚠ not on the methods** — ⚠ **site data
  //   ⚠ blocked, ⚠ an embedded view.** ⚠ **That is a different throw from a refused `setItem`,
  //   ⚠ and it is the one `store()` exists to catch.**
  // ⚠ **The first version of this case only made the methods throw, ⚠ so removing that guard
  //   ⚠ changed nothing and the mutation sailed through.**
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("this browser will not even say");
    },
  });
  assert.doesNotThrow(() => remember({ roomId: "r", hostKey: "k" }));
  assert.doesNotThrow(() => recall());
  assert.doesNotThrow(() => forget());
  assert.equal(recall(), null);
});

test("⚠⚠ a browser that keeps nothing is not an error", () => {
  // ⚠ **A private window, ⚠ a full quota.** ⚠ **Here the methods refuse rather than the getter.**
  install(fakeStorage({ throws: true }).as);
  assert.doesNotThrow(() => remember({ roomId: "r", hostKey: "k" }));
  assert.equal(recall(), null);
  assert.doesNotThrow(() => forget());

  // ⚠ And where there is no storage object at all.
  install(undefined);
  assert.doesNotThrow(() => remember({ roomId: "r", hostKey: "k" }));
  assert.equal(recall(), null);
  assert.doesNotThrow(() => forget());
});

test("⚠⚠ two ways to forget, ⚠ and neither is the other's spare", () => {
  // ⚠⚠ **A mutation found this**: ⚠ **removing either `forget()` from the Host's page left the
  //   ⚠ browser check green, ⚠ because the other one covered it.** ⚠ **Removing both failed.**
  //
  // ⚠ **They are not the same event, ⚠ and the page cannot rely on one:**
  //
  // ```text
  // ⚠ the Host pressed 閉じる          → ⚠ forget now. ⚠ We know the room is over
  // ⚠ the server said 4005            → ⚠ forget now. ⚠ Somebody else ended it,
  //                                      ⚠ or this page had already given up and
  //                                      ⚠ pressing 閉じる would not re-fire anything
  // ```
  //
  // ⚠ **So the claim checked here is the smaller, ⚠ true one: ⚠ forgetting is idempotent, ⚠ and
  //   ⚠ calling it from either place — ⚠ or both — ⚠ leaves the same nothing.**
  // ⚠ **Which of the two fired is the page's business, ⚠ and `e2e` covers that they both exist.**
  const fake = fakeStorage();
  install(fake.as);
  remember({ roomId: "abcdefghij123456", hostKey: "a-host-key" });

  forget();
  forget();

  assert.equal(recall(), null);
  assert.equal(fake.held.size, 0, "forgetting twice left something behind");
});
