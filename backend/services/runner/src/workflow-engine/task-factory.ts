/**
 * Task builder factory — creates the appropriate TaskBuilder for a
 * given task definition based on the `kind` discriminator.
 *
 * Phases 1–2: set, switch, do (nested), for (iteration).
 * Phase 4: call:http, call:grpc, call:function (llm, agent, etc.).
 *
 * Mirrors Go's `NewTaskBuilder` type switch in `task_builder.go`.
 */

import type { TaskDef, TaskBuilder, WorkflowModel } from "./types.js";
import { SetTaskBuilder } from "./tasks/set.js";
import { SwitchTaskBuilder } from "./tasks/switch.js";
import { ForTaskPlaceholderBuilder } from "./tasks/for.js";
import { CallHttpTaskBuilder } from "./tasks/call-http.js";
import { CallGrpcTaskBuilder } from "./tasks/call-grpc.js";
import { CallFunctionTaskBuilder } from "./tasks/call-function.js";

export function createTaskBuilder(
  taskName: string,
  taskDef: TaskDef,
  _doc: WorkflowModel,
): TaskBuilder {
  switch (taskDef.kind) {
    case "set":
      return new SetTaskBuilder(taskName, taskDef);
    case "switch":
      return new SwitchTaskBuilder(taskName, taskDef);
    case "do":
      return new DoTaskPlaceholderBuilder(taskName, taskDef);
    case "for":
      return new ForTaskPlaceholderBuilder(taskName, taskDef);
    case "call:http":
      return new CallHttpTaskBuilder(taskName, taskDef);
    case "call:grpc":
      return new CallGrpcTaskBuilder(taskName, taskDef);
    case "call:function":
      return new CallFunctionTaskBuilder(taskName, taskDef);
    default:
      throw new Error(
        `Unsupported task type '${(taskDef as TaskDef).kind}' for task '${taskName}'. ` +
        `Supported: set, switch, do, for, call:http, call:grpc, call:function. ` +
        `Other types will be added in later phases.`,
      );
  }
}

/**
 * Placeholder builder for nested `do` tasks. The actual execution
 * is handled by the DoTask executor via recursion — this builder
 * exists only to satisfy the TaskBuilder interface in the task list.
 */
class DoTaskPlaceholderBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: TaskDef;

  constructor(taskName: string, taskDef: TaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build() {
    return async () => {
      throw new Error(
        `DoTaskPlaceholderBuilder.build() should never be called directly. ` +
        `The executor handles 'do' tasks via recursion.`,
      );
    };
  }

  async shouldRun() {
    return true;
  }
}

export const DO_TASK_KIND = "do" as const;
export const FOR_TASK_KIND = "for" as const;
