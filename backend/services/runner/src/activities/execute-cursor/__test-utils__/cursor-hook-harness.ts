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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateHookScript } from "../hook-script.js";
import { buildApprovalState, type ApprovalGrant } from "../approval-state.js";
import type { ApprovalCategory, McpApprovalDefault } from "../approval-policy.js";
import { mcpToolKey } from "../../../shared/approval-policy.js";
import { ToolScope, type ToolLists } from "../../../shared/tool-lists.js";
import { compileHookToolScope } from "../hook-scope.js";
import { readCasObservations, type CasObservations } from "../cas-observations.js";
import type { ProposedAction } from "../../../__test-utils__/approval-contract/types.js";

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
  /** The throwaway platform dir (outside the workspace) the `platform` link points at. */
  readonly platformDir: string;
  /** Run the hook against a single hook-input payload and report its decision. */
  decide(input: object): { permission: string; raw: string };
  /**
   * The denial ledger entries the hook has appended this turn, raw. `kind` is
   * the attribution taxonomy (approval/secret/capture-error/fail-closed/
   * disabled); `input` is the base64(JSON(tool_input)) the hook captures on
   * APPROVAL-kind entries only; `message` the base64 refusal text on a
   * tool-list refusal.
   */
  ledger(): Array<{ toolName: string; token: string; kind?: string; input?: string; message?: string }>;
  /** The hook's directory, the harness's `hitlDir` analog: `readDenialLedger(h.hitlDir)` reads what the runner reads. */
  readonly hitlDir: string;
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
  /** Tools of the MCP server "srv" (the one {@link hookMcp} names) that its server marks destructive. */
  destructiveMcpTools?: string[];
  /** The server {@link destructiveMcpTools} belong to; "srv" (the one {@link hookMcp} names by default) when absent. */
  destructiveMcpServer?: string;
  /** MCP servers with a run-lifetime lease. */
  leasedMcpServers?: string[];
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
   * Whether the workspace is a git tree. Default true. When false the
   * throwaway workspace is NOT git-initialized and the state's `gitWorkspace` flag
   * is false, so the hook CAS-stages EVERY write (not only gitignored ones) and
   * skips the git-tracked flow arm.
   */
  gitWorkspace?: boolean;
  /**
   * Unattended approval mode: approval denies are recorded with the
   * non-pausing "unattended" kind and the adapt-and-explain agent message.
   */
  unattendedSkip?: boolean;
  /**
   * The main agent's tool lists. Compiled into the state exactly as the
   * runner compiles them (`hook-scope.ts`).
   */
  lists?: ToolLists;
  /**
   * What the workspace's `.stigmer` is this turn (default: the platform link
   * when `lists` is set, else nothing): `platform`, the runner's link to the
   * harness's throwaway platform dir; `repo`, a repository's own symlink to a
   * real directory inside the workspace (an unlinked turn); `none`. The read
   * root is derived from it as `turn-setup.ts` `platformReadRoot` derives it.
   */
  stigmerLink?: "platform" | "repo" | "none";
  /** The turn's MCP servers and the tools discovery knows of (null: never discovered). */
  mcpServers?: Array<{ slug: string; discoveredToolNames: string[] | null }>;
  /** The platform's synthesized attachment slugs (always in scope). */
  platformServerSlugs?: string[];
  /** The custom sub-agent types registered with the SDK. */
  subAgentTypes?: string[];
}

