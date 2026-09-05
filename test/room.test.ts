// ⚠ **What is under test is what the room id and the store are claimed to guarantee.**
// ⚠ **Every claim in `docs/adr/0005` and in `.claude/rules/security.md` § 1 has a case here.**
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createRoom, defaultDeps, MAX_ID_ATTEMPTS } from "../src/room/create-room.ts";
import {
  ALPHABET,
  buildShareUrl,
  generateRoomId,
  ID_LENGTH,
  isRoomId,
  ROOM_ID_BITS,
  roomIdFromBytes,
} from "../src/room/room-id.ts";
import { createRoomStore, ROOM_IDLE_MS } from "../src/room/store.ts";
import { codeOf } from "./source-text.ts";

const BASE = "https://kagima.example";

// ── the id ──────────────────────────────────────────────────────────────────

test("⚠ the alphabet length is a power of two", () => {
  // ⚠ Uniform selection masks a random byte. ⚠ Any other length biases it, silently.
  assert.equal(ALPHABET.length & (ALPHABET.length - 1), 0);
  assert.equal(new Set(ALPHABET).size, ALPHABET.length, "a repeated character biases the id");
});

test("⚠ the alphabet leaves out the characters people mistype", () => {
  // ⚠ 0/O and 1/l/I are the pairs that break a URL copied by hand.
  for (const c of ["i", "l", "o", "u"]) {
    assert.ok(!ALPHABET.includes(c), `${c} is in the alphabet`);
  }
});

test("⚠ ROOM_ID_BITS is derived, not asserted independently", () => {
  // ⚠ A literal here would keep passing after ID_LENGTH changed, and the claim would go false.
  assert.equal(ROOM_ID_BITS, ID_LENGTH * Math.log2(ALPHABET.length));
});

test("⚠ both ends of the alphabet are reachable", () => {
  const first = ALPHABET[0] as string;
  const last = ALPHABET[ALPHABET.length - 1] as string;
  assert.equal(roomIdFromBytes(new Uint8Array(ID_LENGTH).fill(0)), first.repeat(ID_LENGTH));
  assert.equal(roomIdFromBytes(new Uint8Array(ID_LENGTH).fill(0xff)), last.repeat(ID_LENGTH));
});

test("⚠ the mask ignores the bits above the alphabet", () => {
  // ⚠ Byte 0x00 and byte 0x20 must give the same character; if not, the selection is biased.
  const a = roomIdFromBytes(new Uint8Array(ID_LENGTH).fill(0x00));
  const b = roomIdFromBytes(new Uint8Array(ID_LENGTH).fill(0x20));
  assert.equal(a, b);
});

test("⚠ too few bytes throws rather than shortening the id", () => {
  assert.throws(() => roomIdFromBytes(new Uint8Array(ID_LENGTH - 1)), RangeError);
});

test("a generated id is the canonical shape", () => {
  for (let i = 0; i < 100; i++) assert.ok(isRoomId(generateRoomId()));
});

test("⚠ isRoomId rejects the wrong length and characters outside the alphabet", () => {
  assert.ok(!isRoomId(""));
  assert.ok(!isRoomId("a".repeat(ID_LENGTH - 1)));
  assert.ok(!isRoomId("a".repeat(ID_LENGTH + 1)));
  assert.ok(!isRoomId(`o${"a".repeat(ID_LENGTH - 1)}`), "o is not in the alphabet");
  assert.ok(!isRoomId(`A${"a".repeat(ID_LENGTH - 1)}`), "uppercase is not canonical");
});

// ── the share URL ───────────────────────────────────────────────────────────

test("the share URL carries the room id", () => {
  const id = generateRoomId();
  assert.equal(buildShareUrl(BASE, id), `${BASE}/r/${id}`);
});

test("buildShareUrl refuses anything that is not a room id", () => {
  assert.throws(() => buildShareUrl(BASE, "not-a-room-id"), TypeError);
});

// ── the store ───────────────────────────────────────────────────────────────

test("⚠ a fresh store holds nothing", () => {
  // ⚠ This is the claim `docs/adr/0005` rests on: a new process has no rooms.
  assert.equal(createRoomStore().size(), 0);
});

