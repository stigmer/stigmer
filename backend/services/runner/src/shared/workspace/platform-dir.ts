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

/** Root of a session's runner-owned directory tree (outside the workspace). */
function getSessionDir(sessionId: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(home, ".stigmer", "sessions", sessionId);
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