/** The approval default of a turn whose servers mark nothing destructive and hold no lease. */
export const NO_MCP_DEFAULT: McpApprovalDefault = { destructive: new Set(), leasedServers: new Set() };

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

  const platformDir = mkdtempSync(join(tmpdir(), "hook-platform-"));
  onTestFinished(() => rmSync(platformDir, { recursive: true, force: true }));
  const link = opts.stigmerLink ?? (opts.lists ? "platform" : "none");
  if (link === "platform") symlinkSync(platformDir, join(ws, ".stigmer"), "dir");
  if (link === "repo") {
    mkdirSync(join(ws, "repo-state"), { recursive: true });
    symlinkSync(join(ws, "repo-state"), join(ws, ".stigmer"), "dir");
  }
  // `platformReadRoot`'s rule, synchronously: the platform dir's real path
  // only when the workspace's `.stigmer` is the link to it.
  const linkTarget = link === "none" ? "" : readlinkSync(join(ws, ".stigmer"));
  const readRoot = linkTarget === platformDir ? realpathSync(platformDir) : "";

  if (!opts.noStateFile) {
    const mcpDefault: McpApprovalDefault = {
      destructive: new Set((opts.destructiveMcpTools ?? []).map((tool) => mcpToolKey(opts.destructiveMcpServer ?? "srv", tool))),
      leasedServers: new Set(opts.leasedMcpServers ?? []),
    };
    const toolScope = compileHookToolScope({
      scope: opts.lists ? ToolScope.of('Agent "test"', opts.lists) : ToolScope.unrestricted(),
      servers: opts.mcpServers ?? [],
      platformServerSlugs: new Set(opts.platformServerSlugs ?? []),
      readRoot,
      subAgentTypes: opts.subAgentTypes ?? [],
    });
    const state = buildApprovalState(
      mcpDefault,
      opts.autoApproveAll ?? false,
      new Set(opts.leasedCategories ?? []),
      opts.grants,
      opts.captureMode ?? false,
      opts.captureIgnored ?? false,
      opts.gitWorkspace ?? true,
      opts.unattendedSkip ?? false,
      toolScope,
    );
    writeFileSync(statePath, JSON.stringify(state), "utf-8");
  }

  return {
    root: ws,
    platformDir,
    hitlDir: dir,
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
export const hookMcp = (name: string, input: Record<string, unknown> = {}, server = "srv") => ({
  tool_name: name,
  tool_input: JSON.stringify(input),
  mcp_server_name: server,
  command: `npx -y ${server} mcp`,
  hook_event_name: "beforeMCPExecution",
});

// The preToolUse invocation Cursor makes for the same MCP call (its hooks
// reference: MCP tools appear there as `MCP:<tool_name>`); the MCP event, not
// this one, decides it.
export const hookMcpPreToolUse = (name: string) => ({ tool_name: `MCP:${name}`, tool_input: {}, hook_event_name: "preToolUse" });

// The subagentStart payload (`@cursor/sdk` 1.0.31 bundle): the hook answers it
// from the agent's `Agent(type, …)` list.
export const hookSubagentStart = (subagentType: string) => ({
  subagent_id: "sa-1",
  subagent_type: subagentType,
  task: "do the thing",
  parent_conversation_id: "conv-1",
  tool_call_id: "tc-1",
  hook_event_name: "subagentStart",
});

// A built-in preToolUse call by its hook name, with a cwd as Cursor sends it.
export const hookBuiltin = (toolName: string, toolInput: Record<string, unknown>, cwd?: string) => ({
  tool_name: toolName,
  tool_input: toolInput,
  ...(cwd !== undefined ? { cwd } : {}),
  hook_event_name: "preToolUse",
});

// ── The contract kits' abstract action, in both of Cursor's taxonomies ──────
//
// Both kits (`approval-contract`, `harness-contract`) speak of a side effect as
// a taxonomy-free `ProposedAction`; Cursor sees the same act twice, as the
// STREAM tool call the SDK emits (`edit` / `shell` / `delete`, lowercase) and
// as the HOOK payload the preToolUse script judges (`Write` / `Shell` /
// `Delete`). One translation here, so every Cursor-side substrate and subject
// exercises the same category collapse that lets a stream-minted grant match a
// hook-named call.

/** Build the real preToolUse hook-input payload for an abstract action. */
export function hookInputFor(action: ProposedAction): object {
  switch (action.kind) {
    case "write":
      return hookWrite(action.resource, action.content ?? "x");
    case "shell":
      return hookShell(action.resource);
    case "delete":
      return hookDelete(action.resource);
    case "read":
      return hookRead(action.resource);
    case "mcp":
      return hookMcp(action.mcpToolName ?? "mcp_tool");
    default: {
      const exhaustive: never = action.kind;
      throw new Error(`hookInputFor: unknown action kind ${String(exhaustive)}`);
    }
  }
}

/** The gated built-in categories: the only action kinds a grant is ever minted for. */
export type GatedActionKind = "write" | "shell" | "delete";

/**
 * Stream-side (SDK) tool name per gated category — deliberately the OTHER
 * taxonomy from the hook input, so a grant minted from the stream matches a
 * hook-named call only via the canonical category, not the raw name.
 */
export const STREAM_NAME: Record<GatedActionKind, string> = {
  write: "edit",
  shell: "shell",
  delete: "delete",
};

/**
 * The stream-side args of a gated action, mirroring {@link hookInputFor}: a
 * write carries whole-file content (so its digest is content-exact and matches
 * the hook's), a delete carries only a path, and a shell carries its command
 * (the salient is already exact). The shapes the goldens' `edit` events use.
 */
export function streamArgsFor(action: ProposedAction & { kind: GatedActionKind }): Record<string, unknown> {
  switch (action.kind) {
    case "shell":
      return { command: action.resource };
    case "delete":
      return { path: action.resource };
    case "write":
      return { path: action.resource, content: action.content ?? "x" };
    default: {
      const exhaustive: never = action.kind;
      throw new Error(`streamArgsFor: unknown gated kind ${String(exhaustive)}`);
    }
  }
}
