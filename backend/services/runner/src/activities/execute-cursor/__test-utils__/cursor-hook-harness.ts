/**
 * Test harness for the generated Cursor preToolUse bash hook.
 *
 * Runs the ACTUAL bash script the runner writes into the workspace, feeding it
 * the REAL hook-input shapes captured from `@cursor/sdk`. It is the out-of-process
 * deny-oracle's only honest test surface: write the runner-owned state file (with
 * any approval grants), invoke the hook, and read back its allow/deny decision
 * and the denial ledger.
 *
 * Extracted from `__tests__/hook-script.test.ts` so it is shared by both that
 * behavior suite and the deny-oracle adapter in the gateway Contract Test Kit
 * (`__test-utils__/gateway-substrate.ts`) — one harness, no drift.
 *
 * Each harness owns a throwaway workspace under the OS temp dir and self-cleans
 * via `onTestFinished`, so it must be called from within a running test.
 */

import { onTestFinished } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateHookScript } from "../hook-script.js";
import { buildApprovalState, type ApprovalGrant, type McpToolPolicyEntry } from "../approval-state.js";
import type { MergedToolPolicy, ApprovalCategory } from "../approval-policy.js";

/**
 * Whether `bash` is available on this machine. Hook tests must be skipped where
 * it is not — use `const d = hasBash ? describe : describe.skip`.
 */
export const hasBash: boolean = (() => {
  try {
    execSync("bash -c 'exit 0'", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

export interface CursorHookHarness {
  /** Run the hook against a single hook-input payload and report its decision. */
  decide(input: object): { permission: string; raw: string };
  /**
   * The denial ledger entries the hook has appended this turn. `input` is the
   * base64(JSON(tool_input)) the hook captures (decode + JSON.parse to inspect).
   */
  ledger(): Array<{ toolName: string; token: string; input?: string }>;
  /** Truncate the denial ledger (a fresh turn). */
  resetLedger(): void;
}

export interface CursorHookHarnessOptions {
  /** Pre-armed spec.auto_approve_all (the whole-run global bypass). */
  autoApproveAll?: boolean;
  /** Built-in categories with a run-lifetime scoped lease. */
  leasedCategories?: ApprovalCategory[];
  grants?: ApprovalGrant[];
  mcpPolicies?: Record<string, McpToolPolicyEntry>;
  /** Omit the state file to exercise the fail-closed (deny) path. */
  noStateFile?: boolean;
  /**
   * Process the hook treats as "the runner". Defaults to this test process,
   * which is an ancestor of the bash child `execFileSync` spawns — so the scope
   * guard sees the call as the runner's own agent and applies the gate. Pass a
   * non-ancestor PID to exercise the foreign-client path (issue #173).
   */
  runnerPid?: number;
}

/**
 * Build a throwaway workspace, write the generated hook + (optionally) the
 * approval state file, and return a driver for the real bash hook.
 */
export function setupCursorHookHarness(opts: CursorHookHarnessOptions = {}): CursorHookHarness {
  const ws = mkdtempSync(join(tmpdir(), "hook-script-"));
  onTestFinished(() => rmSync(ws, { recursive: true, force: true }));

  const dir = join(ws, ".cursor", "hooks");
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "state.json");
  const ledgerPath = join(dir, "denials.jsonl");
  const pointerPath = join(dir, "active.json");
  const scriptPath = join(dir, "hook.sh");
  // The hook script is STABLE (no baked per-turn paths); it resolves the current
  // turn's state/ledger/runner from the active-turn pointer it re-reads each call.
  writeFileSync(scriptPath, generateHookScript(pointerPath), "utf-8");
  writeFileSync(
    pointerPath,
    JSON.stringify({
      stateFile: statePath,
      ledgerFile: ledgerPath,
      runnerPid: opts.runnerPid ?? process.pid,
    }),
    "utf-8",
  );

  if (!opts.noStateFile) {
    const policies = new Map<string, MergedToolPolicy>(
      Object.entries(opts.mcpPolicies ?? {}).map(([name, p]) => [
        `srv/${name}`,
        {
          toolName: name,
          mcpServerSlug: "srv",
          requiresApproval: p.requiresApproval,
          approvalMessage: p.message ?? "",
          source: "classifier_default" as const,
        },
      ]),
    );
    const state = buildApprovalState(
      policies,
      opts.autoApproveAll ?? false,
      new Set(opts.leasedCategories ?? []),
      opts.grants,
    );
    writeFileSync(statePath, JSON.stringify(state), "utf-8");
  }

  return {
    decide(input: object) {
      const raw = execFileSync("bash", [scriptPath], { input: JSON.stringify(input) }).toString();
      const permission = raw.includes('"permission":"deny"')
        ? "deny"
        : raw.includes('"permission":"allow"')
          ? "allow"
          : "?";
      return { permission, raw };
    },
    ledger() {
      if (!existsSync(ledgerPath)) return [];
      return readFileSync(ledgerPath, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    },
    resetLedger() {
      writeFileSync(ledgerPath, "", "utf-8");
    },
  };
}

// Real preToolUse hook-input shapes (PascalCase name, file_path/command in
// tool_input). These omit hook_event_name on purpose: a payload with no event
// must still take the built-in arm (the script only diverts to the MCP arm on an
// explicit beforeMCPExecution).
export const hookWrite = (filePath: string, content = "x") => ({ tool_name: "Write", tool_input: { file_path: filePath, content } });
export const hookEdit = (filePath: string, oldString = "a", newString = "b") => ({ tool_name: "StrReplace", tool_input: { file_path: filePath, old_string: oldString, new_string: newString } });
export const hookShell = (command: string) => ({ tool_name: "Shell", tool_input: { command, cwd: "/x", timeout: 30000 } });
export const hookDelete = (filePath: string) => ({ tool_name: "Delete", tool_input: { file_path: filePath } });
export const hookRead = (filePath: string) => ({ tool_name: "Read", tool_input: { file_path: filePath } });

// Real beforeMCPExecution shape (captured live): bare tool_name, tool_input as a
// JSON STRING, server identity, and the hook_event_name discriminator.
export const hookMcp = (name: string, input: Record<string, unknown> = {}) => ({
  tool_name: name,
  tool_input: JSON.stringify(input),
  mcp_server_name: "srv",
  command: "npx -y srv mcp",
  hook_event_name: "beforeMCPExecution",
});
