/**
 * Warm-pool attach activities.
 *
 * Registered in the standard activity set (both runner and runner-manager
 * copies) but functional only inside a pool member: they read the pool
 * context registered by the pool boot path (see pool-member.ts) and fail
 * fast everywhere else. The control plane schedules them on the member's
 * control queue `sandbox:{memberId}`, which only a pool member ever polls.
 *
 * Activity contracts (invoked by the cloud ClaimPoolMemberWorkflow):
 *
 *   Name:   "ProbePoolMember"
 *   Input:  none
 *   Output: string (the member id — proof the member is booted and polling)
 *
 *   Name:   "AttachSession"
 *   Input:  (sessionId: string)
 *   Output: string (the session task queue now being polled)
 *
 * AttachSession is the claim hand-off: exchange the member's pool_sandbox
 * credential for the session's sandbox token (the control plane authorizes
 * against the claim record), push the session token to every credential sink
 * via the manager, then start the session worker. From the returned ack
 * onward the member serves `session:{sessionId}` like any provisioned
 * sandbox. The control worker keeps polling its (now permanently idle)
 * control queue — the claim deleted the pool row, so nothing dispatches
 * there again, and the worker disappears with the next pod restart; tearing
 * down the worker an activity is running on would deadlock the teardown.
 */

import type { Config } from "../config.js";
import { StigmerClient } from "../client/stigmer-client.js";
import { activityStarted, activityFinished } from "../idle-watchdog.js";
import { getPoolMemberContext } from "../pool-member.js";
import { TimingRecorder, emitTimingLog } from "../shared/cold-start-timing.js";

export function createAttachSessionActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
    tokenRef: config.stigmerTokenRef,
    runnerTokenRef: config.stigmerRunnerTokenRef,
  });

  return {
    ProbePoolMember: async (): Promise<string> => {
      activityStarted();
      try {
        const pool = getPoolMemberContext();
        if (!pool) {
          throw new Error(
            "ProbePoolMember invoked outside a pool member (no pool context registered)",
          );
        }
        return pool.memberId;
      } finally {
        activityFinished();
      }
    },

    AttachSession: async (sessionId: string): Promise<string> => {
      activityStarted();
      const timing = new TimingRecorder();
      try {
        const pool = getPoolMemberContext();
        if (!pool) {
          throw new Error(
            "AttachSession invoked outside a pool member (no pool context registered)",
          );
        }
        if (!sessionId) {
          throw new Error("AttachSession requires a session id");
        }

        const scoped = await client.getRunnerScopedToken(
          { poolClaimSessionId: sessionId },
          pool.poolToken,
        );
        timing.mark("exchange_token");
        if (!scoped) {
          // Unlike the desktop exchange, there is no credential to fall back
          // to: a pool token cannot serve session work, so an empty mint is a
          // hard failure and the control plane discards this member.
          throw new Error(
            "control plane minted no session token for the pool claim " +
              `(member=${pool.memberId}, session=${sessionId})`,
          );
        }

        pool.manager.updateToken(scoped.token);
        timing.mark("token_applied");

        await pool.manager.addSession(sessionId);
        timing.mark("session_worker_added");

        const taskQueue = `session:${sessionId}`;
        emitTimingLog("pool_attach", {
          pool_member_id: pool.memberId,
          session_id: sessionId,
          task_queue: taskQueue,
        }, timing);
        console.log(
          `[attach-session] Pool member ${pool.memberId} attached to session ` +
            `${sessionId} (queue=${taskQueue})`,
        );
        return taskQueue;
      } finally {
        activityFinished();
      }
    },
  };
}
