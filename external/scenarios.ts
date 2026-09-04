// The names of the external tier's cases, in one place.
//
// ⚠ **Same shape as `e2e/scenarios.ts`, and for the same reason:** ⚠ **the runner needs them to
//   ⚠ list and select; the tests need them as titles.** ⚠ **Two copies drift silently.**
//
// ⚠ **`--list` loads this file and nothing else.** ⚠ **Keep it free of imports.**

export type Scenario = {
  readonly name: string;
  /** ⚠ **What this case can show.** ⚠ Named after what it needs, never after how true it feels. */
  readonly sees: string;
};

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "chromium-to-firefox",
    sees: "a call between two engines we did not write, carrying frames both ways",
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
