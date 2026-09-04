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
    name: "media-refused",
    sees: "what a person is told when the camera cannot be reached",
  },
  {
    name: "host-screen",
    sees: "the host page handing over a URL and a passphrase, and keeping them apart",
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
