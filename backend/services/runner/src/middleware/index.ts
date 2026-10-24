/**
 * Middleware stack factory for the native harness's root graph.
 *
 * Assembles the ordered middleware array from a MiddlewareStackConfig. The
 * order is load-bearing and reads top to bottom:
 *
 *   -. Turn boundary (whenever the turn's signals are given, which every
 *      turn does — FIRST, so no other model wrapper runs for a call the
 *      turn's stop or yield refuses, `turn-boundary.ts`)
 *   0. Path normalization (whenever configured, which every graph does
 *      since issue #754 — FIRST, so every downstream middleware observes
 *      canonical workspace-absolute paths)
 *   1. Loop detection (always)
 *   2. Execution budget (always — counts tool rounds, advises at ~80% of
 *      `max_tool_rounds` and ends the turn at it)
 *   2a. Shell (conditional: only on a graph whose backend runs a shell —
 *      the model sees the runner's `execute` schema and every `execute`
 *      call runs the runner's tool, `shell.ts`; right before tool intent,
 *      so that extends this declaration, and outside the scope, gate and
 *      truncation, so they see the call and its result as before)
 *   2b. Background commands (with the shell, wherever commands can run in
 *      the background — tells the agent when one ends and holds a round's
 *      end while they run, `background-commands.ts`; registered after the
 *      parent's turn-input middleware, which rides ahead of this stack, so
 *      its round-end hook runs before that one's)
 *   3. Tool intent (always — bind-time shell schema extension, issue #276)
 *   3a. Folder instructions (conditional: only on a graph whose tool scope
 *      may read the workspace — a folder's own `AGENTS.md` rides the first
 *      read beneath it, `folder-instructions.ts`; right outside truncation,
 *      so the notes are never cut, each bounded on its own)
 *   4. Tool truncation (always — a long result keeps its start and its end,
 *      the whole of it kept in the session's offload directory through the
 *      graph's backend, `tool-truncation.ts`)
 *   5. Tool scope (conditional: only when the agent's scope carries a list —
 *      hides and refuses what the agent's tool lists exclude; AHEAD of the
 *      gate, so a listed-out call never reaches an approval card, and
 *      independent of it, so the lists bind under the global bypass too)
 *   6. Approval gate (conditional: absent under the global bypass)
 *   7. Cost advisory (conditional: only when maxCostUsd > 0 — advises at
 *      ~80% of the cap that the turn runtime enforces)
 *   8. Error hints (always)
 *   9. OTel spans (always, no-op when OTel not configured)
 *  10. Model retry (always — LAST, so a reply that failed after it began
 *      is tried again without re-running any Stigmer bookkeeping above it,
 *      and one span covers the call's attempts, `model-retry.ts`)
 *
 * Every middleware here either shapes the graph's tool surface or ADVISES
 * the model, but the model retry, which only calls the model again when its
 * reply failed for a passing reason. Advising has one channel, `advisory-message.ts`: a user-role
 * message after the latest tool results of the next model request, never a
 * system message and never written to the graph's state (stigmer/stigmer#1354).
 * None of them decides to stop the run, except the execution budget, which
 * is `max_tool_rounds`' own enforcement: it ends the turn as the adapter's
 * `tool_call_limit` outcome, the job LangGraph's recursion limit held until
 * #1113, so the runtime sees it as an outcome and never as a completion.
 * Every other stop — the platform's, the cost cap's, a stall's, a drain's —
 * is the turn runtime's, delivered to the graph through its abort signal
 * (since #1096; until then a graceful-stop middleware and the cost cap's
 * tool block were second stops inside the graph that the runtime could not
 * see) and taken at the next model call by the turn boundary, which only
 * carries the runtime's signals in.
 *
 * Ahead of this stack the parent graph adds the framework's to-do list
 * middleware (`execute-deep-agent/turn-setup.ts`): it is langchain's, not
 * Stigmer's, and only the parent carries it.
 *
 * The sub-agent stack is `execute-deep-agent/subagent-wiring.ts`'s: the same
 * order over the parent's shared instances where one exists (the advisory's
 * running total), fresh ones otherwise.
 */

import type { StigmerMiddleware, MiddlewareStackConfig } from "./types.js";
import { createPathNormalizationMiddleware } from "./path-normalization.js";
import { createLoopDetectionMiddleware } from "./loop-detection.js";
import { createExecutionBudgetMiddleware } from "./execution-budget.js";
import { createToolIntentMiddleware } from "./tool-intent.js";
import { createShellMiddleware } from "./shell.js";
import { createBackgroundCommandsMiddleware } from "./background-commands.js";
import { createToolTruncationMiddleware } from "./tool-truncation.js";
import { createFolderInstructionsMiddleware } from "./folder-instructions.js";
import { createApprovalGateMiddleware } from "./approval-gate.js";
import { createToolScopeMiddleware } from "./tool-scope.js";
import { createCostAdvisoryMiddleware, type CostAdvisoryMiddleware } from "./cost-advisory.js";
import { createErrorHintsMiddleware } from "./error-hints.js";
import { createOtelSpansMiddleware } from "./otel-spans.js";
import { createTurnBoundaryMiddleware } from "./turn-boundary.js";
import { createModelRetryMiddleware } from "./model-retry.js";

export type { CostAdvisoryMiddleware } from "./cost-advisory.js";
export type { StigmerMiddleware, MiddlewareStackConfig } from "./types.js";

export interface MiddlewareStackResult {
  readonly middleware: StigmerMiddleware[];
  /** The advisory's instance, for the sub-agent stacks to share its running total; null when no cap is configured. */
  readonly costAdvisory: CostAdvisoryMiddleware | null;
}

export function buildMiddlewareStack(
  config: MiddlewareStackConfig = {},
): MiddlewareStackResult {
  const stack: StigmerMiddleware[] = [];

  if (config.turnBoundary) {
    stack.push(createTurnBoundaryMiddleware(config.turnBoundary, "root"));
  }

  if (config.pathNormalization) {
    stack.push(createPathNormalizationMiddleware(config.pathNormalization));
  }

  stack.push(createLoopDetectionMiddleware(config.loopDetection));
  stack.push(createExecutionBudgetMiddleware(config.executionBudget));
  if (config.shell) stack.push(createShellMiddleware(config.shell));
  if (config.shell?.background) {
    stack.push(createBackgroundCommandsMiddleware({
      ...config.shell.background,
      scope: "root",
      ...(config.turnBoundary ? { signals: config.turnBoundary } : {}),
      ...(config.turnInput ? { input: config.turnInput } : {}),
      ...(config.toolTruncation?.maxChars !== undefined ? { maxNoticeChars: config.toolTruncation.maxChars } : {}),
    }));
  }
  stack.push(createToolIntentMiddleware());
  if (config.folderInstructions) stack.push(createFolderInstructionsMiddleware(config.folderInstructions));
  stack.push(createToolTruncationMiddleware(config.toolTruncation));

  if (config.toolScope?.scope.restricted) {
    stack.push(createToolScopeMiddleware(config.toolScope));
  }

  if (config.approvalGate) {
    stack.push(createApprovalGateMiddleware(config.approvalGate));
  }

  const costAdvisory =
    config.costAdvisory && config.costAdvisory.maxCostUsd > 0
      ? createCostAdvisoryMiddleware(config.costAdvisory)
      : null;
  if (costAdvisory) stack.push(costAdvisory);

  stack.push(createErrorHintsMiddleware());
  stack.push(createOtelSpansMiddleware(config.otelSpans));
  stack.push(createModelRetryMiddleware());

  return { middleware: stack, costAdvisory };
}
