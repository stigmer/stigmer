/**
 * Task builder factory — creates the appropriate TaskBuilder for a
 * given task definition based on the `kind` discriminator.
 *
 * Phase 1 supports: set, switch, do (nested).
 * Future phases add: for, fork, try, wait, listen, raise,
 * call:http, call:grpc, call:function, run.
 *
 * Mirrors Go's `NewTaskBuilder` type switch in `task_builder.go`.
 */

import type { TaskDef, TaskBuilder, WorkflowModel } from "./types.js";
import { SetTaskBuilder } from "./tasks/set.js";
import { SwitchTaskBuilder } from "./tasks/switch.js";

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
      // DoTask is handled inline by the executor — it recursively
      // calls executeDoTasks. We return a placeholder builder that
      // the executor recognizes and handles specially.
      return new DoTaskPlaceholderBuilder(taskName, taskDef);
    default:
      throw new Error(
        `Unsupported task type '${(taskDef as TaskDef).kind}' for task '${taskName}'. ` +
        `Phase 1 supports: set, switch, do. Other types will be added in later phases.`,
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
