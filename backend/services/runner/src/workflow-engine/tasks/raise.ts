/**
 * RaiseTask builder — throws a typed WorkflowError from a YAML
 * error definition. Supports expression evaluation in `title`
 * and `detail` fields via jq.
 *
 * Mirrors Go's `RaiseTaskBuilder` in `task_builder_raise.go`.
 * The `raise` task is the deliberate error-throwing companion
 * to `try/catch` — it lets workflow authors produce structured
 * errors that catch blocks can filter and inspect.
 */

import type {
  RaiseTaskDef,
  TaskBuilder,
  TaskExecutorFn,
} from "../types.js";
import { WorkflowError } from "../errors.js";

export class RaiseTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: RaiseTaskDef;

  constructor(taskName: string, taskDef: RaiseTaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build(): TaskExecutorFn {
    return async (_input, state, ctx) => {
      const errorDef = this.taskDef.raise.error;

      let title = errorDef.title ?? "";
      let detail = errorDef.detail ?? "";

      const expressions: Record<string, string> = {};

      if (isExpression(title)) {
        expressions.__raise_title__ = unwrapExpression(title);
      }
      if (isExpression(detail)) {
        expressions.__raise_detail__ = unwrapExpression(detail);
      }

      if (Object.keys(expressions).length > 0) {
        const stateVars = state.getAsMap();
        const results = await ctx.evaluateExpressions(
          expressions,
          null,
          stateVars,
        );

        if ("__raise_title__" in results) {
          title = String(results.__raise_title__ ?? "");
        }
        if ("__raise_detail__" in results) {
          detail = String(results.__raise_detail__ ?? "");
        }
      }

      throw new WorkflowError({
        type: errorDef.type,
        status: errorDef.status,
        title,
        detail,
        instance: errorDef.instance,
      });
    };
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}

function isExpression(value: string): boolean {
  return value.startsWith("${ ") && value.endsWith(" }");
}

function unwrapExpression(value: string): string {
  return value.slice(3, -2);
}