test("⚠ two stores share nothing", () => {
  // ⚠ If they did, state would outlive the thing that owns it.
  const a = createRoomStore();
  const b = createRoomStore();
  createRoom(a, BASE);
  assert.equal(a.size(), 1);
  assert.equal(b.size(), 0);
});

test("⚠ add refuses to overwrite a live room", () => {
  // ⚠ Overwriting would hand a second host the id of a room already in use.
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  assert.equal(store.add({ ...room, createdAt: room.createdAt + 1 }), false);
  assert.equal(store.get(room.id)?.createdAt, room.createdAt, "the live room was replaced");
});

test("closing a room drops it, and closing it again says there was none", () => {
  const store = createRoomStore();
  const { room } = createRoom(store, BASE);
  assert.equal(store.close(room.id), true);
  assert.equal(store.get(room.id), undefined);
  assert.equal(store.size(), 0);
  assert.equal(store.close(room.id), false);
});

// ── creating a room ─────────────────────────────────────────────────────────

test("⚠ a colliding id is retried rather than overwriting", () => {
  // ⚠ A collision cannot be waited for at this entropy, so the generator is injected.
  //   ⚠ Without this, the retry path would ship having never run.
  const store = createRoomStore();
  const taken = "a".repeat(ID_LENGTH);
  let calls = 0;
  const free = "b".repeat(ID_LENGTH);
  const { room } = createRoom(store, BASE, {
    newId: () => (++calls === 1 ? taken : free),
    newHostKey: () => "a-host-key",
    now: () => 0,
  });
  assert.equal(room.id, taken, "the first id was free, so it should have been used");

  const second = createRoom(store, BASE, {
    newId: () => (calls++ < 3 ? taken : free),
    newHostKey: () => "a-host-key",
    now: () => 0,
  });
  assert.equal(second.room.id, free, "the collision was not retried past");
  assert.equal(store.size(), 2);
});

test("⚠ a generator that never yields a free id gives up loudly", () => {
  // ⚠ The alternative to a bound is a loop that never ends when the generator is broken.
  const store = createRoomStore();
  const same = "c".repeat(ID_LENGTH);
  const deps = {
    newId: () => same,
    newHostKey: () => "a-host-key",
    now: () => 0,
  };
  createRoom(store, BASE, deps);
  assert.throws(() => createRoom(store, BASE, deps), new RegExp(String(MAX_ID_ATTEMPTS)));
  assert.equal(store.size(), 1, "a partial room was left behind");
});

// ── ⚠ what src/ is not allowed to do ────────────────────────────────────────

const sourceFiles = async (dir = "src"): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sourceFiles(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
};

/**
 * ⚠ **The one file allowed to touch the filesystem, ⚠ and why.**
 *
 * ⚠ **`src/static.ts` reads the pages and the built browser modules off disk** (`docs/adr/0016`).
 * ⚠ **That is not persisting a room** — ⚠ **it never writes, ⚠ and what it reads is the same for
 * every caller.** ⚠ **The case below cuts it out and then checks what is left inside it**, ⚠ which
 * is how a narrow exception stays narrow.
 *
 * ⚠ **It is also the file a Worker replaces outright** (`docs/adr/0015`).
 */
const MAY_READ_THE_DISK = "src/static.ts";

