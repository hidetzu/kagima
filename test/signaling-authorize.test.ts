// ⚠⚠ **The handshake's decision, ⚠ checked without a server.**
//
// ⚠ **Until 2026-09-06 this lived inside `attachSignaling`, ⚠ so the only way to exercise it was
//   ⚠ to start a listener and open a real socket** (`test/signaling.test.ts` still does, ⚠ and
//   ⚠ that is the right tier for the wiring).
// ⚠ **This is the other claim: ⚠ the rule itself, ⚠ which must be identical on Node and in a
//   ⚠ Worker** (`docs/adr/0015`).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorizeUpgrade,
  roomIdFromPath,
  tokenFromProtocols,
} from "../src/signaling/authorize.ts";
import { TOKEN_PROTOCOL_PREFIX } from "../src/signaling/protocol.ts";
import { issueJoinToken } from "../src/token/join-token.ts";

const SECRET = "a-signalling-secret";
const ROOM = "abcdefghij123456";
const OTHER = "zyxwvutsrq654321";
const NOW = 1_700_000_000_000;

const path = (roomId: string) => `/api/rooms/${roomId}/signal`;
const offer = (token: string) => `${TOKEN_PROTOCOL_PREFIX}${token}`;

test("⚠ a valid token for this room is the only thing that gets in", async () => {
  const token = await issueJoinToken(ROOM, SECRET, NOW);
  const verdict = await authorizeUpgrade(path(ROOM), offer(token), SECRET, NOW);

  assert.equal(verdict.ok, true);
  assert.ok(verdict.ok && verdict.sessionId.length > 0, "no session id came back");
});

test("⚠⚠ every refusal is the same refusal, and carries no reason at all", async () => {
  // ⚠⚠ **`.claude/rules/security.md` § 3.** ⚠ **A caller must not be able to tell a bad token
  //   ⚠ from a token for another room from a path that is not ours** — ⚠ **the first two would
  //   ⚠ answer "does this room exist?", ⚠ for free, to anyone with the URL.**
  const mine = await issueJoinToken(ROOM, SECRET, NOW);
  const theirs = await issueJoinToken(OTHER, SECRET, NOW);

  const refusals = [
    // ⚠ Malformed: nothing that looks like our endpoint.
    await authorizeUpgrade("/api/rooms//signal", offer(mine), SECRET, NOW),
    await authorizeUpgrade("/", offer(mine), SECRET, NOW),
    // ⚠ Malformed: no subprotocol of ours at all.
    await authorizeUpgrade(path(ROOM), undefined, SECRET, NOW),
    await authorizeUpgrade(path(ROOM), "some.other.protocol", SECRET, NOW),
    // ⚠ Well-formed but declined: a real token, for somewhere else.
    await authorizeUpgrade(path(ROOM), offer(theirs), SECRET, NOW),
    // ⚠ Well-formed but declined: signed with something else.
    await authorizeUpgrade(path(ROOM), offer(mine), "a-different-secret", NOW),
    // ⚠ Well-formed but declined: a timer expired while it sat unused.
    await authorizeUpgrade(path(ROOM), offer(mine), SECRET, NOW + 86_400_000),
  ];

  console.log(`  observed: ${refusals.length} distinct ways to be refused`);
  for (const verdict of refusals) {
    assert.deepEqual(verdict, { ok: false }, "a refusal carried something a caller could read");
  }
});

test("⚠ the token comes out of the subprotocol list, whatever else is offered alongside", () => {
  assert.equal(tokenFromProtocols(`chat, ${TOKEN_PROTOCOL_PREFIX}abc, other`), "abc");
  assert.equal(tokenFromProtocols(" kagima.token.xyz "), "xyz");
  assert.equal(tokenFromProtocols("chat, other"), null);
  assert.equal(tokenFromProtocols(undefined), null);
  // ⚠ A Worker reads headers through `Headers`, ⚠ whose miss is `null`, ⚠ not `undefined`.
  assert.equal(tokenFromProtocols(null), null);
});

test("⚠ only a room's signal endpoint is a signal endpoint", () => {
  assert.equal(roomIdFromPath(path(ROOM)), ROOM);
  assert.equal(roomIdFromPath(`${path(ROOM)}?x=1`), ROOM);
  assert.equal(roomIdFromPath(`/api/rooms/${ROOM}`), null);
  assert.equal(roomIdFromPath(`/api/rooms/${ROOM}/signal/more`), null);
  assert.equal(roomIdFromPath("/api/rooms/a/b/signal"), null);
});
