/**
 * Plugin evals' Temporal configuration: the task queue the suite and case
 * workflows and their activities run on. Their own queue, as grading's
 * (temporal/grading/config.ts), so an eval of a thousand tries never
 * delays the grading of live runs or the schedule clock. The environment
 * variable follows the other queues' names.
 */

/** The default plugin-eval queue. */
export const DEFAULT_EVALS_QUEUE = "evals_stigmer";

export class EvalsTemporalConfig {
  constructor(
    /** Task queue for the eval workflows and their activities. */
    readonly stigmerQueue: string,
  ) {}
}

/** Loads configuration from environment variables. */
export function newEvalsConfigFromEnv(): EvalsTemporalConfig {
  const queue = process.env["TEMPORAL_EVALS_STIGMER_TASK_QUEUE"];
  return new EvalsTemporalConfig(
    queue !== undefined && queue !== "" ? queue : DEFAULT_EVALS_QUEUE,
  );
}
