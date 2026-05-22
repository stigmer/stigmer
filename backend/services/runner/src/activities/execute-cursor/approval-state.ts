/**
 * Approval state management for the hook-deny + reinvoke HITL model.
 *
 * Before starting a Cursor Agent run, the cursor-runner writes a state file
 * to the workspace. The preToolUse hook script reads this file to decide
 * whether to allow or deny each tool call.
 *
 * State file format (JSON):
 * {
 *   "autoApproveAll": false,
 *   "builtInAllowList": ["Read", "Grep", ...],
 *   "mcpToolPolicies": {
 *     "apply_cloud_resource": { "requiresApproval": true, "message": "..." },
 *     "search_services": { "requiresApproval": false }
 *   },
 *   "approvedToolCallIds": ["toolu_abc123"]
 * }
 *
 * On first invocation: approvedToolCallIds is empty (tools needing approval
 * are denied). On reinvocation after approval: contains the IDs of approved
 * tool calls so the hook allows them through on retry.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { MergedToolPolicy } from "./approval-policy.js";
import { getBuiltInAllowList } from "./approval-policy.js";

export interface McpToolPolicyEntry {
  requiresApproval: boolean;
  message?: string;
}

export interface ApprovalStateFile {
  autoApproveAll: boolean;
  builtInAllowList: string[];
  mcpToolPolicies: Record<string, McpToolPolicyEntry>;
  approvedToolCallIds: string[];
}

/**
 * Build the approval state file content from merged policies and
 * any approval decisions from a previous HITL cycle.
 *
 * The state file drives the hook script's allow/deny decisions:
 * - builtInAllowList: Cursor built-in tools that are always allowed
 * - mcpToolPolicies: per-tool policy for MCP tools (keyed by tool name)
 * - approvedToolCallIds: tool call IDs approved in the current HITL cycle
 */
export function buildApprovalState(
  mergedPolicies: Map<string, MergedToolPolicy>,
  autoApproveAll: boolean,
  decisions?: Map<string, ApprovalAction>,
): ApprovalStateFile {
  const approvedToolCallIds: string[] = [];

  if (decisions) {
    for (const [toolCallId, action] of decisions) {
      if (action === ApprovalAction.APPROVE) {
        approvedToolCallIds.push(toolCallId);
      }
    }
  }

  const mcpToolPolicies: Record<string, McpToolPolicyEntry> = {};
  for (const policy of mergedPolicies.values()) {
    mcpToolPolicies[policy.toolName] = {
      requiresApproval: policy.requiresApproval,
      message: policy.approvalMessage,
    };
  }

  return {
    autoApproveAll,
    builtInAllowList: getBuiltInAllowList(),
    mcpToolPolicies,
    approvedToolCallIds,
  };
}

const STATE_FILE_DIR = ".cursor/hooks";
const STATE_FILE_NAME = "stigmer-approval-state.json";

/**
 * Write the approval state file to the workspace for the hook script to read.
 */
export async function writeApprovalStateFile(
  workspaceRoot: string,
  state: ApprovalStateFile,
): Promise<string> {
  const dir = join(workspaceRoot, STATE_FILE_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, STATE_FILE_NAME);
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
  return filePath;
}
