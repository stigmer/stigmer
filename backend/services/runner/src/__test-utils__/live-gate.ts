/**
 * The live layer's gate: how a `*.live.test.ts` gets a real provider key,
 * when it skips without one, and where it reports what it spent.
 *
 * A live test calls a real provider with a real key and spends real money.
 * It runs only through `vitest.live.config.ts` (`npm run test:live`), never in
 * `npm test`. Two postures, decided here and nowhere else:
 *
 *  - Outside the live lane, a missing key skips the suites that need it, and
 *    the reason is printed once per key (test/README.md, rule 1: a test that
 *    cannot run skips with its reason; it never passes).
 *  - Inside the live lane (`STIGMER_LIVE=1`, which a person sets for a
 *    deliberate live run and an automated live run sets always), a missing key
 *    throws. The lane provides every key it runs, so a key that vanished is a
 *    broken lane and must go red, never quietly green (rule 2's shape, the way
 *    `IN_TEST_GATE` turns a missing service into a failure).
 *
 * A suite writes the call inside its skip condition,
 * `describe.skipIf(!liveSecret("CURSOR_API_KEY"))(...)`, never through a
 * variable or an alias: `scripts/test-integrity.mjs` explains a skip by the
 * text of its condition, and reads `liveSecret(` as carrying its reason only
 * in a live file.
 *
 * A key's value is never printed, logged or recorded here, and a caller must
 * not do so either; only the variable's name appears in any message.
 *
 * `recordLiveSpend` is the one place a live case reports its estimated cost:
 * one line to the step summary GitHub names (`GITHUB_STEP_SUMMARY`) when it is
 * set, so a reader sees the spend beside the result, and the same line on
 * stdout otherwise. A case whose run reported no estimate says so; it never
 * reads as a free run.
 */
import { appendFileSync } from "node:fs";

/** The provider keys a live test may ask for; each is a credential a live run provides. */
export type LiveSecretName = "ANTHROPIC_API_KEY" | "CURSOR_API_KEY";

const announced = new Set<LiveSecretName>();

/**
 * The key a live suite runs with. Outside the live lane a missing key returns
 * `undefined` (the suite skips, the reason printed once per key); inside the
 * lane it throws, naming the variable and never its value.
 */
export function liveSecret(name: LiveSecretName, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name];
  if (value) return value;
  if (env.STIGMER_LIVE === "1") {
    throw new Error(
      `${name} is not set, but STIGMER_LIVE=1: the live lane provides every key its suites need, so a missing one is a broken lane, not a skip`,
    );
  }
  if (!announced.has(name)) {
    announced.add(name);
    console.warn(`[live] ${name} is not set: the live suites that need it skip (set it to run them; they spend real money)`);
  }
  return undefined;
}

/**
 * Report one live case's estimated spend, in US dollars, or that its run
 * reported none. Zero counts as none: a real provider call always costs
 * something, and a usage summary's `estimated_cost_usd` is a proto3 double
 * that reads 0 when nothing was priced. Appends a line to the file
 * `GITHUB_STEP_SUMMARY` names when that is set, and prints it either way.
 */
export function recordLiveSpend(caseName: string, estimatedCostUsd: number | undefined, env: NodeJS.ProcessEnv = process.env): void {
  const amount = !estimatedCostUsd ? "no estimate reported" : `$${estimatedCostUsd.toFixed(4)} estimated`;
  const line = `- ${caseName}: ${amount}`;
  console.log(`[live] spend ${line.slice(2)}`);
  const summary = env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${line}\n`);
}
