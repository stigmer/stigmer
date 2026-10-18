// The known-gap mark: a test that states what the user SHOULD get, passes
// while a named issue still holds, and fails the day the issue is fixed.
// Domain: test support (shared assertions).
//
// expectKnownGap(gap, desired) runs `desired` (the assertions of the
// behaviour the user should get) inside an ordinary `it` body:
//
// - no gap given: `desired` is the test, nothing more;
// - `desired` fails and `gap.today.holds()`: the case passes and writes one
//   line naming the issue and today's outcome, the baseline recorded;
// - `desired` passes: the case FAILS with "<issue> no longer holds here:
//   remove the mark", the ratchet, so the fix's pull request is where the
//   mark comes off and the before and after are both on record;
// - neither: the case fails with both errors, so a test broken for an
//   unrelated reason (a typo, a moved fixture) is never mistaken for the
//   known gap.
//
// Why not `it.fails`: it passes on ANY error, so it hides exactly the
// unrelated break the last rule catches; the conformance README forbids it
// on tagged tests; and scripts/test-integrity.mjs reads this as what it is,
// an ordinary case with an assertion call (the name is `expect…`), with no
// skip to declare. A quarantine skip records no baseline at all.
//
// Twin: backend/services/runner/src/__test-utils__/known-gap.ts. The runner
// sits outside this workspace and cannot import this module. Both pin the
// same results in their own tests (__tests__/known-gap.test.ts beside each);
// a change lands in both.

/** A gap the test knows about: the issue that names it, and today's outcome in words with the check that it is what happened. */
export interface KnownGap {
  /** The open issue, `<owner>/<repo>#<number>`. */
  readonly issue: string;
  readonly today: TodayOutcome;
}

/** Today's outcome: what the user gets instead, and the check that it is still exactly that. */
export interface TodayOutcome {
  readonly says: string;
  readonly holds: () => boolean;
}

/** Thrown when a marked gap no longer holds: the mark must come off. */
export class KnownGapClosedError extends Error {
  constructor(issue: string) {
    super(`${issue} no longer holds here: remove the mark`);
    this.name = "KnownGapClosedError";
  }
}

/** Thrown when neither the desired behaviour nor today's outcome holds: something else broke. */
export class KnownGapUnexplainedError extends Error {
  readonly gap: KnownGap;
  readonly desiredError: unknown;
  readonly todayError: unknown;

  constructor(gap: KnownGap, desiredError: unknown, todayError: unknown) {
    super(
      `${gap.issue}: neither the desired behaviour nor today's known outcome ("${gap.today.says}") held.\n` +
        `  desired: ${firstLine(desiredError)}\n` +
        `  today: ${todayError === undefined ? "the check returned false" : firstLine(todayError)}`,
    );
    this.name = "KnownGapUnexplainedError";
    this.gap = gap;
    this.desiredError = desiredError;
    this.todayError = todayError;
  }
}

/** Run `desired` under `gap`'s mark (see the module header); with no gap, `desired` is the whole test. */
export async function expectKnownGap(gap: KnownGap | undefined, desired: () => void | Promise<void>): Promise<void> {
  if (!gap) {
    await desired();
    return;
  }
  let desiredError: unknown;
  try {
    await desired();
  } catch (err) {
    desiredError = err ?? new Error("desired threw a nullish value");
  }
  if (desiredError === undefined) throw new KnownGapClosedError(gap.issue);
  let holds = false;
  let todayError: unknown;
  try {
    holds = gap.today.holds();
  } catch (err) {
    todayError = err;
  }
  if (!holds) throw new KnownGapUnexplainedError(gap, desiredError, todayError);
  console.log(`[known gap] ${gap.issue}: ${gap.today.says}`);
}

function firstLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n")[0] ?? "") : String(err);
}
