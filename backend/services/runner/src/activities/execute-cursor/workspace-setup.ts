/**
 * Installs and tears down the Cursor HITL approval gate around an agent turn.
 *
 * The gate has two surfaces, kept deliberately separate (issue #173):
 *
 * 1. Runner-owned artifacts — the hook script, approval-state file, and denial
 *    ledger — live in the session's HITL directory OUTSIDE the user's workspace
 *    (`~/.stigmer/sessions/{id}/hitl/`). They never touch the attached repo.
 *
 * 2. Workspace surface — a single `.cursor/hooks.json` written into the
 *    workspace, because the Cursor SDK only loads project hooks from that
 *    hard-coded path. It is kept minimal, MERGED with any pre-existing user
 *    hooks.json, points at the hook script by ABSOLUTE path (so multi-root IDE
 *    windows can always find it instead of failing closed), and is RESTORED to
 *    its original content when the turn ends.
 *
 * Why this shape. The previous design wrote all four files into the workspace
 * with a repo-relative hook command and never cleaned up. For a local-folder
 * workspace (the user's real repo, often open in their Cursor IDE) that gated
 * the user's own IDE, ingested the IDE's tool calls into the denial ledger,
 * failed closed in multi-root windows (relative path → exit 127), and left the
 * gate behind after the session. Relocating the artifacts, scoping the hook to
 * the runner's own process (see hook-script.ts), and restoring hooks.json after
 * every turn together leave the user's repo and tooling untouched.
 *
 * Durability model: the install runs before every agent create/resume (and on
 * every HITL reinvocation / Temporal activity retry); the teardown runs in the
 * activity's finally. Each turn snapshots and restores independently, so the
 * repo is byte-identical between turns. If a crash skips teardown, the leftover
 * hooks.json is inert: the scope guard allows every invocation once the runner
 * PID is gone, and the relocated artifacts are not in the repo.
 */

