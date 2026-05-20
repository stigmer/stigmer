/**
 * SetTask builder — evaluates expressions in the `set` object and
 * merges results into state.data. The simplest task type: pure state
 * mutation with no I/O.
 *
 * Mirrors Go's `task_builder_set.go`.
 */

import type {
  SetTaskDef,
  TaskBuilder,
  TaskExecutorFn,
} from "../types.js";
import { collectExpressions, substituteResults } from "../resolve.js";

export class SetTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: SetTaskDef;

  constructor(taskName: string, taskDef: SetTaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build(): TaskExecutorFn {
    return async (_input, state, ctx) => {
      const setObject = structuredClone(this.taskDef.set);

      const stateVars = state.getAsMap();
      const result = await ctx.evaluateExpressions(
        collectExpressions(setObject),
        null,
        stateVars,
      );

      const evaluated = substituteResults(setObject, result);

      state.addData(evaluated as Record<string, unknown>);
      return evaluated;
    };
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}
