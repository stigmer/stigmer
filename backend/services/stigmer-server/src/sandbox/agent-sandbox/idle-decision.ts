/**
 * The idle sweep's decision for one session's Sandbox, as a pure function
 * kept apart from the calls it leads to, so every case is a row in a table
 * test: whether to suspend it now.
 *
 *   - A busy session is never touched: a run that is pending, running,
 *     waiting on a person or paused keeps its pod.
 *   - A Running Sandbox whose session has been idle for `suspendAfter` is
 *     suspended: its pod goes, its claim stays, and the next message wakes
 *     it over the same files.
 *   - A Sandbox that is already Suspended, or being deleted, is left alone.
 *
 * There is one step, where the substrate driver has two: agent-sandbox has
 * no state between a running pod and none, so nothing is gained by waiting
 * in one.
 */
import type { AgentSandboxOperatingMode } from "./resource.js";

export interface IdleInput {
  readonly operatingMode: AgentSandboxOperatingMode;
  readonly deleting: boolean;
  readonly busy: boolean;
  /** The latest of the session's last activity, this server's last ensure, and the Sandbox's creation. */
  readonly lastActiveAt: Date;
  readonly now: Date;
  readonly suspendAfterMs: number;
}

export function shouldSuspend(input: IdleInput): boolean {
  if (input.busy || input.deleting || input.operatingMode !== "Running") {
    return false;
  }
  return (
    input.now.getTime() - input.lastActiveAt.getTime() >= input.suspendAfterMs
  );
}
