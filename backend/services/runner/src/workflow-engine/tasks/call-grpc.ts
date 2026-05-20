/**
 * CallGRPC task builder — evaluates expressions in the gRPC call
 * config, then delegates the actual RPC to a Temporal activity
 * via the `ctx.callGrpc` callback.
 *
 * Mirrors Go's `task_builder_call_grpc.go` workflow-side logic.
 */

import type {
  CallGrpcTaskDef,
  GrpcCallConfig,
  TaskBuilder,
  TaskExecutorFn,
} from "../types.js";
import { resolveConfigExpressions } from "../resolve.js";

export class CallGrpcTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: CallGrpcTaskDef;

  constructor(taskName: string, taskDef: CallGrpcTaskDef) {
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

      const result = await ctx.callGrpc(
        resolved as unknown as GrpcCallConfig,
        state.env,
      );

      return result;
    };
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}
