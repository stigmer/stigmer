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
 * edit, execute, etc.) are not covered by MCP policy chains. This
 * middleware applies sensible defaults: read-only tools are auto-approved,
 * mutating tools require approval when no explicit policy exists.
 */

import { ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import type { StigmerMiddleware, ToolCallRequest } from "./types.js";
import {
  type MergedToolPolicy,
  resolveApprovalMessage,
} from "../shared/approval-policy.js";

export interface ApprovalGateConfig {
  readonly policies: ReadonlyMap<string, MergedToolPolicy>;
  readonly autoApproveAll: boolean;
  readonly toolServerMap: ReadonlyMap<string, string>;
}

interface ApprovalDecision {
  readonly action: string;
  readonly comment?: string;
}

const SAFE_PLATFORM_TOOLS = new Set([
  "read", "read_file",
  "ls", "list_directory",
  "glob", "find_files",
  "grep", "search", "ripgrep",
  "think",
]);

const DANGEROUS_PLATFORM_TOOLS = new Map<string, string>([
  ["write", "Write file: {{args.path}}"],
  ["write_file", "Write file: {{args.path}}"],
  ["edit", "Edit file: {{args.path}}"],
  ["edit_file", "Edit file: {{args.path}}"],
  ["create", "Create file: {{args.path}}"],
  ["create_file", "Create file: {{args.path}}"],
  ["delete", "Delete: {{args.path}}"],
  ["delete_file", "Delete file: {{args.path}}"],
  ["execute", "Execute command: {{args.command}}"],
  ["shell", "Execute shell command: {{args.command}}"],
  ["str_replace_editor", "Edit file: {{args.path}}"],
]);

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

      const requirement = resolveToolApproval(
        toolName,
        serverSlug,
        toolCall.args,
        policies,
      );

      if (!requirement.requiresApproval) {
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
}

function resolveToolApproval(
  toolName: string,
  serverSlug: string,
  args: Record<string, unknown>,
  policies: ReadonlyMap<string, MergedToolPolicy>,
): ApprovalRequirement {
  if (serverSlug) {
    const key = `${serverSlug}/${toolName}`;
    const policy = policies.get(key);
    if (policy) {
      return {
        requiresApproval: policy.requiresApproval,
        message: resolveApprovalMessage(policy.approvalMessage, toolName, args),
      };
    }
    return { requiresApproval: false, message: "" };
  }

  if (SAFE_PLATFORM_TOOLS.has(toolName)) {
    return { requiresApproval: false, message: "" };
  }

  const dangerousTemplate = DANGEROUS_PLATFORM_TOOLS.get(toolName);
  if (dangerousTemplate) {
    return {
      requiresApproval: true,
      message: resolveApprovalMessage(dangerousTemplate, toolName, args),
    };
  }

  return { requiresApproval: false, message: "" };
}
