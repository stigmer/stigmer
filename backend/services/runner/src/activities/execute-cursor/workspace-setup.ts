/**
 * Writes Cursor hooks configuration and scripts to the workspace.
 *
 * Before creating or resuming a Cursor Agent, the cursor-runner writes:
 * 1. .cursor/hooks.json — declares the preToolUse hook
 * 2. .cursor/hooks/stigmer-approval.sh — the hook script
 * 3. .cursor/hooks/stigmer-approval-state.json — approval state for the hook
 *
 * This setup enables the durable HITL model: the hook denies tools that
 * need approval, the activity captures the denied calls and returns to
 * the workflow, and on reinvocation the state file is updated with the
 * approved tools so the hook allows them.
 */

import { writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { generateHookScript } from "./hook-script.js";
import { writeApprovalStateFile, type ApprovalStateFile } from "./approval-state.js";

const HOOKS_DIR = ".cursor";
const HOOKS_SCRIPTS_DIR = ".cursor/hooks";
const HOOKS_CONFIG_FILE = "hooks.json";
const HOOK_SCRIPT_FILE = "stigmer-approval.sh";

/**
 * Write the complete hooks setup to the workspace directory.
 *
 * Creates or overwrites:
 * - .cursor/hooks.json (hooks configuration)
 * - .cursor/hooks/stigmer-approval.sh (hook script, executable)
 * - .cursor/hooks/stigmer-approval-state.json (approval state)
 */
export async function writeHooksToWorkspace(
  workspaceRoot: string,
  approvalState: ApprovalStateFile,
): Promise<void> {
  const hooksDir = join(workspaceRoot, HOOKS_DIR);
  const scriptsDir = join(workspaceRoot, HOOKS_SCRIPTS_DIR);
  await mkdir(hooksDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });

  const stateFilePath = await writeApprovalStateFile(workspaceRoot, approvalState);

  const hookScriptPath = join(scriptsDir, HOOK_SCRIPT_FILE);
  await writeFile(hookScriptPath, generateHookScript(stateFilePath), "utf-8");
  await chmod(hookScriptPath, 0o755);

  const hooksConfig = {
    version: 1,
    hooks: {
      preToolUse: [
        {
          command: `.cursor/hooks/${HOOK_SCRIPT_FILE}`,
          timeout: 10,
          failClosed: true,
        },
      ],
    },
  };

  await writeFile(
    join(hooksDir, HOOKS_CONFIG_FILE),
    JSON.stringify(hooksConfig, null, 2),
    "utf-8",
  );
}
