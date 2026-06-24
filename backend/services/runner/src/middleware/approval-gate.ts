/**
 * Approval gate middleware for HITL (human-in-the-loop) tool approval.
 *
 * Checks each tool call against the merged approval policy. When a tool
 * requires approval, calls LangGraph `interrupt()` to pause the graph
 * at the checkpoint. The Temporal workflow then waits for the user's
 * decision via the `approvalGateResolved` signal.
 *
 * On resume, LangGraph restarts the node from the beginning. The
 * `interrupt()` call returns the user's decision (approve/skip/reject)
 * from the `Command(resume=...)` payload.
 *
 * Idempotency: Because the node restarts on resume, this middleware
 * will be invoked again for the same tool call. The `interrupt()` call
 * is idempotent — on resume it returns the decision value instead of
 * pausing again.
 *
 * Platform tool defaults: DeepAgents JS backend tools (read, write,
 * edit, execute, etc.) are not covered by MCP policy chains. Built-in tools
 * are classified through the shared {@link toolApprovalCategory} — the single
 * source of truth, shared with the Cursor deny-oracle hook — so read-only tools
 * are auto-approved and every mutating tool (write/edit/delete/shell) is gated
 * fail-CLOSED, by category rather than by a hand-maintained name list. An
 * unrecognized mutating built-in (e.g. `bash`, `overwrite_file`) is therefore
 * gated by what it does, not by whether someone remembered to list it.
 *
 * Gateway invariant (Phase 2): this middleware IS the in-process execution
 * gateway for the deep-agent harness — `handler(request)` is the side effect. A
 * side effect runs only with a backing authorization: either (a) the tool was
 * auto-approved (policy/classifier cleared it, or auto-approve-all disabled the
 * whole gate), or (b) the user explicitly approved THIS interrupted call. Every
 * other outcome — skip, reject, or an unrecognized decision — returns a
 * ToolMessage WITHOUT executing. There is no path from a model proposal to a
 * side effect that skips an authorization.
 *
 * Shadow ExecutionReceipt: when the gateway lets a side effect through it emits a
 * structured, non-persisted receipt (a `[hitl-gateway] receipt …` log carrying
 * the action's HMAC fingerprint and the authorization source). This is an audit
 * + uniformity signal only — no proto, no storage — mirroring the Phase-1 shadow
 * discipline. On the deep-agent normal path the fingerprint match is guaranteed
 * by LangGraph checkpoint replay (the resumed action equals the approved one), so
 * the receipt is defense-in-depth here; the fingerprint earns real enforcement
 * teeth in the out-of-process Cursor substrate.
 */

import { ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import type { StigmerMiddleware, ToolCallRequest } from "./types.js";
import {
  type MergedToolPolicy,
  type PolicySource,
  POLICY_ENGINE_VERSION,
  resolveApprovalMessage,
} from "../shared/approval-policy.js";
import { toolApprovalCategory, type ToolApprovalCategory } from "../shared/tool-kind.js";
import {
  computeApprovalFingerprint,
  type FingerprintKey,
} from "../shared/approval-fingerprint.js";

export interface ApprovalGateConfig {
  readonly policies: ReadonlyMap<string, MergedToolPolicy>;
  readonly autoApproveAll: boolean;
  readonly toolServerMap: ReadonlyMap<string, string>;
  /**
   * Per-execution HMAC key for the shadow receipt's action fingerprint. Derived
   * from the runner master secret + execution_id (see fingerprint-secret.ts).
   * Optional: when absent (unit tests, no-secret paths) the receipt is emitted
   * without a fingerprint rather than failing.
   */
  readonly fingerprintKey?: FingerprintKey;
  /** Execution id, carried into the shadow receipt for audit correlation. */
  readonly executionId?: string;
}

interface ApprovalDecision {
  readonly action: string;
  readonly comment?: string;
}

// Approval-message template per mutating category. Keyed by category (not raw
// tool name) so every alias of a mutation renders one message; placeholders
// resolve against the deep-agent stream arg shape (`path`/`command`). Mirrors
// the Cursor side's CATEGORY_APPROVAL_MESSAGE.
const CATEGORY_APPROVAL_MESSAGE: Record<ToolApprovalCategory, string> = {
  write: "Write file: {{args.path}}",
  delete: "Delete: {{args.path}}",
  shell: "Execute command: {{args.command}}",
};

export function createApprovalGateMiddleware(
  config: ApprovalGateConfig,
): StigmerMiddleware {
  const { policies, autoApproveAll, toolServerMap } = config;

  if (autoApproveAll) {
    return { name: "ApprovalGateMiddleware" };
  }

  return {
    name: "ApprovalGateMiddleware",

    async wrapToolCall(request: ToolCallRequest, handler) {
      const { toolCall } = request;
      const toolName = toolCall.name;
      const serverSlug = toolServerMap.get(toolName) ?? "";
      const category = toolApprovalCategory(toolName);

      const requirement = resolveToolApproval(
        toolName,
        serverSlug,
        toolCall.args,
        policies,
      );

      if (!requirement.requiresApproval) {
        // Backing authorization: the classifier/policy auto-approved this tool.
        emitExecutionReceipt(config, toolCall, serverSlug, category, "auto_approve", requirement.source);
        return await handler(request);
      }

      const approvalRequest = {
        tool_call_id: toolCall.id,
        tool_name: toolName,
        mcp_server_slug: serverSlug,
        message: requirement.message,
      };

      const response = interrupt(approvalRequest) as ApprovalDecision;

      const action = (
        typeof response === "object" && response !== null
          ? (response.action ?? "")
          : ""
      ).toString().toLowerCase();

      if (action === "approve") {
        // Backing authorization: the user approved THIS interrupted call.
        emitExecutionReceipt(config, toolCall, serverSlug, category, "approval", requirement.source);
        return await handler(request);
      }

      if (action === "skip") {
        const comment = response.comment ?? "";
        const skipMessage = comment
          ? `Tool '${toolName}' was skipped by user: ${comment}. Please proceed without this operation.`
          : `Tool '${toolName}' was skipped by user. Please proceed without this operation.`;

        return new ToolMessage({
          content: skipMessage,
          tool_call_id: toolCall.id,
          name: toolName,
        });
      }

      if (action === "reject") {
        const comment = response.comment ?? "rejected by user";
        return new ToolMessage({
          content: `Tool '${toolName}' was rejected: ${comment}. Execution will be terminated.`,
          tool_call_id: toolCall.id,
          name: toolName,
        });
      }

      return new ToolMessage({
        content: `Tool '${toolName}' approval returned unknown action: '${action}'. Treating as skip.`,
        tool_call_id: toolCall.id,
        name: toolName,
      });
    },
  };
}

interface ApprovalRequirement {
  readonly requiresApproval: boolean;
  readonly message: string;
  /** Which policy layer determined this verdict — stamped on the shadow receipt. */
  readonly source: PolicySource;
}

function resolveToolApproval(
  toolName: string,
  serverSlug: string,
  args: Record<string, unknown>,
  policies: ReadonlyMap<string, MergedToolPolicy>,
): ApprovalRequirement {
  if (serverSlug) {
    // MCP tools stay governed by the connect-flow classifier + four-level policy
    // chain. The policy map carries only the tools that REQUIRE approval, so an
    // absent entry means the classifier already auto-approved it — fail-OPEN is
    // correct here (a fail-closed default would re-gate everything the classifier
    // cleared). This is deliberately NOT changed by the built-in fail-closed flip.
    const key = `${serverSlug}/${toolName}`;
    const policy = policies.get(key);
    if (policy) {
      return {
        requiresApproval: policy.requiresApproval,
        message: resolveApprovalMessage(policy.approvalMessage, toolName, args),
        source: policy.source,
      };
    }
    // Absent = cleared by the MCP four-level chain (classifier base).
    return { requiresApproval: false, message: "", source: "classifier_default" };
  }

  // Built-in/platform tool: gate exactly the mutating categories via the shared
  // classifier. Fail-CLOSED for the mutating set — any built-in classifyTool
  // deems write/edit/delete/shell requires approval (APPROVE_ALL disables the
  // whole gate upstream in createApprovalGateMiddleware). Read-only and
  // unclassified built-ins are not mutating, so they remain fail-open. Either
  // way the built-in taxonomy is the decider, so the provenance is the same.
  const category = toolApprovalCategory(toolName);
  if (category) {
    return {
      requiresApproval: true,
      message: resolveApprovalMessage(CATEGORY_APPROVAL_MESSAGE[category], toolName, args),
      source: "builtin_category",
    };
  }

  return { requiresApproval: false, message: "", source: "builtin_category" };
}

type AuthorizationSource = "auto_approve" | "approval";

/**
 * Emit the shadow ExecutionReceipt when the gateway authorizes a side effect.
 *
 * Scope: only side-effecting actions are recorded — a mutating built-in (a
 * non-empty {@link ToolApprovalCategory}) or any MCP tool (`serverSlug` present).
 * Read-only built-ins are not side effects, so recording them would only dilute
 * the signal. The receipt is a structured log carrying the action's HMAC
 * fingerprint and the authorization source; it is never persisted and crosses no
 * wire (no proto). The fingerprint is omitted (empty) when no per-execution key
 * was supplied (tests / no-secret paths).
 */
function emitExecutionReceipt(
  config: ApprovalGateConfig,
  toolCall: { id: string; name: string; args: Record<string, unknown> },
  serverSlug: string,
  category: ToolApprovalCategory | undefined,
  source: AuthorizationSource,
  policySource: PolicySource,
): void {
  if (!category && !serverSlug) return;

  const fingerprint = config.fingerprintKey
    ? computeApprovalFingerprint(config.fingerprintKey, {
        toolName: toolCall.name,
        mcpServerSlug: serverSlug,
        args: toolCall.args,
      })
    : "";

  console.log(
    "[hitl-gateway] receipt " +
    JSON.stringify({
      executionId: config.executionId ?? "",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      mcpServerSlug: serverSlug,
      category: category ?? "",
      authorization: source,
      policySource,
      policyEngineVersion: POLICY_ENGINE_VERSION,
      fingerprint,
      substrate: "deep-agent",
    }),
  );
}