test("⚠ nothing under src/ imports a way to persist a room", async () => {
  // ⚠ This is what defends docs/adr/0005 mechanically. ⚠ Without it the ADR is a promise.
  // ⚠ What it shows: our process does not write rooms down.
  // ⚠ What it does NOT show: that nothing remains in memory. ⚠ Different claim, no check.
  const forbidden = /from\s+"node:(fs|fs\/promises|sqlite)"|require\(\s*"node:(fs|sqlite)"/;
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    if (file === MAY_READ_THE_DISK) continue;
    if (forbidden.test(codeOf(await readFile(file, "utf8")))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `a persistence module is imported in: ${offenders.join(", ")}`);
});

test("⚠⚠ the one file that may read the disk never writes to it", async () => {
  // ⚠⚠ **Until 2026-09-06 this file was invisible to the case above** (`CLAUDE.md` § 9):
  //   ⚠ **a glob inside one of its comments opened a block comment that swallowed its imports.**
  // ⚠ **The exemption is deliberate now, ⚠ so the claim it costs is asserted here instead.**
  //
  // ⚠ **What this shows: ⚠ no write API is named in it.**
  // ⚠ **What it does NOT show: ⚠ that nothing anywhere writes.** ⚠ Different claim, and the case
  //   ⚠ above is the one that carries it for every other file.
  const code = codeOf(await readFile(MAY_READ_THE_DISK, "utf8"));

  // ⚠ Named, so the failure says which one. ⚠ A regex alternation would say only "it matched".
  const WRITES = [
    "writeFile",
    "writeFileSync",
    "appendFile",
    "appendFileSync",
    "createWriteStream",
    "mkdir",
    "mkdirSync",
    "rm",
    "rmSync",
    "unlink",
    "unlinkSync",
    "open",
    "openSync",
  ];
  const found = WRITES.filter((name) => new RegExp(`\\b${name}\\b`).test(code));
  assert.deepEqual(found, [], `${MAY_READ_THE_DISK} names a write API: ${found.join(", ")}`);

  // ⚠ And it is still the file this exemption was written for. ⚠ If it stops reading the disk,
  //   ⚠ the exemption is stale and should go, rather than sit here covering something else.
  assert.match(code, /from\s+"node:fs"/, "the exemption no longer describes this file");
});

test("⚠ nothing under src/ reaches for a non-CSPRNG source of ids", async () => {
  // ⚠ Nothing above would fail if generateRoomId used Math.random. ⚠ Every property would hold
  //   ⚠ and the id would be predictable — ⚠ "the test passed ≠ the behaviour is correct".
  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    if (/Math\s*\.\s*random/.test(codeOf(await readFile(file, "utf8")))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `Math.random appears in: ${offenders.join(", ")}`);
});

test("⚠ the room id generator draws from the one CSPRNG seam", async () => {
  // ⚠ The negative test cannot show a CSPRNG *is* used, only that a known-bad one is not.
  // ⚠ `src/random.ts` replaced `node:crypto` because Workers does not have it (`docs/adr/0015`).
  //   ⚠ The wall is unchanged: ⚠ draw from the sanctioned place, ⚠ and nowhere else.
  const code = codeOf(await readFile("src/room/room-id.ts", "utf8"));
  assert.match(code, /import\s*\{[^}]*\brandomBytes\b[^}]*\}\s*from\s*"\.\.\/random\.ts"/);
  assert.match(code, /randomBytes\(ID_LENGTH\)/);
});

// ── how long a room lives ───────────────────────────────────────────────────
// ⚠ **Time is injected.** ⚠ **A test that waits out a real expiry is a test nobody runs, and it
//   ⚠ still could not show what happens exactly on the boundary.**

const at = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

// ⚠ The store and the room have to read the SAME clock. ⚠ The first version of these cases gave
//   ⚠ the store a fake clock and let `createRoom` keep the real one, ⚠ so every room looked
//   ⚠ decades young and nothing ever expired — ⚠ five cases failed for one reason, and the
//   ⚠ reason was in the test, not in the code.
const roomAt = (store: ReturnType<typeof createRoomStore>, now: () => number) =>
  createRoom(store, BASE, { ...defaultDeps, now });

test("⚠ a room nobody joins expires, and not a moment early", () => {
  const clock = at();
  const store = createRoomStore({ now: clock.now });
  const { room } = roomAt(store, clock.now);

  clock.advance(ROOM_IDLE_MS - 1);
  assert.notEqual(store.get(room.id), undefined, "it expired early");
  clock.advance(1);
  assert.equal(store.get(room.id), undefined, "it did not expire");
});

test("⚠⚠ an expired room answers exactly like one that never existed", () => {
  // ⚠ `docs/adr/0004`: the two are the same thing from outside, and that is only true if `get`
  //   ⚠ refuses the moment it runs out — ⚠ not when the sweeper next happens to look.
  const clock = at();
  const store = createRoomStore({ now: clock.now });
  const { room } = roomAt(store, clock.now);
  clock.advance(ROOM_IDLE_MS);

  assert.equal(store.get(room.id), undefined);
  assert.equal(store.get("z".repeat(ID_LENGTH)), undefined);
});

