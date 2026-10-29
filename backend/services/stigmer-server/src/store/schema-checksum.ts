/**
 * What makes a shipped schema step unchangeable: the SHA-256 of its
 * statements, and the `migrations.sum` file that commits one line per step
 * beside each chain. Three guards read the same digest:
 *
 * - a unit test renders each chain's sum and compares it with the
 *   committed file, so a step and its line change together or not at all;
 * - `scripts/check-migration-sums.mjs` compares a branch's sum files with
 *   the base branch's and refuses a changed or removed line, so a merged
 *   step, the newest included, is frozen (a merge deploys);
 * - every runner records the digest in its ledger and refuses to boot when
 *   a recorded one differs from the build's, naming the version: the
 *   database that ran a draft step a branch later changed.
 *
 * A step's `rewrite` code is not hashed: compiled function text is not
 * stable across builds. The store README ("Schema migrations") holds the
 * rule that keeps it honest instead.
 */
import { createHash } from "node:crypto";

/** The part of a schema step its digest covers. */
export interface ChecksummedStep {
  readonly version: number;
  readonly statements: ReadonlyArray<string>;
}

/** The hex SHA-256 of a step's statements, in order. */
export function migrationChecksum(statements: ReadonlyArray<string>): string {
  return createHash("sha256").update(JSON.stringify(statements)).digest("hex");
}

const SUM_HEADER =
  "# One line per schema step: its version and the SHA-256 of its statements.\n" +
  "# A merged line never changes or goes; a new step adds a line. Written by `npm run schema:snapshot`.\n";

/** The `migrations.sum` text for a chain. */
export function renderMigrationSum(
  steps: ReadonlyArray<ChecksummedStep>,
): string {
  assertChainShape(steps);
  return (
    SUM_HEADER +
    steps
      .map((step) => `${step.version} ${migrationChecksum(step.statements)}\n`)
      .join("")
  );
}

/**
 * Refuses a chain whose versions are not 1, 2, 3, … in order: a gap or a
 * repeat would let two builds disagree on what a version means.
 */
export function assertChainShape(steps: ReadonlyArray<ChecksummedStep>): void {
  steps.forEach((step, index) => {
    if (step.version !== index + 1) {
      throw new Error(
        `schema chain step ${index + 1} has version ${step.version}; versions run 1, 2, 3, … in order`,
      );
    }
  });
}
