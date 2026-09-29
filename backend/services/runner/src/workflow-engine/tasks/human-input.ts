/**
 * Human input task executor — HITL approval gate.
 *
 * Pauses workflow execution until a human reviewer responds via signal.
 * Supports configurable timeout with policies (fail, auto-approve,
 * auto-deny, escalate).
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
 *         payload: ${ $context.deployment_plan }
 *         ui_hint: deployment-plan
 *         timeout: 300
 *         on_timeout: approve
 *         outcomes:
 *           - name: approve
 *           - name: deny
 *           - name: revise
 *             then: gatherMore
 *
 * The payload (the material under review) is expression-resolved at gate
 * activation and attached to the approval_requested event — inline when
 * small, as an artifact reference when at/above the promotion threshold —
 * so the approval record captures exactly what the reviewer saw.
 *
 * Timeout policy lives here, whole. `ctx.awaitHumanInput()` only reports
 * that the timer won; this module decides what that means. approve, deny and
 * escalate resolve the gate to a declared outcome. fail logs an
 * approval_resolved with `auto_resolved` set and no outcome, then fails the
 * task with the error it has always raised, so every approval_requested in
 * the event log is closed by an approval_resolved (stigmer/stigmer#1442).
 * That emit is a new workflow command on an existing path, so it runs behind
 * {@link HUMAN_INPUT_FAIL_TIMEOUT_RESOLVED_PATCH}: a history recorded before
 * it replays the old order (no emit, then the throw).
 */

import type {
  ArtifactCreatedEvent,
  HumanInputTaskDef,
  HumanInputConfig,
  WorkflowState,
  TaskExecutionContext,
  HumanInputResult,
  HumanInputResponse,
  HumanInputTimeout,
  HumanInputTimeoutPolicy,
} from "../types.js";
import { resolveConfigExpressions, resolveEmbeddedExpressions } from "../resolve.js";
import { isStrictExpr } from "../expression-utils.js";

const SIGNAL_PREFIX = "human_input_";
const DEFAULT_TIMEOUT_SECONDS = 0;
const DEFAULT_ON_TIMEOUT = "fail" as const;

/**
 * Temporal patch id for logging approval_resolved before a fail-policy
 * timeout fails the task. Wire bytes: a rename makes every history that
 * carries the marker replay down the old path.
 */
export const HUMAN_INPUT_FAIL_TIMEOUT_RESOLVED_PATCH = "human-input-fail-timeout-resolved";

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
  const review = await resolveReviewPayload(config, taskName, state, ctx);

  const approvalRequestedAt = Date.now();

  ctx.taskStatusAccumulator?.taskWaitingApproval(taskName, config.uiHint);

  if (ctx.emitEvents) {
    await ctx.emitEvents([
      {
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
        payload: review.payload,
        uiHint: config.uiHint,
        payloadArtifactId: review.payloadArtifactId,
      },
      ...review.artifactEvents,
    ]);
  }

  const response = await ctx.awaitHumanInput({ signalName, timeoutSeconds });
  const result = isTimeout(response)
    ? resolveTimeout(onTimeout, config.outcomes)
    : response;

  if (result === undefined) {
    if (ctx.isPatched?.(HUMAN_INPUT_FAIL_TIMEOUT_RESOLVED_PATCH) ?? true) {
      await emitApprovalResolved(ctx, taskName, approvalRequestedAt, {
        outcome: "", auto_resolved: true, reason: "timeout",
      });
    }
    throw new Error(`human_input task timed out waiting for signal '${signalName}'`);
  }

  await emitApprovalResolved(ctx, taskName, approvalRequestedAt, result);

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

function isTimeout(response: HumanInputResponse): response is HumanInputTimeout {
  return "timedOut" in response;
}

/**
 * The decision a timeout policy makes, or `undefined` when the policy is
 * fail and the gate ends without one.
 *
 * With custom outcomes the proto contract (HumanInputTaskConfig.outcomes doc)
 * applies: auto-approve resolves to the FIRST declared outcome and auto-deny
 * to the LAST, so `then` routing and downstream outcome switches see declared
 * outcome names, never approve/deny words a reviewer of a custom-outcome gate
 * was never offered. Binary gates (no custom outcomes) keep plain approve/deny.
 *
 * Escalate needs no remapping by construction (stigmer/stigmer#781): its
 * policy word IS the declared outcome's name. The loader (and the server
 * validator) only accept the escalate policy when an outcome named
 * "escalate" with `then` exists, so the caller's ordinary name lookup routes
 * the escalation branch.
 */
