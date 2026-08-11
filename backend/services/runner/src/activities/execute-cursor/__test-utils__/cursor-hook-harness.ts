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
import { readCasObservations, type CasObservations } from "../cas-observations.js";

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
  /** The throwaway workspace root (git repo when capture mode is on). */
  readonly root: string;
  /** Run the hook against a single hook-input payload and report its decision. */
  decide(input: object): { permission: string; raw: string };
  /**
   * The denial ledger entries the hook has appended this turn. `kind` is the
   * attribution taxonomy (approval/secret/capture-error/fail-closed); `input`
   * is the base64(JSON(tool_input)) the hook captures on APPROVAL-kind entries
   * only (decode + JSON.parse to inspect).
   */
  ledger(): Array<{ toolName: string; token: string; kind?: string; input?: string }>;
  /** Truncate the denial ledger (a fresh turn). */
  resetLedger(): void;
  /**
   * The cas-observations the hook staged this turn (captured gitignored writes +
   * secret-blocked paths), read back through the real sidecar reader. Empty when
   * captureIgnored is off / nothing was staged.
   */
  observations(): Promise<CasObservations>;
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
  /**
   * Capture mode (git workspaces): the hook ALLOWS write/edit/delete to flow,
   * gating only gitignored paths, shell, and MCP. When set, the harness baked
   * workspace root is the throwaway workspace so `git check-ignore` resolves.
   */
  captureMode?: boolean;
  /**
   * Initialize the throwaway workspace as a git repo with these gitignore
   * patterns, so capture mode's `git check-ignore` has a real repo to consult.
   */
  gitignored?: string[];
  /**
   * CAS capture of gitignored writes (deep-agent parity). When true, the hook
   * stages a non-secret gitignored write's before-bytes into the cas-observations
   * sidecar and ALLOWS it, and hard-blocks a secret-like gitignored write —
   * instead of denying every gitignored write. Requires a git repo (set via
   * {@link captureMode} or {@link gitignored}).
   */
  captureIgnored?: boolean;
  /**
   * Whether the workspace is a git tree (Slice 2c). Default true. When false the
   * throwaway workspace is NOT git-initialized and the state's `gitWorkspace` flag
   * is false, so the hook CAS-stages EVERY write (not only gitignored ones) and
   * skips the git-tracked flow arm.
   */
  gitWorkspace?: boolean;
  /**
   * Unattended approval mode (DD-014): approval denies are recorded with the
   * non-pausing "unattended" kind and the adapt-and-explain agent message.
   */
  unattendedSkip?: boolean;
  /**
   * Per-server enabled_tools allow-lists (issue #350) — restricted servers
   * only. The hook's manifest arm denies a beforeMCPExecution call whose
   * mcp_server_name is listed here with a tool name outside its list (kind
   * "disabled", ahead of every approval bypass). hookMcp payloads carry
   * mcp_server_name "srv".
   */
  mcpServerEnabledTools?: Record<string, string[]>;
}

/**
 * Build a throwaway workspace, write the generated hook + (optionally) the
 * approval state file, and return a driver for the real bash hook.
 */
export function setupCursorHookHarness(opts: CursorHookHarnessOptions = {}): CursorHookHarness {
  const ws = mkdtempSync(join(tmpdir(), "hook-script-"));
  onTestFinished(() => rmSync(ws, { recursive: true, force: true }));

  // Capture-mode tests need a real git repo so `git check-ignore` resolves. A
  // non-git test (gitWorkspace:false) deliberately leaves the workspace un-inited
  // so the hook's substrate matches the state's gitWorkspace flag.
  if ((opts.captureMode || opts.gitignored) && opts.gitWorkspace !== false) {
    execSync("git init -q", { cwd: ws });
    if (opts.gitignored && opts.gitignored.length > 0) {
      writeFileSync(join(ws, ".gitignore"), opts.gitignored.join("\n") + "\n", "utf-8");
    }
  }

  const dir = join(ws, ".cursor", "hooks");
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "state.json");
  const ledgerPath = join(dir, "denials.jsonl");
  const pointerPath = join(dir, "active.json");
  const scriptPath = join(dir, "hook.sh");
  // The hook script is STABLE (no baked per-turn paths); it resolves the current
  // turn's state/ledger/runner from the active-turn pointer it re-reads each call.
  // The workspace root is baked so capture mode's gitignore check finds the repo.
  writeFileSync(scriptPath, generateHookScript(pointerPath, ws), "utf-8");
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
      opts.captureMode ?? false,
      opts.captureIgnored ?? false,
      opts.gitWorkspace ?? true,
      opts.unattendedSkip ?? false,
      opts.mcpServerEnabledTools ?? {},
    );
    writeFileSync(statePath, JSON.stringify(state), "utf-8");
  }

  return {
    root: ws,
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
    // The sidecar lives beside the state/ledger files (its `dir` is the harness's
    // hitlDir analog), exactly as the runner derives it from dirname(STATE_FILE).
    observations() {
      return readCasObservations(dir);
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