import { writeFile, readFile, mkdir, chmod, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { generateHookScript } from "./hook-script.js";
import { buildToolApprovalRuleFile } from "./prompt-builder.js";
import { writeApprovalStateFile, resetDenialLedger, type ApprovalStateFile } from "./approval-state.js";

const CURSOR_DIR = ".cursor";
const HOOKS_CONFIG_FILE = "hooks.json";
const HOOK_SCRIPT_FILE = "stigmer-approval.sh";
const RULES_DIR = "rules";
// Unmistakably runner-owned filename so installing it never collides with a
// user's own project rules and restoring it never touches one.
const TOOL_APPROVAL_RULE_FILE = "stigmer-tool-approval.mdc";

/**
 * Cursor hook events the gate registers, both pointing at the same script (which
 * branches on `hook_event_name`). `preToolUse` gates built-in tools
 * (Write/Shell/Delete); `beforeMCPExecution` is the only event Cursor enforces
 * for MCP tool calls.
 */
const PRE_TOOL_USE_EVENT = "preToolUse";
const BEFORE_MCP_EVENT = "beforeMCPExecution";

/** One (event -> script) registration in `.cursor/hooks.json`. */
interface HookRegistration {
  event: string;
  scriptPath: string;
}

/** Hook timeout (seconds) — each script is a quick local decision. */
const HOOK_TIMEOUT_SECONDS = 10;

/**
 * Handle returned by {@link installHitlGate}, consumed by {@link removeHitlGate}
 * to restore the workspace to its pre-turn state.
 */
export interface HitlGateHandle {
  /** Absolute path of the workspace hooks.json this turn manages. */
  hooksJsonPath: string;
  /**
   * Content to restore on teardown: the workspace's original hooks.json bytes
   * (with any stale Stigmer entry stripped), or null when no hooks.json existed
   * before this turn (in which case teardown deletes the file).
   */
  restoreTo: string | null;
  /**
   * The `.cursor/rules/stigmer-tool-approval.mdc` this turn manages: its
   * absolute path and the bytes to restore (null → teardown deletes the file,
   * the normal case since the filename is runner-owned).
   */
  rule: WorkspaceFileSnapshot;
}

/** Absolute path + restore target for a single workspace file the gate manages. */
interface WorkspaceFileSnapshot {
  path: string;
  restoreTo: string | null;
}

/**
 * Install the HITL approval gate for one agent turn.
 *
 * Writes the runner-owned artifacts into {@link hitlDir} and installs the merged
 * `.cursor/hooks.json` into {@link workspaceRoot}, returning a handle that
 * {@link removeHitlGate} uses to restore the workspace afterward.
 */
export async function installHitlGate(params: {
  workspaceRoot: string;
  hitlDir: string;
  approvalState: ApprovalStateFile;
  runnerPid: number;
}): Promise<HitlGateHandle> {
  const { workspaceRoot, hitlDir, approvalState, runnerPid } = params;

  const approvalScriptPath = await writeHitlArtifacts(hitlDir, approvalState, runnerPid);
  // One script, two events: preToolUse gates built-ins; beforeMCPExecution is
  // the only event Cursor enforces for MCP tools. The script branches internally
  // on hook_event_name so MCP is gated in exactly one place.
  const hookHandle = await installWorkspaceHook(workspaceRoot, [
    { event: PRE_TOOL_USE_EVENT, scriptPath: approvalScriptPath },
    { event: BEFORE_MCP_EVENT, scriptPath: approvalScriptPath },
  ]);

  // Install the always-applied tool-approval rule. The deny-based gate surfaces
  // an approval pause to the model as a tool failure (Cursor's generic "blocked
  // by a hook" text), and the SDK exposes no non-leaky approval primitive — so
  // this rule, which takes precedence over MCP-server instructions and persists
  // across resumed turns, is the strongest available lever to stop the model
  // from misreading the gate as a broken environment.
  const rule = await installWorkspaceRule(workspaceRoot);

  return { ...hookHandle, rule };
}

/**
 * Restore the workspace to its pre-turn state.
 *
 * Best-effort and never throws: a teardown failure must not fail the execution,
 * and a leftover hooks.json is inert anyway (see the module doc).
 */
export async function removeHitlGate(handle: HitlGateHandle): Promise<void> {
  await restoreWorkspaceFile(handle.hooksJsonPath, handle.restoreTo);
  if (handle.rule) {
    await restoreWorkspaceFile(handle.rule.path, handle.rule.restoreTo);
    // When we deleted our own rule file (restoreTo === null) and the `.cursor/
    // rules` dir is now empty, remove it too so a repo that had no rules before
    // is left exactly as we found it. rmdir only removes an empty dir, so a
    // workspace with the user's own rules is untouched.
    if (handle.rule.restoreTo === null) {
      try {
        await rmdir(dirname(handle.rule.path));
      } catch {
        // Non-empty (user has other rules) or already gone — nothing to clean.
      }
    }
  }
}

/**
 * Restore a single gate-managed workspace file to its pre-turn state: delete it
 * when nothing existed before (restoreTo === null), else write the snapshot
 * bytes back. Best-effort and never throws — a teardown failure must not fail
 * the execution, and a leftover artifact is inert (see the module doc).
 */
async function restoreWorkspaceFile(path: string, restoreTo: string | null): Promise<void> {
  try {
    if (restoreTo === null) {
      await rm(path, { force: true });
    } else {
      await writeFile(path, restoreTo, "utf-8");
    }
  } catch (err) {
    console.warn(
      `removeHitlGate: failed to restore ${path} (non-fatal): ` +
      `${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Write the runner-owned gate artifacts (approval-state file, fresh denial
 * ledger, hook script) into the session HITL directory and return the absolute
 * hook-script path. The script is regenerated every turn so the current runner
 * PID and the current state-file/ledger paths are always baked in.
 */
async function writeHitlArtifacts(
  hitlDir: string,
  approvalState: ApprovalStateFile,
  runnerPid: number,
): Promise<string> {
  await mkdir(hitlDir, { recursive: true });

  const stateFilePath = await writeApprovalStateFile(hitlDir, approvalState);
  // Reset the denial ledger for this turn so the runner only reads denials
  // produced by the current run, even across HITL reinvocations on the durable
  // HITL directory and Temporal activity retries.
  const ledgerFilePath = await resetDenialLedger(hitlDir);

  const approvalScriptPath = join(hitlDir, HOOK_SCRIPT_FILE);
  await writeFile(
    approvalScriptPath,
    generateHookScript(stateFilePath, ledgerFilePath, runnerPid),
    "utf-8",
  );
  await chmod(approvalScriptPath, 0o755);

  return approvalScriptPath;
}

/**
 * Snapshot the workspace's existing `.cursor/hooks.json`, write a merged config
 * that adds our preToolUse entry (absolute script path) while preserving the
 * user's own hooks, and return the handle for restoration.
 */
async function installWorkspaceHook(
  workspaceRoot: string,
  registrations: HookRegistration[],
): Promise<Omit<HitlGateHandle, "rule">> {
  const cursorDir = join(workspaceRoot, CURSOR_DIR);
  const hooksJsonPath = join(cursorDir, HOOKS_CONFIG_FILE);

  let originalRaw: string | null = null;
  try {
    originalRaw = await readFile(hooksJsonPath, "utf-8");
  } catch {
    originalRaw = null;
  }

  const { merged, restoreTo } = buildMergedConfig(originalRaw, registrations);

  await mkdir(cursorDir, { recursive: true });
  await writeFile(hooksJsonPath, merged, "utf-8");

  return { hooksJsonPath, restoreTo };
}

/**
 * Snapshot and install the always-applied tool-approval rule into
 * `.cursor/rules/stigmer-tool-approval.mdc`, returning the path + restore
 * target. The filename is runner-owned, so restoreTo is normally null (teardown
 * deletes it); if a same-named file somehow pre-exists (e.g. a crash-leftover
 * from a prior turn), its bytes are captured and restored so we never clobber a
 * file we did not create.
 */
async function installWorkspaceRule(workspaceRoot: string): Promise<WorkspaceFileSnapshot> {
  const rulesDir = join(workspaceRoot, CURSOR_DIR, RULES_DIR);
  const rulePath = join(rulesDir, TOOL_APPROVAL_RULE_FILE);

  let restoreTo: string | null = null;
  try {
    restoreTo = await readFile(rulePath, "utf-8");
  } catch {
    restoreTo = null;
  }

  await mkdir(rulesDir, { recursive: true });
  await writeFile(rulePath, buildToolApprovalRuleFile(), "utf-8");

  return { path: rulePath, restoreTo };
}

/**
 * A hook entry the gate installs. Absolute `command` so the hook is found
 * regardless of which workspace root a multi-root IDE resolves against.
 */
function buildHookEntry(scriptPath: string): Record<string, unknown> {
  return { command: scriptPath, timeout: HOOK_TIMEOUT_SECONDS, failClosed: true };
}

/**
 * Identify a hook entry the gate itself wrote (in this or a prior, crash-leftover
 * turn) so a re-install never duplicates it and a restore strips it. Matched by
 * the unmistakable runner-owned HITL script path (`~/.stigmer/sessions/.../*.sh`),
 * never by a user's own hook — covers every event and every gate script.
 */
function isStigmerHookEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const command = (entry as { command?: unknown }).command;
  return (
    typeof command === "string" &&
    command.includes("/.stigmer/sessions/") &&
    command.endsWith(".sh")
  );
}

const STANDALONE_CONFIG = (registrations: HookRegistration[]): string =>
  JSON.stringify({ version: 1, hooks: mergeHooks({}, registrations).hooks }, null, 2);

/**
 * Merge our registrations into a hooks object: for each event, drop any stale
 * Stigmer entry, then append our fresh one. Returns the merged hooks object, the
 * cleaned (Stigmer-free) hooks for restore, and whether anything was stripped.
 */
function mergeHooks(
  existingHooks: Record<string, unknown>,
  registrations: HookRegistration[],
): { hooks: Record<string, unknown>; cleaned: Record<string, unknown>; strippedStale: boolean } {
  const hooks: Record<string, unknown> = { ...existingHooks };
  const cleaned: Record<string, unknown> = { ...existingHooks };
  let strippedStale = false;

  for (const { event, scriptPath } of registrations) {
    const hadEvent = Array.isArray(existingHooks[event]);
    const existing = hadEvent ? (existingHooks[event] as unknown[]) : [];
    const userEntries = existing.filter((e) => !isStigmerHookEntry(e));
    if (userEntries.length !== existing.length) strippedStale = true;

    hooks[event] = [...userEntries, buildHookEntry(scriptPath)];
    // Restore target keeps the event key only if the user originally had it, so
    // we never leave behind an empty array the user never wrote.
    if (hadEvent) cleaned[event] = userEntries;
  }

  return { hooks, cleaned, strippedStale };
}

/**
 * Compute the merged hooks.json to write for this turn and the content to
 * restore afterward.
 *
 * - No existing file → write our standalone config; restore by deleting (null).
 * - Existing, parseable file → append our entry to each registered event array,
 *   preserving every other hook type and field; restore the user's original
 *   bytes. Any stale Stigmer entry from a prior crashed turn is stripped from
 *   BOTH the merged config (no duplicate) and the restore target (self-healing).
 * - Existing, unparseable file → replace for the turn with our standalone
 *   config; restore the user's exact original bytes (we never "fix" their file).
 *
 * Exported for unit testing — this is the load-bearing data transformation.
 */
export function buildMergedConfig(
  originalRaw: string | null,
  registrations: HookRegistration[],
): { merged: string; restoreTo: string | null } {
  if (originalRaw === null) {
    return { merged: STANDALONE_CONFIG(registrations), restoreTo: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(originalRaw);
  } catch {
    return { merged: STANDALONE_CONFIG(registrations), restoreTo: originalRaw };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { merged: STANDALONE_CONFIG(registrations), restoreTo: originalRaw };
  }

  const root = parsed as Record<string, unknown>;
  const hooks =
    root.hooks && typeof root.hooks === "object" && !Array.isArray(root.hooks)
      ? (root.hooks as Record<string, unknown>)
      : {};
  const version = typeof root.version === "number" ? root.version : 1;

  const { hooks: mergedHooks, cleaned, strippedStale } = mergeHooks(hooks, registrations);

  const merged = JSON.stringify({ ...root, version, hooks: mergedHooks }, null, 2);

  // Restore the user's exact original bytes — unless we stripped a stale Stigmer
  // entry, in which case restore the cleaned form so our leftover never lingers.
  const restoreTo = strippedStale
    ? JSON.stringify({ ...root, version, hooks: cleaned }, null, 2)
    : originalRaw;

  return { merged, restoreTo };
}
