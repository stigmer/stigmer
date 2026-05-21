/**
 * Human input task executor — HITL approval gate.
 *
 * Pauses workflow execution until a human reviewer responds via signal.
 * Supports configurable timeout with policies (fail, auto-approve, auto-deny).
 *
 * The kernel validates the config and delegates to `ctx.awaitHumanInput()`
 * which is wired to the Temporal workflow layer's signal/timer selector.
 *
 * YAML shape (via loader reclassification from call: human_input):
 *   - requireApproval:
 *       call: human_input
 *       with:
 *         prompt: "Please review this deployment"
 *         timeout: 300
 *         on_timeout: approve
 *         outcomes:
 *           - name: approve
 *           - name: deny
 */

import type {
  HumanInputTaskDef,
  HumanInputConfig,
  WorkflowState,
  TaskExecutionContext,
  HumanInputResult,
} from "../types.js";

const SIGNAL_PREFIX = "human_input_";
const DEFAULT_TIMEOUT_SECONDS = 0;
const DEFAULT_ON_TIMEOUT = "fail" as const;

/**
 * Executes a human_input task. Called from `runSingleTask` in do-executor
 * when the task kind is "human_input".
 */
export async function executeHumanInputTask(
  taskDef: HumanInputTaskDef,
  taskName: string,
  state: WorkflowState,
  ctx: TaskExecutionContext,
): Promise<unknown> {
  const config = taskDef.humanInput;
  validateConfig(config, taskName);

  const signalName = SIGNAL_PREFIX + taskName;
  const timeoutSeconds = config.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  const onTimeout = config.onTimeout ?? DEFAULT_ON_TIMEOUT;

  const approvalRequestedAt = Date.now();

  if (ctx.emitEvents) {
    await ctx.emitEvents([{
      type: "approval_requested",
      taskName,
      occurredAt: new Date().toISOString(),
      prompt: config.prompt,
      approvers: config.approvers ?? [],
      timeoutSeconds,
      outcomes: (config.outcomes ?? []).map((o) => ({
        name: o.name,
        label: o.label ?? "",
      })),
      formSchema: config.formSchema,
    }]);
  }

  const result: HumanInputResult = await ctx.awaitHumanInput({
    signalName,
    timeoutSeconds,
    onTimeout,
  });

  if (ctx.emitEvents) {
    await ctx.emitEvents([{
      type: "approval_resolved",
      taskName,
      occurredAt: new Date().toISOString(),
      outcome: result.outcome,
      resolvedBy: result.reviewer ?? "",
      comment: "",
      waitDurationMs: Date.now() - approvalRequestedAt,
      autoResolved: result.auto_resolved ?? false,
    }]);
  }

  state.addData({ [taskName]: result });

  return result;
}

function validateConfig(config: HumanInputConfig, taskName: string): void {
  if (!config.prompt) {
    throw new Error(`human_input task '${taskName}': 'prompt' is required`);
  }
}
