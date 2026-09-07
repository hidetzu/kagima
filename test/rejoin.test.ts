// ⚠⚠ **The mark that lets one Guest come back to one room** (`docs/adr/0029`, kagima#90).
//
// ⚠ **Measured 2026-09-06: ⚠ a phone's page was thrown away after about six minutes in the
//   ⚠ background and rebuilt from the document.** ⚠ **The Host had already said yes, ⚠ and had to
//   ⚠ say it again.**
//
// ## ⚠⚠ What this file is actually guarding
//
// ⚠ **`docs/adr/0029` moved a word in `.claude/rules/security.md` § 4: ⚠ a decision used to be
//   ⚠ spendable `once`.** ⚠ **Everything that did NOT move is what these cases assert:**
//
// ```text
// ⚠ the mark is not a way in            ⚠ it never opens a socket by itself
// ⚠ the mark is bound to one room       ⚠ one leaked mark is not all of them
// ⚠ the mark expires on its own         ⚠ and the room dying revokes it regardless
// ⚠ the token stays short-lived         ⚠ 2 minutes, unchanged
// ⚠ one refusal, whatever happened      ⚠ security.md § 3
// ```
import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeUpgrade } from "../src/signaling/authorize.ts";
import {
  issueJoinToken,
  issueRejoinMark,
  newSessionId,
  REJOIN_TTL_MS,
  TOKEN_TTL_MS,
  verifyJoinToken,
  verifyRejoinMark,
} from "../src/token/join-token.ts";

const SECRET = "a-secret-for-this-test";
const ROOM = "abcdefghij123456";
const NOW = 1_757_000_000_000;

// ── ⚠⚠ a mark is not a token, ⚠ and a token is not a mark ───────────────────

test("⚠⚠ a rejoin mark cannot open a socket", async () => {
  // ⚠⚠ **This is the whole wall.** ⚠ **Both are signed with the same secret, ⚠ so nothing but
  //   ⚠ the purpose inside the payload keeps one from being the other.**
  const mark = await issueRejoinMark(ROOM, SECRET, NOW, newSessionId());

  const asToken = await verifyJoinToken(mark, ROOM, SECRET, NOW);
  assert.equal(asToken.ok, false, "a rejoin mark verified as a join token");
  assert.equal(asToken.ok === false && asToken.why, "malformed");

  // ⚠ And through the door the browser actually knocks on.
  const handshake = await authorizeUpgrade(
    `/api/rooms/${ROOM}/signal`,
    `kagima.token.${mark}`,
    SECRET,
    NOW,
  );
  assert.equal(handshake.ok, false, "a rejoin mark opened the signalling socket");
});

test("⚠⚠ a join token cannot be spent as a rejoin mark", async () => {
  // ⚠ **The separation runs both ways, ⚠ or it is not a separation.**
  const token = await issueJoinToken(ROOM, SECRET, NOW);
  const asMark = await verifyRejoinMark(token, ROOM, SECRET, NOW);
  assert.equal(asMark.ok, false, "a join token verified as a rejoin mark");
  assert.equal(asMark.ok === false && asMark.why, "malformed");
});

// ── ⚠ what the mark is bound to ─────────────────────────────────────────────

test("⚠⚠ a mark for one room opens nothing in another", async () => {
  const mark = await issueRejoinMark(ROOM, SECRET, NOW, newSessionId());
  const elsewhere = await verifyRejoinMark(mark, "zyxwvutsrq654321", SECRET, NOW);
  assert.equal(elsewhere.ok, false);
  assert.equal(elsewhere.ok === false && elsewhere.why, "wrong-room");
});

test("⚠ a mark signed by somebody else is refused", async () => {
  const mark = await issueRejoinMark(ROOM, "a-different-secret", NOW, newSessionId());
  const checked = await verifyRejoinMark(mark, ROOM, SECRET, NOW);
  assert.equal(checked.ok, false);
  assert.equal(checked.ok === false && checked.why, "bad-signature");
});

test("⚠ a mark stops working on its own", async () => {
  const mark = await issueRejoinMark(ROOM, SECRET, NOW, newSessionId());
  assert.equal((await verifyRejoinMark(mark, ROOM, SECRET, NOW + REJOIN_TTL_MS - 1)).ok, true);
  const after = await verifyRejoinMark(mark, ROOM, SECRET, NOW + REJOIN_TTL_MS);
  assert.equal(after.ok, false, "a mark outlived its own expiry");
  assert.equal(after.ok === false && after.why, "expired");
});

test("⚠⚠ the token a mark is exchanged for is still the short-lived one", () => {
  // ⚠ **`security.md` § 4 did not move here.** ⚠ **The mark is long; ⚠ what opens a socket is not.**
  assert.equal(TOKEN_TTL_MS, 2 * 60 * 1000);
  assert.ok(
    REJOIN_TTL_MS > TOKEN_TTL_MS,
    "a mark that is not longer than a token buys nothing at all",
  );
});

// ── ⚠⚠ the session id, ⚠ and why it is in there ─────────────────────────────

test("⚠⚠ the mark carries the session id it was minted with", async () => {
  // ⚠⚠ **`src/signaling/hub.ts` tells "the same participant reconnecting" from "a third person"
  //   ⚠ by this.** ⚠ **A returning Guest with a new one can be refused as `room-full` by their
  //   ⚠ own half-open socket** — ⚠ **that file says so in its own text.**
  const sessionId = newSessionId();
  const mark = await issueRejoinMark(ROOM, SECRET, NOW, sessionId);
  const checked = await verifyRejoinMark(mark, ROOM, SECRET, NOW);
  assert.equal(checked.ok && checked.sessionId, sessionId);

  // ⚠ And the token minted from it carries the same one all the way through the handshake.
  const token = await issueJoinToken(ROOM, SECRET, NOW, sessionId);
  const handshake = await authorizeUpgrade(
    `/api/rooms/${ROOM}/signal`,
    `kagima.token.${token}`,
    SECRET,
    NOW,
  );
  assert.equal(handshake.ok && handshake.sessionId, sessionId);
});

test("⚠ a mark says nothing about who is coming back", async () => {
  // ⚠ **The payload is signed, ⚠ not encrypted** — ⚠ **anyone holding it can read it.**
  // ⚠ **`docs/PRODUCT.md` § 5: ⚠ 誰がノックしたかを記録に残さない.**
  const mark = await issueRejoinMark(ROOM, SECRET, NOW, newSessionId());
  const readable = Buffer.from(mark.slice(0, mark.indexOf(".")), "base64url").toString("utf8");
  assert.match(readable, /^rejoin:/, "the purpose is not the first thing in the payload");
  // ⚠⚠ **The same shape as a join token, ⚠ on purpose** (`src/token/join-token.ts`).
  //   ⚠ **A mark one field shorter would be separated by its length rather than by its purpose,
  //   ⚠ and a mutation showed that removing the purpose check then changed nothing.**
  assert.equal(readable.split(":").length, 5, "the mark stopped matching a join token's shape");
  assert.doesNotMatch(readable, /アン|nickname|hostKey/i, "a mark named somebody");
});
