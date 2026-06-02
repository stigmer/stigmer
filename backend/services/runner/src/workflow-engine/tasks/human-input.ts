/**
 * Human input task executor — HITL approval gate.
 *
 * Pauses workflow execution until a human reviewer responds via signal.
 * Supports configurable timeout with policies (fail, auto-approve, auto-deny).
 *
 * The kernel validates the config and delegates to `ctx.awaitHumanInput()`
 * which is wired to the Temporal workflow layer's signal/timer selector.
 *
 * Outcome routing: when an outcome defines a `then` field (e.g.,
 * `then: "gatherMore"`), the returned output includes a
 * `__flow_directive__` that the do-executor uses to jump to the
 * named task — the same mechanism used by switch and validate tasks.
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
 *           - name: revise
 *             then: gatherMore
 */

import type {
  HumanInputTaskDef,
  HumanInputConfig,
  WorkflowState,
  TaskExecutionContext,
  HumanInputResult,
} from "../types.js";
import { resolveEmbeddedExpressions } from "../resolve.js";
import { isStrictExpr } from "../expression-utils.js";

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

  const resolvedPrompt = await resolvePromptExpressions(
    config.prompt, state, ctx,
  );

  const approvalRequestedAt = Date.now();

  ctx.taskStatusAccumulator?.taskWaitingApproval(taskName);

  if (ctx.emitEvents) {
    await ctx.emitEvents([{
      type: "approval_requested",
      taskName,
      occurredAt: new Date().toISOString(),
      prompt: resolvedPrompt,
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

  const selectedOutcome = config.outcomes?.find(o => o.name === result.outcome);
  if (selectedOutcome?.then) {
    return { ...result, __flow_directive__: selectedOutcome.then };
  }

  return result;
}

function validateConfig(config: HumanInputConfig, taskName: string): void {
  if (!config.prompt) {
    throw new Error(`human_input task '${taskName}': 'prompt' is required`);
  }
}

/**
 * Resolves `${ ... }` expressions in the prompt string against the
 * current workflow state. Handles both strict (whole-value) and embedded
 * (inline fragment) expression patterns.
 */
async function resolvePromptExpressions(
  prompt: string,
  state: WorkflowState,
  ctx: TaskExecutionContext,
): Promise<string> {
  const stateVars = state.getAsMap();

  // Strict expression: entire prompt is a single expression
  if (isStrictExpr(prompt)) {
    const expr = prompt.slice(3, -2);
    const results = await ctx.evaluateExpressions(
      { __prompt__: expr }, null, stateVars,
    );
    const resolved = results.__prompt__;
    return typeof resolved === "string" ? resolved : JSON.stringify(resolved ?? "");
  }

  // Embedded expressions: inline `${ ... }` fragments within the prompt text
  const wrapper = { prompt };
  await resolveEmbeddedExpressions(
    wrapper, null, stateVars, ctx.evaluateExpressions,
  );
  return wrapper.prompt;
}
