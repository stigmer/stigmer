/**
 * Wait task — pauses workflow execution for a specified duration.
 *
 * Maps to Temporal's `sleep()` via the `ctx.sleep` callback. The kernel
 * never imports Temporal APIs directly — it computes the total milliseconds
 * from the CNCF duration fields and delegates to the opaque callback.
 *
 * YAML shape:
 *   - cooldown:
 *       wait:
 *         seconds: 30
 *
 * Output: undefined (wait produces no task output).
 */

import type {
  TaskBuilder,
  TaskDef,
  TaskExecutorFn,
  WaitTaskDef,
  DurationDef,
  WorkflowState,
} from "../types.js";

export class WaitTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: TaskDef;

  constructor(taskName: string, taskDef: WaitTaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build(): TaskExecutorFn {
    const waitDef = this.taskDef as WaitTaskDef;
    const durationMs = durationToMs(waitDef.wait);

    if (durationMs <= 0) {
      return async () => undefined;
    }

    return async (_input: unknown, _state: WorkflowState, ctx) => {
      await ctx.sleep(durationMs);
      return undefined;
    };
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}

/**
 * Converts a CNCF DurationDef to total milliseconds. Sums all
 * provided fields additively (matching Go's `utils.ToDuration`).
 */
export function durationToMs(duration: DurationDef): number {
  let ms = 0;
  if (duration.milliseconds) ms += duration.milliseconds;
  if (duration.seconds) ms += duration.seconds * 1_000;
  if (duration.minutes) ms += duration.minutes * 60_000;
  if (duration.hours) ms += duration.hours * 3_600_000;
  if (duration.days) ms += duration.days * 86_400_000;
  return ms;
}
