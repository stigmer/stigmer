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
 *    hard-coded path. For the turn it holds the gate's entries ONLY: a
 *    repository's own entries are set aside, on every event, so only the
 *    agent's own hooks run on this engine (they run inside the runner,
 *    `hook-server.ts`), as on the native one. Every other key of the file is
 *    kept. It points at the hook script by ABSOLUTE path (so multi-root IDE
 *    windows can always find it instead of failing closed), and is RESTORED
 *    when the turn ends, through the snapshot every rewritten workspace file
 *    shares (`workspace-hook-files.ts`, which also sets aside the `.claude`
 *    settings hooks the SDK would load from a folder the runner owns). While
 *    the turn runs, a Cursor IDE open on the repository runs none of the
 *    repository's hooks either.
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
 * PID is gone, and the relocated artifacts are not in the repo; the next
 * install restores what the crashed turn set aside before anything else.
 */

import { writeFile, readFile, mkdir, chmod, rm, rmdir, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { generateHookScript } from "./hook-script.js";
import { buildToolApprovalRuleFile } from "./prompt-builder.js";
import {
  writeApprovalStateFile,
  resetDenialLedger,
  activePointerPath,
  writeActiveTurnPointer,
  removeActiveTurnPointer,
  type ApprovalStateFile,
} from "./approval-state.js";
import { resetCasObservations } from "./cas-observations.js";
import { ensureHitlGateDir } from "../../shared/workspace/platform-dir.js";
import {
  claudeSettingsRewrites,
  restoreWorkspaceFiles,
  rewriteWorkspaceFiles,
  type WorkspaceFolder,
} from "./workspace-hook-files.js";

const CURSOR_DIR = ".cursor";
const HOOKS_CONFIG_FILE = "hooks.json";
const HOOK_SCRIPT_FILE = "stigmer-approval.sh";
const RULES_DIR = "rules";
// Pre-#173 the gate wrote its script/state/ledger INTO the repo here, as
// `stigmer-*` files. Newer runs relocate them to the session HITL dir, but the
// old files (and their hooks.json entry) linger in already-touched repos — see
// removeLegacyWorkspaceHookArtifacts / isStigmerHookEntry.
const LEGACY_HOOKS_DIR = "hooks";
const RUNNER_OWNED_HOOK_FILE_PREFIX = "stigmer-";
// Unmistakably runner-owned filename so installing it never collides with a
// user's own project rules and restoring it never touches one.
const TOOL_APPROVAL_RULE_FILE = "stigmer-tool-approval.mdc";

/**
 * Cursor hook events the gate registers, all pointing at the same script (which
 * branches on `hook_event_name`). `preToolUse` gates built-in tools
 * (Write/Shell/Delete); `beforeMCPExecution` is the only event Cursor enforces
 * for MCP tool calls; `subagentStart` answers the agent's `Agent(type, …)` list
 * on a runtime that fires it, a second line only: the 1.0.31 local runtime
 * does not fire it for a `task` call (live probe, 2026-10-05), so a type list
 * is refused at setup (`turn-setup.ts` `checkToolScope`). `postToolUse`, for
 * an agent with hooks that run after a call, hands the model what they say;
 * it fires for MCP calls too, and its context is the one Cursor delivers
 * (`afterMCPExecution`'s is not, live probe, 2026-10-05).
 */
const PRE_TOOL_USE_EVENT = "preToolUse";
const BEFORE_MCP_EVENT = "beforeMCPExecution";
const SUBAGENT_START_EVENT = "subagentStart";
const POST_TOOL_USE_EVENT = "postToolUse";

/** One (event -> script) registration in `.cursor/hooks.json`. */
interface HookRegistration {
  event: string;
  scriptPath: string;
}

/** Hook timeout (seconds) for an agent with no hooks — each script is a quick local decision. */
const HOOK_TIMEOUT_SECONDS = 10;

/**
 * What the gate's own work adds to the longest hook an agent has: the
 * script's identity and capture steps around the hook server's answer.
 */
const HOOK_TIMEOUT_MARGIN_SECONDS = 30;

/** The agent's hooks as the gate installs them: where they are served, and how long the longest may run. */
export interface GateHooks {
  readonly socketPath: string;
  readonly token: string;
  /** The longest any one handler may run, in seconds. */
  readonly longestTimeoutSeconds: number;
  /** Whether any of them runs after a call, so `postToolUse` is registered. */
  readonly afterCalls: boolean;
}

/**
 * Handle returned by {@link installHitlGate}, consumed by {@link removeHitlGate}
 * to restore the workspace to its pre-turn state.
 */
export interface HitlGateHandle {
  /** Absolute path of the workspace hooks.json this turn manages. */
  hooksJsonPath: string;
  /**
   * The `.cursor/rules/stigmer-tool-approval.mdc` this turn manages: its
   * absolute path and the bytes to restore (null → teardown deletes the file,
   * the normal case since the filename is runner-owned).
   */
  rule: WorkspaceFileSnapshot;
  /**
   * Workspace-scoped gate directory holding the stable hook script and the
   * active-turn pointer. Teardown drops the pointer (see removeHitlGate) so the
   * gate is inert between turns.
   */
  gateDir: string;
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
  /** The agent's hooks, when it has any. */
  hooks?: GateHooks;
  /** The turn's workspace folders: the runner-owned ones' `.claude` settings hooks are set aside for the turn. */
  folders?: readonly WorkspaceFolder[];
}): Promise<HitlGateHandle> {
  const { workspaceRoot, hitlDir, approvalState, runnerPid, hooks, folders = [] } = params;

  // A crashed turn's set-aside workspace files come back first, so this
  // turn's snapshot is taken of the files as their owners left them.
  await restoreWorkspaceFiles(await ensureHitlGateDir(workspaceRoot), isStigmerHookEntry);

  // Heal any pre-#173 in-workspace gate leftovers before installing. Without
  // this, a stale `.cursor/hooks/stigmer-approval.sh` (from a runner build that
  // wrote the gate into the repo) keeps running alongside the current
  // out-of-workspace gate and — reading an old, taskless approval-state with no
  // grant for the current action — vetoes EVERY gated tool, including ones the
  // user just approved ("blocked despite approval"). Its denials also land in a
  // ledger this runner never reads, so the denial never surfaces as a pause and
  // the run silently completes with the file never written. The merge below
  // strips the stale hooks.json entry (see isStigmerHookEntry); this removes the
  // orphaned script/state/ledger files so nothing can re-run them.
  await removeLegacyWorkspaceHookArtifacts(workspaceRoot);

  const { scriptPath: approvalScriptPath, gateDir } = await writeHitlArtifacts(
    workspaceRoot,
    hitlDir,
    approvalState,
    runnerPid,
    hooks,
  );
  // One script, three events: preToolUse gates built-ins; beforeMCPExecution
  // is the only event Cursor enforces for MCP tools; subagentStart answers the
  // agent's sub-agent types where the runtime fires it (a second line; see
  // SUBAGENT_START_EVENT). The script branches internally on hook_event_name
  // so MCP is gated in exactly one place.
  const registrations: HookRegistration[] = [
    { event: PRE_TOOL_USE_EVENT, scriptPath: approvalScriptPath },
    { event: BEFORE_MCP_EVENT, scriptPath: approvalScriptPath },
    { event: SUBAGENT_START_EVENT, scriptPath: approvalScriptPath },
    ...(hooks?.afterCalls ? [{ event: POST_TOOL_USE_EVENT, scriptPath: approvalScriptPath }] : []),
  ];
  // A hook may run as long as its own timeout; Cursor must not cut the
  // script short while the hook server is still answering.
  const timeoutSeconds = hooks ? hooks.longestTimeoutSeconds + HOOK_TIMEOUT_MARGIN_SECONDS : HOOK_TIMEOUT_SECONDS;
  const hooksJsonPath = await installWorkspaceHook(workspaceRoot, gateDir, registrations, timeoutSeconds, folders);

  // Install the always-applied tool-approval rule. The deny-based gate surfaces
  // an approval pause to the model as a tool failure (Cursor's generic "blocked
  // by a hook" text), and the SDK exposes no non-leaky approval primitive — so
  // this rule, which takes precedence over MCP-server instructions and persists
  // across resumed turns, is the strongest available lever to stop the model
  // from misreading the gate as a broken environment.
  let rule: WorkspaceFileSnapshot;
  try {
    rule = await installWorkspaceRule(workspaceRoot);
  } catch (err) {
    // No handle reaches the caller to restore them: the set-aside files come back here.
    await restoreWorkspaceFiles(gateDir, isStigmerHookEntry);
    throw err;
  }

  return { hooksJsonPath, rule, gateDir };
}

