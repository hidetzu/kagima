// The names of the final gate's cases, in one place.
//
// ⚠ **The runner needs them to list and to select; the tests need them as their titles.**
//   ⚠ **Two copies of one decision drift, and the drift is silent: `--only=` would match nothing
//   ⚠ and exit 0** (`CLAUDE.md` § 3, and the same failure `scripts/cases.ts` was built to avoid).
// ⚠ **So there is one copy, and both sides import it.**
//
// ⚠ **`--list` loads this file and nothing else** (`.claude/rules/verification.md` —
//   ⚠ **counting must not load anything heavy**). ⚠ **Keep it free of imports.**

export type Scenario = {
  readonly name: string;
  /** ⚠ **What this case can show.** ⚠ Named after what it needs, never after how true it feels. */
  readonly sees: string;
};

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "frames",
    sees: "two browsers in one room decoding each other's video frames",
  },
  {
    name: "guest-refusals",
    sees: "an unknown room and a room whose Host has not looked reading the same",
  },
  {
    name: "guest-keeps-nothing",
    sees: "the join token not surviving the page it arrived on",
  },
  {
    name: "media-refused",
    sees: "what a person is told when the camera cannot be reached",
  },
  {
    name: "host-screen",
    sees: "the host page handing over a URL, and no control putting a token on the clipboard",
  },
  {
    name: "peer-drops",
    sees: "the host being told the other side left, without being told the room ended",
  },
  {
    name: "signalling-drops",
    sees: "the call surviving kagima going away, and being described that way",
  },
  {
    name: "diagnostics",
    sees: "the field-test report carrying candidate types out of a real call, and no address",
  },
  {
    name: "field-test-mode-is-gone",
    sees: "the retired debug mode staying gone even when its flag is set",
  },
  {
    name: "third-person",
    sees: "a third person waiting at the door while two are already talking",
  },
  {
    name: "host-closes",
    sees: "the guest's tracks ending when the host closes the room",
  },
];

export const scenarioNames = (scenarios: readonly Scenario[] = SCENARIOS): string[] =>
  scenarios.map((s) => s.name);

/** ⚠ **The title a test carries.** ⚠ Built here so the runner's `--only=` can match it exactly. */
export const titleOf = (name: string): string => {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (scenario === undefined) throw new RangeError(`no scenario named ${name}`);
  return `[${scenario.name}] ${scenario.sees}`;
};
