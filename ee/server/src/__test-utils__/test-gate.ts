/**
 * Whether this run is a test gate, and what that means for a dependency a
 * suite needs.
 *
 * A gate is any run that sets `STIGMER_TEST_GATE=1` and provides every
 * dependency its suites name. So inside a gate a dependency that is missing
 * is the gate's failure, and the suite that needs it fails by name instead of
 * skipping. Outside a gate nothing changes: the suite skips
 * by name with its reason, as it always has.
 */

export const IN_TEST_GATE = process.env["STIGMER_TEST_GATE"] === "1";

/**
 * The value of a dependency's variable, or undefined when it is unset (the
 * suite then skips by name). Inside a gate an unset variable throws, so every
 * file that reads it fails at collection with this message.
 */
export function gateDependency(variable: string, dependency: string): string | undefined {
  const value = process.env[variable];
  const set = value !== undefined && value !== "" ? value : undefined;
  if (set === undefined && IN_TEST_GATE) {
    throw new Error(`STIGMER_TEST_GATE=1 but ${variable} is unset: the gate must provide ${dependency}`);
  }
  return set;
}