test("⚠ touching a room keeps it alive, so a call is not cut off by its own room", () => {
  const clock = at();
  const store = createRoomStore({ now: clock.now });
  const { room } = roomAt(store, clock.now);

  for (let i = 0; i < 10; i++) {
    clock.advance(ROOM_IDLE_MS - 1);
    store.touch(room.id);
  }
  clock.advance(ROOM_IDLE_MS - 1);
  assert.notEqual(store.get(room.id), undefined, "a touched room still expired");
});

test("⚠ touching a room that is already gone does not bring it back", () => {
  const clock = at();
  const store = createRoomStore({ now: clock.now });
  const { room } = roomAt(store, clock.now);
  clock.advance(ROOM_IDLE_MS);
  store.get(room.id); // ⚠ drops it
  store.touch(room.id);
  assert.equal(store.get(room.id), undefined, "an expired room was revived by a touch");
  assert.equal(store.size(), 0);
});

test("⚠ sweeping says which rooms went, so their sockets can be hung up", () => {
  // ⚠ The store knows nothing about sockets and must not learn. ⚠ It says which ids went.
  const clock = at();
  const store = createRoomStore({ now: clock.now });
  const stale = roomAt(store, clock.now).room;
  clock.advance(ROOM_IDLE_MS - 1);
  const fresh = roomAt(store, clock.now).room;
  clock.advance(1);

  assert.deepEqual(store.sweep(), [stale.id]);
  assert.equal(store.size(), 1);
  assert.notEqual(store.get(fresh.id), undefined);
});

test("⚠ a closed room and an expired room are both simply gone", () => {
  // ⚠ Two ways in, one state out. ⚠ Nothing downstream should be able to tell them apart.
  const clock = at();
  const store = createRoomStore({ now: clock.now });
  const closed = roomAt(store, clock.now).room;
  const expired = roomAt(store, clock.now).room;
  store.close(closed.id);
  clock.advance(ROOM_IDLE_MS);
  assert.equal(store.get(closed.id), undefined);
  assert.equal(store.get(expired.id), undefined);
});

test("⚠⚠ nothing under src/ draws randomness while the module is loading", async () => {
  // ⚠⚠ **Measured in `wrangler dev --local` on 2026-09-06:**
  //   ⚠ **`Uncaught Error: Disallowed operation called within global scope. Asynchronous I/O
  //   ⚠ (ex: fetch() or connect()), setting a timeout, and generating random values are not
  //   ⚠ allowed within global scope.`**
  // ⚠ **`src/token/join-token.ts` drew its comparison key at module load, ⚠ so loading it killed
  //   ⚠ the isolate** — ⚠ **nothing kagima has would have started there** (`docs/adr/0015`).
  //
  // ⚠ **What this is: ⚠ a proxy.** ⚠ **Indentation stands in for "inside a function", ⚠ which
  //   ⚠ holds because this tree is formatted** (`npm run check`, case `format`).
  // ⚠ **What it is NOT: ⚠ a parser, ⚠ and not the runtime itself.** ⚠ **The claim about the
  //   ⚠ runtime is a Worker actually starting, ⚠ and that is `spike/` today.**
  const DRAWS = /\b(randomBytes|randomToken|getRandomValues|randomUUID)\s*\(/;

  const offenders: string[] = [];
  for (const file of await sourceFiles()) {
    for (const line of codeOf(await readFile(file, "utf8")).split("\n")) {
      // ⚠ Column 0 and a declaration: ⚠ this runs when the module is loaded, not when it is used.
      if (!/^(export\s+)?(const|let|var)\s/.test(line)) continue;
      const draw = line.search(DRAWS);
      if (draw === -1) continue;

      // ⚠⚠ **A declaration whose value is a function is not a draw** — ⚠ **`export const
      //   ⚠ randomBytes = (n) => crypto.getRandomValues(...)` runs when it is called.**
      // ⚠ **The first attempt missed this and named four innocent lines**, ⚠ **which is how a
      //   ⚠ wall gets turned off rather than fixed.**
      const arrow = line.indexOf("=>");
      if (line.includes("function")) continue;
      if (arrow !== -1 && arrow < draw) continue;

      offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `randomness is drawn at module load in: ${offenders.join(", ")}`);
});
