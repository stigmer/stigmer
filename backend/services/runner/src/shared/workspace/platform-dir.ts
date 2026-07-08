/**
 * Session-scoped platform directory management.
 *
 * Each agent execution session gets a dedicated directory tree under
 * `~/.stigmer/sessions/{sessionId}/`:
 * - `platform/` — skills, attachments, and other platform-managed files the
 *   agent sees via the `.stigmer/` virtual namespace (WorkspaceBackend routing).
 * - `hitl/` — the HITL approval gate's runtime artifacts (hook script, approval
 *   state, denial ledger). These live OUTSIDE the user's workspace so attaching
 *   a real repo never leaves Stigmer files behind in it (see issue #173); only
 *   a minimal, transient `.cursor/hooks.json` referencing the absolute script
 *   path is written into the workspace itself.
 *
 * This module replaces the duplicated `getPlatformDir` helpers in
 * execute-cursor/skill-resolver.ts and execute-cursor/attachment-resolver.ts.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

/** The runner-owned `~/.stigmer` root (overridable via HOME for tests/sandboxes). */
function getStigmerHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

/** Root of a session's runner-owned directory tree (outside the workspace). */
function getSessionDir(sessionId: string): string {
  return join(getStigmerHome(), ".stigmer", "sessions", sessionId);
}

/**
 * Compute the WORKSPACE-scoped HITL gate directory — the home for the STABLE
 * hook script and the per-turn "active turn" pointer.
 *
 * Why workspace-scoped, not session-scoped: the Cursor SDK loads the workspace's
 * `.cursor/hooks.json` (the hook script PATH) ONCE per runner process and caches
 * it; later per-execution rewrites are ignored. A per-session hook script (with
 * per-session baked state/ledger paths) therefore gets cached at the FIRST
 * execution and reused for every later one — so later executions' denials are
 * recorded to the FIRST session's ledger and the current runner reads its own
 * empty ledger, silently completing instead of pausing for approval.
 *
 * The fix is a single STABLE script per workspace (so the SDK's cached path is
 * always correct) that resolves the CURRENT turn's state/ledger/runner from an
 * atomically-updated pointer the script re-reads on every invocation. This dir
 * holds both. It is keyed by a hash of the absolute workspace path so distinct
 * workspaces never collide, and lives under `~/.stigmer` (never the repo, per
 * issue #173). Pure function — performs no I/O.
 */
export function getHitlGateDir(workspaceRoot: string): string {
  const key = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
  return join(getStigmerHome(), ".stigmer", "hitl-gate", key);
}

/**
 * Ensure the workspace-scoped HITL gate directory exists and return its path.
 * Idempotent — safe across executions, HITL reinvocations, and activity retries.
 */
export async function ensureHitlGateDir(workspaceRoot: string): Promise<string> {
  const dir = getHitlGateDir(workspaceRoot);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Compute the platform directory path for a session.
 *
 * Pure function — does not create the directory or perform I/O.
 */
export function getPlatformDir(sessionId: string): string {
  return join(getSessionDir(sessionId), "platform");
}

/**
 * Compute the durable-checkpoint database path for a session — the SQLite file
 * backing the local LangGraph checkpointer (see shared/checkpointer/sqlite-saver.ts).
 *
 * Session-scoped by design: a session has exactly one LangGraph thread
 * (`thread-{sessionId}`), so one DB per session keeps checkpoint lifetime bound
 * to session lifetime (retention becomes "remove the session dir") and mirrors
 * the sibling `platform/` and `hitl/` trees. Pure function — performs no I/O.
 */
export function getCheckpointDbPath(sessionId: string): string {
  return join(getSessionDir(sessionId), "checkpoints.db");
}

/**
 * Ensure the session directory exists and return the checkpoint DB path.
 *
 * Creates the session directory tree if needed (the SQLite driver requires the
 * parent directory to exist before opening the file). Idempotent — safe across
 * executions, HITL reinvocations, and activity retries.
 */
export async function ensureCheckpointDbPath(sessionId: string): Promise<string> {
  await mkdir(getSessionDir(sessionId), { recursive: true });
  return getCheckpointDbPath(sessionId);
}

/**
 * Ensure the platform directory exists and return its path.
 *
 * Creates the full directory tree if it does not exist. Idempotent —
 * safe to call multiple times for the same session.
 */
export async function ensurePlatformDir(sessionId: string): Promise<string> {
  const dir = getPlatformDir(sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Compute the HITL directory path for a session — the runner-owned home for the
 * approval gate's hook script, approval-state file, and denial ledger.
 *
 * Kept separate from the workspace so the gate's machinery never pollutes the
 * user's repo: the workspace only ever holds a transient `.cursor/hooks.json`
 * that points here by absolute path. Pure function — performs no I/O.
 */
export function getHitlDir(sessionId: string): string {
  return join(getSessionDir(sessionId), "hitl");
}

/**
 * Ensure the HITL directory exists and return its path.
 *
 * Creates the full directory tree if it does not exist. Idempotent —
 * safe to call multiple times for the same session (including across HITL
 * reinvocations and Temporal activity retries).
 */
export async function ensureHitlDir(sessionId: string): Promise<string> {
  const dir = getHitlDir(sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}
