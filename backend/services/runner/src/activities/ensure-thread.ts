/**
 * EnsureThread Temporal activity — resolves a LangGraph thread ID for an
 * agent execution.
 *
 * Called by the server's InvokeAgentExecutionWorkflow as Step 1 of the
 * Stigmer harness flow, before ExecuteDeepAgent. The returned
 * thread ID keys the LangGraph checkpointer for conversation continuity.
 *
 * Thread ID conventions (load-bearing for proxy authorization):
 *   - Session-based:  "thread-{sessionId}"   — deterministic, no DB call
 *   - Ephemeral:      "ephemeral-{agentId}-{8hex}" — single-use
 *
 * The "thread-{sessionId}" prefix is parsed by ProxyAuthorizationService
 * (stigmer-cloud) to extract the session ID for checkpoint access control.
 * Changing the format requires a coordinated update.
 *
 * Activity contract:
 *   Name:   "EnsureThread"
 *   Input:  (sessionId: string, agentId: string)
 *   Output: string (thread ID)
 */

import { randomUUID } from "node:crypto";
import { ENSURE_THREAD_ACTIVITY_NAME } from "@stigmer/temporal-codecs/activity-names";
import { activityStarted, activityFinished } from "../idle-watchdog.js";

export function createEnsureThreadActivities() {
  return {
    // Registered under the name the server's workflow schedules, declared once for both.
    [ENSURE_THREAD_ACTIVITY_NAME]: async (sessionId: string, agentId: string): Promise<string> => {
      activityStarted();
      try {
        if (sessionId) {
          const threadId = `thread-${sessionId}`;
          console.log(`[EnsureThread] Session-based thread: ${threadId}`);
          return threadId;
        }

        const threadId = `ephemeral-${agentId}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
        console.log(`[EnsureThread] Ephemeral thread: ${threadId}`);
        return threadId;
      } finally {
        activityFinished();
      }
    },
  };
}