function resolveTimeout(
  policy: HumanInputTimeoutPolicy,
  outcomes: HumanInputConfig["outcomes"],
): HumanInputResult | undefined {
  const decided = (outcome: string): HumanInputResult => ({
    outcome, auto_resolved: true, reason: "timeout",
  });
  switch (policy) {
    case "approve":
      return decided(outcomes?.length ? outcomes[0].name : "approve");
    case "deny":
      return decided(outcomes?.length ? outcomes[outcomes.length - 1].name : "deny");
    case "escalate":
      return decided("escalate");
    case "fail":
      return undefined;
    default: {
      const unreachable: never = policy;
      throw new Error(`human_input: unknown timeout policy '${String(unreachable)}'`);
    }
  }
}

/**
 * Logs how the gate's approval ended. A timeout's decision carries no
 * reviewer, no comment and `auto_resolved`; a fail timeout's carries no
 * outcome either.
 */
async function emitApprovalResolved(
  ctx: TaskExecutionContext,
  taskName: string,
  approvalRequestedAt: number,
  result: HumanInputResult,
): Promise<void> {
  if (!ctx.emitEvents) return;
  await ctx.emitEvents([{
    type: "approval_resolved",
    taskName,
    occurredAt: new Date().toISOString(),
    outcome: result.outcome,
    resolvedBy: result.reviewer ?? "",
    resolvedByActor: result.reviewer_actor,
    comment: result.comment ?? "",
    waitDurationMs: Date.now() - approvalRequestedAt,
    autoResolved: result.auto_resolved ?? false,
  }]);
}

interface ResolvedReviewPayload {
  /** Resolved payload for inline delivery on the approval_requested event. */
  readonly payload?: unknown;
  /** Artifact holding the payload when it exceeded the promotion threshold. */
  readonly payloadArtifactId?: string;
  /** artifact_created events to emit alongside approval_requested. */
  readonly artifactEvents: readonly ArtifactCreatedEvent[];
}

const NO_REVIEW_PAYLOAD: ResolvedReviewPayload = { artifactEvents: [] };

/**
 * Resolves the review payload's `${ ... }` expressions and decides how it
 * rides the approval_requested event: inline when small, or as an artifact
 * reference when at/above the promotion threshold (256KB).
 *
 * Resolution goes through `resolveConfigExpressions` for its two-phase
 * injection safety: review material resolved from `$context` (article
 * drafts, webhook data) may contain literal `${ ... }` text that must
 * never be re-evaluated as an expression.
 *
 * A resolution failure fails the task — a gate whose review material
 * failed to materialize must not present an empty review. Promotion
 * failure falls back to inline delivery (best-effort, matching the
 * do-executor's task-output promotion policy).
 */
async function resolveReviewPayload(
  config: HumanInputConfig,
  taskName: string,
  state: WorkflowState,
  ctx: TaskExecutionContext,
): Promise<ResolvedReviewPayload> {
  if (config.payload === undefined || config.payload === null) {
    return NO_REVIEW_PAYLOAD;
  }

  let resolved: unknown;
  try {
    const result = await resolveConfigExpressions(
      { payload: config.payload }, null, state, ctx.evaluateExpressions,
    );
    resolved = result.payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `human_input task '${taskName}': failed to resolve 'payload' expressions: ${message}`,
    );
  }

  // jq resolves missing paths to null rather than erroring. A configured
  // payload that materializes as nothing is an authoring error (typically a
  // wrong $context path) — fail loudly instead of presenting an empty review.
  if (resolved === undefined || resolved === null) {
    throw new Error(
      `human_input task '${taskName}': 'payload' resolved to null — ` +
      `check that the expression references existing workflow data`,
    );
  }

  if (ctx.promoteTaskOutput) {
    try {
      const promotion = await ctx.promoteTaskOutput(
        resolved,
        state.env?.__stigmer_execution_id as string ?? "",
        taskName,
        `${taskName} — review-payload.json`,
      );
      if (promotion.artifactIds.length > 0) {
        return {
          payloadArtifactId: promotion.artifactIds[0],
          artifactEvents: promotion.artifactCreatedEvents,
        };
      }
    } catch {
      // Promotion is best-effort; fall through to inline delivery.
    }
  }

  return { payload: resolved, artifactEvents: [] };
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
