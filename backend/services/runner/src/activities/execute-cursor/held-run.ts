/**
 * What a resumed local Cursor agent holds from the process before this one,
 * read before the turn's first send (stigmer#2487).
 *
 * Two facts, each the adapter's own to read, because the runtime learns of a
 * run only from what reached the session's log, and a runner killed in a
 * turn's first seconds left nothing there:
 *
 * - **The held run.** The SDK's store keeps the agent's newest run active
 *   until it ends, and a process killed mid-run never ends it. The store
 *   refuses a new send while one is active ("Agent <id> already has active
 *   run", `createFollowUpRun`), unless the send passes `local.force`, which
 *   expires it first. Read from the session's store (`session-store.ts`):
 *   the agent's `activeRunId` and that run's status.
 * - **The run it was sent for.** The SDK takes no caller metadata on a local
 *   run (a send's `requestId` is its own UUID), so the runner keeps its own
 *   record, beside the SDK's store on the workspace volume: after every send
 *   returns, which Stigmer run that Cursor run was sent for. A record that
 *   names this run on this agent means the agent's conversation holds the
 *   task already, so the turn continues it with the continuation prompt and
 *   never sends the task again, whatever the log says. A kill before the
 *   send returned leaves no record, and the task goes once.
 *
 * One record per session, overwritten by each send: only the newest send can
 * be the one a killed process left behind. Written by rename, so a kill
 * mid-write leaves the previous record whole.
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LocalAgentDocument, LocalAgentRunDocument } from "@cursor/sdk";

/** The record's file, in the session's SDK state root. */
export const SENT_RUN_FILE = "stigmer-sent-run.json";

/** One send as the runner records it. */
export interface SentRun {
  readonly executionId: string;
  readonly agentId: string;
  readonly runId: string;
}

/** The two store reads this module makes; the session's `SqliteLocalAgentStore` carries them. */
export interface HeldRunStore {
  readonly agents: { get(input: { readonly agentId: string }): Promise<LocalAgentDocument | null> };
  readonly runs: { get(input: { readonly agentId: string; readonly runId: string }): Promise<LocalAgentRunDocument | null> };
}

/** What the agent holds from the process before this one. */
export interface HeldRun {
  /** Its newest run is still active: a process that died left it so, and the turn's send must expire it first. */
  readonly open: boolean;
  /** The runner's record says this agent was sent this run before: its conversation holds the task. */
  readonly sentForThisRun: boolean;
}

/** Nothing held: a created agent, a cloud agent, or one whose resume failed. */
export const NOTHING_HELD: HeldRun = { open: false, sentForThisRun: false };

/** Record a send that returned its run. */
export async function recordSentRun(stateRoot: string, sent: SentRun): Promise<void> {
  const file = join(stateRoot, SENT_RUN_FILE);
  const pending = `${file}.next`;
  await writeFile(pending, `${JSON.stringify(sent)}\n`, { mode: 0o600 });
  await rename(pending, file);
}

/** The newest recorded send, or `undefined` when none was recorded or the record cannot be read as one. */
export async function readSentRun(stateRoot: string): Promise<SentRun | undefined> {
  let text: string;
  try {
    text = await readFile(join(stateRoot, SENT_RUN_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isSentRun(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** What the agent holds, read from the session's store and the runner's record. */
export async function readHeldRun(store: HeldRunStore, stateRoot: string, agentId: string, executionId: string): Promise<HeldRun> {
  const [agent, sent] = await Promise.all([store.agents.get({ agentId }), readSentRun(stateRoot)]);
  const activeRunId = agent?.activeRunId ?? null;
  const active = activeRunId === null ? null : await store.runs.get({ agentId, runId: activeRunId });
  return {
    open: active !== null && (active.status === "queued" || active.status === "running"),
    sentForThisRun: sent !== undefined && sent.executionId === executionId && sent.agentId === agentId,
  };
}

function isSentRun(value: unknown): value is SentRun {
  if (typeof value !== "object" || value === null) return false;
  const { executionId, agentId, runId } = value as Record<string, unknown>;
  return typeof executionId === "string" && typeof agentId === "string" && typeof runId === "string";
}
