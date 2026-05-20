/**
 * SwitchTask builder — evaluates `when` conditions sequentially and
 * returns the matching case's `then` flow directive. A switch with
 * no `when` clause acts as the default case.
 *
 * The switch task does not produce output — it only controls flow
 * by setting the `then` directive on the task base, which the
 * DoTask executor reads to determine the next task.
 *
 * Mirrors Go's `task_builder_switch.go`.
 */

import type {
  SwitchTaskDef,
  TaskBuilder,
  TaskExecutorFn,
  FlowDirective,
} from "../types.js";
import { isTermination } from "../types.js";

export class SwitchTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: SwitchTaskDef;

  constructor(taskName: string, taskDef: SwitchTaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
    this.validateNoDuplicateDefaults();
  }

  build(): TaskExecutorFn {
    return async (_input, state, ctx) => {
      const stateVars = state.getAsMap();

      for (const switchCase of this.taskDef.switch) {
        if (switchCase.when === undefined) {
          return { __flow_directive__: switchCase.then } as unknown;
        }

        const whenExpr = switchCase.when;
        const result = await ctx.evaluateExpressions(
          { condition: whenExpr.startsWith("${ ") ? whenExpr.slice(3, -2) : whenExpr },
          null,
          stateVars,
        );

        const conditionResult = result.condition;
        if (isTruthy(conditionResult)) {
          if (isTermination(switchCase.then)) {
            return { __flow_directive__: switchCase.then } as unknown;
          }
          return { __flow_directive__: switchCase.then } as unknown;
        }
      }

      return null;
    };
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }

  private validateNoDuplicateDefaults(): void {
    let defaultCount = 0;
    for (const switchCase of this.taskDef.switch) {
      if (switchCase.when === undefined) {
        defaultCount++;
      }
    }
    if (defaultCount > 1) {
      throw new Error(
        `Switch task '${this.taskName}' has ${defaultCount} default cases (no 'when'). At most one is allowed.`,
      );
    }
  }
}

/**
 * Extracts the flow directive from a switch task's output.
 * Returns undefined if the output doesn't contain a directive.
 */
export function extractFlowDirective(
  output: unknown,
): FlowDirective | undefined {
  if (
    output !== null &&
    typeof output === "object" &&
    "__flow_directive__" in (output as Record<string, unknown>)
  ) {
    return (output as Record<string, unknown>).__flow_directive__ as FlowDirective;
  }
  return undefined;
}

function isTruthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toUpperCase() === "TRUE" || value === "1";
  }
  return false;
}
