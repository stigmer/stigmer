/**
 * Grading configuration: the task queue the grading workflow and its
 * activities run on. Its own queue, as the schedule clock's
 * (temporal/schedule/config.ts), so grading a burst of finished runs never
 * delays the agent-execution queue's workers. The environment variable
 * follows the schedule queue's name, so a deployment configures both the
 * same way and none has to change for grading to run.
 */

/** The default grading queue. */
export const DEFAULT_GRADING_QUEUE = "grading_stigmer";

export class GradingTemporalConfig {
  constructor(
    /** Task queue for the grading workflow and its activities. */
    readonly stigmerQueue: string,
  ) {}
}

/** Loads configuration from environment variables. */
export function newGradingConfigFromEnv(): GradingTemporalConfig {
  const queue = process.env["TEMPORAL_GRADING_STIGMER_TASK_QUEUE"];
  return new GradingTemporalConfig(
    queue !== undefined && queue !== "" ? queue : DEFAULT_GRADING_QUEUE,
  );
}
