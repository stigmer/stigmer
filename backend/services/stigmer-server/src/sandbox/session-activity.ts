/**
 * The server's read of its sessions for a sandbox driver's background
 * work (provisioner.ts, SessionActivityReader), over the store alone.
 *
 * Open source keeps no record of its sandboxes, so a driver that puts
 * idle sandboxes to sleep learns everything from the records the server
 * already has: a session's executions say whether it is busy and when it
 * was last active, and the session kind names every session a sandbox
 * can belong to. Both reads are indexed patterns the store already
 * serves (the executions' `session` list-index key; the keyset page by
 * id), so this module adds no query pattern and no index.
 *
 * The activity clock is an execution's creation
 * (`status.audit.spec_audit.created_at`, stamped by the server) and, once it
 * ends, its completion (`status.completed_at`, which the server stamps on
 * its own transitions and copies from the runner's status report
 * otherwise). A stamp later than now is read as now, so a runner whose
 * clock runs ahead cannot keep its sandbox awake. An execution that has not
 * ended is in an active phase, which makes the session busy, so its
 * progress never needs a clock.
 */
import { fromBinary } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../boot/logger.js";
import { agentExecutionListIndex } from "../domain/agentexecution/list-index.js";
import { isActiveExecutionPhase } from "../domain/agentexecution/phases.js";
import type { Store } from "../store/interface.js";
import type { SessionActivity, SessionActivityReader } from "./provisioner.js";

/** Sessions read per keyset page while mapping sandboxes back to sessions. */
const SESSION_PAGE_SIZE = 500;

export function newStoreSessionActivityReader(
  store: Store,
  logger: Logger,
  now: () => number = Date.now,
): SessionActivityReader {
  return {
    async activity(sessionId: string): Promise<SessionActivity> {
      const rows = await store.queryResources(agentExecutionListIndex, {
        anyKey: [{ name: "session", value: sessionId }],
      });
      const executions: AgentExecution[] = [];
      for (const row of rows) {
        try {
          executions.push(fromBinary(AgentExecutionSchema, row.data));
        } catch (error) {
          logger.warn("Failed to unmarshal execution, skipping", {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return sessionActivityOf(executions, now());
    },

    async *sessionIds(): AsyncIterable<string> {
      let after = "";
      for (;;) {
        const page = await store.findResourcesRawOrderedAfter(
          ApiResourceKind.session,
          after,
          SESSION_PAGE_SIZE,
        );
        for (const document of page) {
          yield document.id;
        }
        if (page.length < SESSION_PAGE_SIZE) {
          return;
        }
        after = page[page.length - 1]?.id ?? after;
      }
    },
  };
}

/** Busy and the latest stamp over one session's executions, none later than `nowMs`. */
export function sessionActivityOf(
  executions: readonly AgentExecution[],
  nowMs: number,
): SessionActivity {
  let busy = false;
  let last: number | undefined;
  const seen = (stamp: number | undefined): void => {
    if (stamp === undefined) return;
    const ms = Math.min(stamp, nowMs);
    if (last === undefined || ms > last) {
      last = ms;
    }
  };
  for (const execution of executions) {
    const status = execution.status;
    if (status === undefined) {
      continue;
    }
    if (isActiveExecutionPhase(status.phase)) {
      busy = true;
    }
    const createdAt = status.audit?.specAudit?.createdAt;
    seen(
      createdAt === undefined ? undefined : timestampDate(createdAt).getTime(),
    );
    if (status.completedAt !== "") {
      const completed = Date.parse(status.completedAt);
      seen(Number.isNaN(completed) ? undefined : completed);
    }
  }
  return {
    busy,
    lastActiveAt: last === undefined ? undefined : new Date(last),
  };
}
