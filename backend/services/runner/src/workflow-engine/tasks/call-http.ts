/**
 * CallHTTP task builder — evaluates expressions in the HTTP call
 * config, then delegates the actual HTTP request to a Temporal
 * activity via the `ctx.callHttp` callback.
 *
 * Mirrors Go's `task_builder_call_http.go` workflow-side logic.
 *
 * Two-phase evaluation:
 * 1. Here (workflow): resolve `${ $context.field }` jq expressions
 * 2. Activity: resolve `${.secrets.KEY}` runtime placeholders
 */

import type {
  CallHttpTaskDef,
  HttpCallConfig,
  TaskBuilder,
  TaskExecutorFn,
} from "../types.js";
import { resolveConfigExpressions } from "../resolve.js";

export class CallHttpTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: CallHttpTaskDef;

  constructor(taskName: string, taskDef: CallHttpTaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build(): TaskExecutorFn {
    return async (input, state, ctx) => {
      const resolved = await resolveConfigExpressions(
        this.taskDef.with as unknown as Record<string, unknown>,
        input,
        state,
        ctx.evaluateExpressions,
      );

      const result = await ctx.callHttp(
        resolved as unknown as HttpCallConfig,
        state.env,
      );

      return result;
    };
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}
