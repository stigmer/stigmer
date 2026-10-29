/**
 * Session-scoped platform directory management.
 *
 * Each agent execution session gets a dedicated directory tree under
 * `~/.stigmer/sessions/{sessionId}/`:
 * - `platform/` — skills, the conversation's Files, and other platform-managed files the
 *   agent sees via the `.stigmer/` virtual namespace (WorkspaceBackend routing).
 * - `displaced/` — a real `.stigmer` entry found in the workspace when the
 *   platform link takes the name, kept rather than deleted (stigmer-link.ts).
 * - `offload/` — what the Stigmer harness offloads from its own context: the
 *   summarized conversation history and tool results too large to keep
 *   (`execute-deep-agent/platform-route.ts` routes deepagents' two roots
 *   here). Beside `platform/`, not under it, so the workspace's `.stigmer`
 *   link and route never expose it, and outside the workspace, like every
 *   tree here.
 * - `claude/` — the Claude engine's own: `transcripts/`, its conversation
 *   when the runner keeps it on disk (`execute-claude/file-store.ts`), and
 *   one `turn-<run>-<seq>/` per invocation, the engine's home and
 *   configuration directory for that invocation alone, removed when it
 *   ends. Beside `platform/` for the same reason as `offload/`: the agent's
 *   `.stigmer` link never shows the engine's state.
 *
 * This module replaces the `getPlatformDir` helpers the skill and attachment
 * resolvers each once carried.
 */

import { dirname, join } from "node:path";
import { agentFs } from "../agent-fs.js";
import { agentStateHome } from "../agent-identity.js";

/**
 * The home `~/.stigmer` hangs from: the agent's (`shared/agent-identity.ts`),
 * which is this process's `HOME` unless the runner separates (overridable
 * via HOME for tests/sandboxes).
 */
function getStigmerHome(): string {
  return agentStateHome();
}

/** Root of a session's runner-owned directory tree (outside the workspace). */
function getSessionDir(sessionId: string): string {
  return join(getStigmerHome(), ".stigmer", "sessions", sessionId);
}

/**
 * Compute the platform directory path for a session.
 *
 * Pure function — does not create the directory or perform I/O.
 */
export function getPlatformDir(sessionId: string): string {
  return join(getSessionDir(sessionId), "platform");
}

/** The offload directory of the session whose platform dir is `platformDir` (the header). Pure function. */
export function offloadDirBeside(platformDir: string): string {
  return join(dirname(platformDir), "offload");
}

/** Compute the offload directory for a session. Pure function — does not create the directory or perform I/O. */
export function getOffloadDir(sessionId: string): string {
  return offloadDirBeside(getPlatformDir(sessionId));
}

/** The Claude engine's directory of a session (the header). Pure function. */
export function getClaudeEngineDir(sessionId: string): string {
  return join(getSessionDir(sessionId), "claude");
}

/** Where the runner keeps a session's Claude transcripts on disk (the header). Pure function. */
export function getClaudeTranscriptDir(sessionId: string): string {
  return join(getClaudeEngineDir(sessionId), "transcripts");
}

/** The Claude engine's home and configuration directory for one invocation (the header). Pure function. */
export function getClaudeInvocationDir(sessionId: string, executionId: string, turnSeq: number): string {
  return join(getClaudeEngineDir(sessionId), `turn-${executionId}-${turnSeq}`);
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
  await agentFs().mkdir(getSessionDir(sessionId), { recursive: true });
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
  await agentFs().mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Compute where a real `.stigmer` entry found in a workspace is moved when the
 * platform link takes the name — `displaced/<stamp>` beside the session's
 * `platform/` and `hitl/` trees (see stigmer-link.ts). Outside the workspace,
 * so a real repo is never left holding it (issue #173) and a write-back never
 * commits it; outside `platform/`, so the agent never reads it back as
 * platform content.
 *
 * Takes the platform dir rather than a session id, unlike its siblings: the
 * link step knows only the dir it links to, and the session dir is its parent.
 * Pure function — performs no I/O.
 */
export function getDisplacedDir(platformDir: string, stamp: string): string {
  return join(dirname(platformDir), "displaced", stamp);
}
