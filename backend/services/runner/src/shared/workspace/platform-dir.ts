/**
 * Session-scoped platform directory management.
 *
 * Each agent execution session gets a dedicated platform directory at
 * `~/.stigmer/sessions/{sessionId}/platform/` for storing skills,
 * attachments, and other platform-managed files. This directory is
 * separate from the user's workspace — the agent sees it via the
 * `.stigmer/` virtual namespace through WorkspaceBackend routing.
 *
 * This module replaces the duplicated `getPlatformDir` helpers in
 * execute-cursor/skill-resolver.ts and execute-cursor/attachment-resolver.ts.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";

/**
 * Compute the platform directory path for a session.
 *
 * Pure function — does not create the directory or perform I/O.
 */
export function getPlatformDir(sessionId: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(home, ".stigmer", "sessions", sessionId, "platform");
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