/**
 * Restore the workspace to its pre-turn state.
 *
 * Best-effort and never throws: a teardown failure must not fail the execution,
 * and a leftover hooks.json is inert anyway (see the module doc).
 */
export async function removeHitlGate(handle: HitlGateHandle): Promise<void> {
  await restoreWorkspaceFiles(handle.gateDir, isStigmerHookEntry);
  // Drop the active-turn pointer so the gate is INERT between turns: a hook that
  // fires while no turn is active (a cached hooks.json, the user's own IDE on the
  // same repo) reads no pointer and allows immediately. The stable hook script
  // itself is intentionally left in place — it is harmless without a pointer and
  // is reused (and refreshed) by the next turn.
  await removeActiveTurnPointer(handle.gateDir);
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
 * Delete pre-#173 in-workspace gate leftovers: the runner-owned `stigmer-*`
 * files an older runner build wrote to `.cursor/hooks/` (the hook script, its
 * approval-state, its denial ledger). These are the orphan that shadows the
 * current gate (see installHitlGate). Best-effort and never throws — a cleanup
 * failure must not fail the run.
 *
 * Only `stigmer-`-prefixed files are removed (the unmistakably runner-owned
 * namespace, like the rule filename), so a user's own scripts in `.cursor/hooks`
 * are untouched; the directory itself is removed only if it ends up empty.
 */
async function removeLegacyWorkspaceHookArtifacts(workspaceRoot: string): Promise<void> {
  const hooksDir = join(workspaceRoot, CURSOR_DIR, LEGACY_HOOKS_DIR);
  let entries: string[];
  try {
    entries = await readdir(hooksDir);
  } catch {
    return; // no legacy hooks dir — nothing to heal
  }

  let removedAny = false;
  for (const name of entries) {
    if (!name.startsWith(RUNNER_OWNED_HOOK_FILE_PREFIX)) continue;
    try {
      await rm(join(hooksDir, name), { force: true });
      removedAny = true;
    } catch (err) {
      console.warn(
        `removeLegacyWorkspaceHookArtifacts: failed to remove ${name} (non-fatal): ` +
        `${err instanceof Error ? err.message : err}`,
      );
    }
  }

  if (removedAny) {
    // rmdir only succeeds on an empty dir, so a user who keeps their own hooks
    // here is left untouched; an empty (entirely-ours) dir is cleaned away.
    try {
      await rmdir(hooksDir);
    } catch {
      // Non-empty (user owns other hooks) or already gone — nothing to clean.
    }
  }
}

/**
 * Write this turn's gate artifacts and return the STABLE hook-script path plus
 * the workspace gate directory.
 *
 * Two surfaces, deliberately split by scope:
 *
 * - Per-SESSION (in {@link hitlDir}): the approval-state file (hook input) and a
 *   freshly-reset denial ledger (hook output the runner reads). Reset every turn
 *   so the runner only ever reads denials from the current run, even across HITL
 *   reinvocations and Temporal activity retries.
 *
 * - Per-WORKSPACE (in the gate dir): the STABLE hook script and the active-turn
 *   pointer. The script path is stable across executions because the Cursor SDK
 *   caches `.cursor/hooks.json` (the script path) for the runner process — a
 *   per-session script would be cached at the first execution and reused for all
 *   later ones, sending their denials to the first session's ledger (the
 *   empty-ledger → COMPLETED regression). The script bakes NO per-session paths;
 *   it reads the pointer, which we repoint (atomically) every turn to THIS turn's
 *   state file, ledger, and runner PID. See generateHookScript / writeActiveTurnPointer.
 */
async function writeHitlArtifacts(
  workspaceRoot: string,
  hitlDir: string,
  approvalState: ApprovalStateFile,
  runnerPid: number,
  hooks: GateHooks | undefined,
): Promise<{ scriptPath: string; gateDir: string }> {
  await mkdir(hitlDir, { recursive: true });

  const stateFilePath = await writeApprovalStateFile(hitlDir, approvalState);
  const ledgerFilePath = await resetDenialLedger(hitlDir);
  // Reset the cas-observations sidecar too, so the turn boundary only ever reads
  // gitignored observations the hook staged this run (deterministic across HITL
  // reinvocations and Temporal retries, exactly like the denial ledger).
  await resetCasObservations(hitlDir);

  const gateDir = await ensureHitlGateDir(workspaceRoot);
  const pointerPath = activePointerPath(gateDir);
  const scriptPath = join(gateDir, HOOK_SCRIPT_FILE);
  // Bake the workspace root so capture mode's `git check-ignore` runs against the
  // right repo regardless of the hook's cwd. The root is stable per workspace
  // (the gate dir is keyed by it), so the script stays stable across executions.
  await writeFile(scriptPath, generateHookScript(pointerPath, workspaceRoot), "utf-8");
  await chmod(scriptPath, 0o755);

  // Point the stable hook at THIS turn's per-session artifacts (atomic, last
  // write wins) — the single indirection that makes a process-cached hook resolve
  // the current execution instead of the first one's.
  await writeActiveTurnPointer(gateDir, {
    stateFile: stateFilePath,
    ledgerFile: ledgerFilePath,
    runnerPid,
    ...(hooks ? { hookSocket: hooks.socketPath, hookToken: hooks.token } : {}),
  });

  return { scriptPath, gateDir };
}

/**
 * Write the turn's `.cursor/hooks.json` (the gate's entries only) and set
 * aside the runner-owned folders' `.claude` settings hooks, each snapshotted
 * under the gate directory first; returns the hooks.json path.
 */
async function installWorkspaceHook(
  workspaceRoot: string,
  gateDir: string,
  registrations: HookRegistration[],
  timeoutSeconds: number,
  folders: readonly WorkspaceFolder[],
): Promise<string> {
  const cursorDir = join(workspaceRoot, CURSOR_DIR);
  const hooksJsonPath = join(cursorDir, HOOKS_CONFIG_FILE);

  let originalRaw: string | null = null;
  try {
    originalRaw = await readFile(hooksJsonPath, "utf-8");
  } catch {
    originalRaw = null;
  }

  const { merged, restoreTo } = buildMergedConfig(originalRaw, registrations, timeoutSeconds);

  await mkdir(cursorDir, { recursive: true });
  await rewriteWorkspaceFiles(gateDir, [
    { path: hooksJsonPath, kind: "cursor-hooks", original: restoreTo, written: merged },
    ...(await claudeSettingsRewrites(folders)),
  ]);
  return hooksJsonPath;
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
function buildHookEntry(scriptPath: string, timeoutSeconds: number): Record<string, unknown> {
  return { command: scriptPath, timeout: timeoutSeconds, failClosed: true };
}

/**
 * Identify a hook entry the gate itself wrote — in this turn, a prior
 * crash-leftover turn, or a pre-#173 runner build — so a re-install never
 * duplicates it and a restore strips it. Matches two runner-owned shapes, never
 * a user's own hook:
 *
 * 1. Current: any script under the runner-owned `~/.stigmer/` tree (the session
 *    HITL dir or the workspace gate dir, `~/.stigmer/.../*.sh`) — location-based,
 *    so it covers every gate script regardless of name.
 * 2. Legacy: a `stigmer-*.sh` script (historically the in-workspace
 *    `.cursor/hooks/stigmer-approval.sh`) — recognized by its unmistakably
 *    runner-owned basename. Without this, the old in-workspace hook is treated
 *    as a user hook and preserved by the merge, so it keeps running alongside
 *    (and vetoing) the current gate. The `stigmer-` prefix is the same
 *    runner-owned namespace convention as the rule filename.
 */
export function isStigmerHookEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const command = (entry as { command?: unknown }).command;
  if (typeof command !== "string" || command.length === 0) return false;
  if (command.includes("/.stigmer/") && command.endsWith(".sh")) return true;
  const file = basename(command);
  return file.startsWith(RUNNER_OWNED_HOOK_FILE_PREFIX) && file.endsWith(".sh");
}

/** The gate's own hooks object: each registered event with its one entry. */
function gateHooks(registrations: HookRegistration[], timeoutSeconds: number): Record<string, unknown> {
  const hooks: Record<string, unknown> = {};
  for (const { event, scriptPath } of registrations) hooks[event] = [buildHookEntry(scriptPath, timeoutSeconds)];
  return hooks;
}

/**
 * Compute the turn's hooks.json and the content to restore afterward.
 *
 * The turn's file holds the gate's entries only: every event's repository
 * entries are set aside for the turn (the module doc says why), and every
 * other key of the file is kept.
 *
 * - No existing file → write the gate's config; restore by deleting (null).
 * - Existing, parseable file → the gate's hooks in place of the file's,
 *   every other field kept; restore the original bytes. Any stale Stigmer
 *   entry from a prior crashed turn is stripped from the restore target
 *   (self-healing).
 * - Existing, unparseable file → replace for the turn with the gate's config;
 *   restore the original bytes (we never "fix" a file).
 *
 * Exported for unit testing — this is the load-bearing data transformation.
 */
export function buildMergedConfig(
  originalRaw: string | null,
  registrations: HookRegistration[],
  timeoutSeconds = HOOK_TIMEOUT_SECONDS,
): { merged: string; restoreTo: string | null } {
  const ours = gateHooks(registrations, timeoutSeconds);
  const standalone = JSON.stringify({ version: 1, hooks: ours }, null, 2);
  if (originalRaw === null) return { merged: standalone, restoreTo: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(originalRaw);
  } catch {
    return { merged: standalone, restoreTo: originalRaw };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { merged: standalone, restoreTo: originalRaw };
  }

  const root = parsed as Record<string, unknown>;
  const hooks =
    root.hooks && typeof root.hooks === "object" && !Array.isArray(root.hooks)
      ? (root.hooks as Record<string, unknown>)
      : {};
  const version = typeof root.version === "number" ? root.version : 1;
  const merged = JSON.stringify({ ...root, version, hooks: ours }, null, 2);

  // The restore target: the original, less any entry an earlier gate left.
  const cleaned: Record<string, unknown> = {};
  let strippedStale = false;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      cleaned[event] = entries;
      continue;
    }
    const own = entries.filter((e) => !isStigmerHookEntry(e));
    if (own.length !== entries.length) strippedStale = true;
    cleaned[event] = own;
  }
  if (!strippedStale) return { merged, restoreTo: originalRaw };

  // We stripped a stale Stigmer entry, so never restore the original bytes (that
  // would re-plant our leftover). If stripping leaves NO user hooks at all and
  // the file carried nothing but `version`/`hooks`, the entire hooks.json was our
  // own leftover (the pre-#173 design wrote the whole file) — delete it on
  // teardown so a polluted repo is left pristine. Otherwise restore the cleaned,
  // Stigmer-free form, preserving the user's other hooks and root fields.
  const onlyVersionAndHooks = Object.keys(root).every((k) => k === "version" || k === "hooks");
  const noUserHooksRemain = Object.values(cleaned).every((v) => Array.isArray(v) && v.length === 0);
  const restoreTo = onlyVersionAndHooks && noUserHooksRemain
    ? null
    : JSON.stringify({ ...root, version, hooks: cleaned }, null, 2);
  return { merged, restoreTo };
}
