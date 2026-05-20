/**
 * Task builder factory — creates the appropriate TaskBuilder for a
 * given task definition based on the `kind` discriminator.
 *
 * Phases 1–2: set, switch, do (nested), for (iteration).
 * Phase 4: call:http, call:grpc, call:function (llm, etc.).
 * Phase 4b: call:agent (async completion, HITL signals).
 * Phase 5.1: raise (error throwing), try (placeholder — execution in do-executor).
 * Phase 5.2: fork (parallel branches — execution in do-executor).
 *
 * Mirrors Go's `NewTaskBuilder` type switch in `task_builder.go`.
 */

import type { TaskDef, TaskBuilder, WorkflowModel } from "./types.js";
import { SetTaskBuilder } from "./tasks/set.js";
import { SwitchTaskBuilder } from "./tasks/switch.js";
import { ForTaskPlaceholderBuilder } from "./tasks/for.js";
import { ForkTaskPlaceholderBuilder } from "./tasks/fork.js";
import { TryTaskPlaceholderBuilder } from "./tasks/try.js";
import { RaiseTaskBuilder } from "./tasks/raise.js";
import { CallHttpTaskBuilder } from "./tasks/call-http.js";
import { CallGrpcTaskBuilder } from "./tasks/call-grpc.js";
import { CallAgentTaskBuilder } from "./tasks/call-agent.js";
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
    case "fork":
      return new ForkTaskPlaceholderBuilder(taskName, taskDef);
    case "try":
      return new TryTaskPlaceholderBuilder(taskName, taskDef);
    case "raise":
      return new RaiseTaskBuilder(taskName, taskDef);
    case "call:http":
      return new CallHttpTaskBuilder(taskName, taskDef);
    case "call:grpc":
      return new CallGrpcTaskBuilder(taskName, taskDef);
    case "call:agent":
      return new CallAgentTaskBuilder(taskName, taskDef);
    case "call:function":
      return new CallFunctionTaskBuilder(taskName, taskDef);
    default:
      throw new Error(
        `Unsupported task type '${(taskDef as TaskDef).kind}' for task '${taskName}'. ` +
        `Supported: set, switch, do, for, fork, try, raise, call:http, call:grpc, call:agent, call:function. ` +
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
export const FORK_TASK_KIND = "fork" as const;
export const TRY_TASK_KIND = "try" as const;
