/**
 * CallFunction task builder — handles Stigmer extension call types:
 * `call: llm`, `call: agent`, `call: transform`, etc.
 *
 * The CNCF DSL uses `call: <string>` for custom function calls.
 * This builder evaluates expressions in the `with` config, then
 * delegates to the `ctx.callFunction` callback which routes to
 * the appropriate Temporal activity based on the `call` value.
 *
 * Mirrors Go's custom call function dispatch in `task_builder.go`.
 */

import type {
  CallFunctionTaskDef,
  TaskBuilder,
  TaskExecutorFn,
} from "../types.js";
import { resolveConfigExpressions } from "../resolve.js";

export class CallFunctionTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: CallFunctionTaskDef;

  constructor(taskName: string, taskDef: CallFunctionTaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build(): TaskExecutorFn {
    return async (input, state, ctx) => {
      const withConfig = this.taskDef.with ?? {};

      const resolved = await resolveConfigExpressions(
        withConfig as Record<string, unknown>,
        input,
        state,
        ctx.evaluateExpressions,
      );

      const result = await ctx.callFunction(
        this.taskDef.call,
        resolved,
        state.env,
        {
          workflowExecutionId: ctx.doc.document.name,
        },
      );

      return result;
    };
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}
