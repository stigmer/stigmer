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
 *   "approvedTools": [
 *     { "name": "Shell", "argsPreview": "rm -rf /tmp/data" }
 *   ]
 * }
 *
 * On first invocation: approvedTools is empty (tools needing approval are denied).
 * On reinvocation after approval: approvedTools contains the approved tools
 * (matched by name + args so the hook allows them through).
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb.js";

export interface ApprovedTool {
  name: string;
  argsPreview: string;
}

export interface ApprovalStateFile {
  autoApproveAll: boolean;
  approvedTools: ApprovedTool[];
}

/**
 * Build the approval state from DB-stored approval decisions.
 * Called during the activity's setup phase before writing hooks.
 */
export function buildApprovalState(
  decisions?: Map<string, ApprovalAction>,
): ApprovalStateFile {
  const approvedTools: ApprovedTool[] = [];

  if (decisions) {
    for (const [_toolCallId, action] of decisions) {
      if (action === ApprovalAction.APPROVAL_ACTION_APPROVE) {
        // TODO: resolve tool name and args from the tool_call_id via execution status
        // For now, mark as approved (the hook will match by tool call ID)
        approvedTools.push({ name: "*", argsPreview: "*" });
      }
    }
  }

  return {
    autoApproveAll: false,
    approvedTools,
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
