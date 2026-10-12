// What waits for a person, and the answers given, as the session's event log
// states them.
// Domain: conformance support (approvals are session events).
//
// A tool use that needs a person's answer is an agent.tool_use (or
// agent.mcp_tool_use) with evaluated_permission "ask", and the session goes
// idle with stop_reason requires_action whose event_ids name every call
// still waiting. A client answers by those ids
// (SessionCommandController.confirmToolUse / grantPermission); each answer
// is a user.tool_confirmation (and a grant a stigmer.permission.grant) in
// the same log. These helpers read that log the way a client does: the ids
// to answer come from the newest idle, never from a run's rows.
//
// `confirmPerContract` is the answer-side twin of submitApprovalPerContract
// (runs.ts): an answer recomputes the run's pending_approvals in the same
// write that records it, so the run read right after the answer must carry
// what remains, and a decision the server failed to record is red at the
// answer that made it. `expect` is imported at the call for the reason
// runs.ts gives.
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { ConformanceClients } from "../harness/clients";
import { type PollCoreOptions, pollUntil } from "./run-poll";

// A session's whole log, oldest first.
export async function sessionLog(clients: ConformanceClients, sessionId: string): Promise<SessionEvent[]> {
  return (await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000 })).events;
}

// The newest session status event's stop reason, as `[type, event_ids]`;
// undefined while the session has none or reads running.
export function newestIdle(events: ReadonlyArray<SessionEvent>): { type: string; eventIds: string[] } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!.event;
    if (event.case === "sessionStatusRunning") {
      return undefined;
    }
    if (event.case === "sessionStatusIdle") {
      return { type: event.value.stopReason?.type ?? "", eventIds: [...(event.value.stopReason?.eventIds ?? [])] };
    }
  }
  return undefined;
}

// Waits until the session's newest status is idle with requires_action
// naming exactly `count` calls, and answers their tool use ids, oldest first.
export async function awaitRequiresAction(
  clients: ConformanceClients,
  sessionId: string,
  count: number,
  opts: PollCoreOptions = {},
): Promise<string[]> {
  const events = await pollUntil(
    () => sessionLog(clients, sessionId),
    (got) => {
      const idle = newestIdle(got);
      return idle?.type === "requires_action" && idle.eventIds.length === count;
    },
    (last, timeoutMs) =>
      `session ${sessionId} did not go idle with requires_action naming ${count} call(s) within ${timeoutMs}ms ` +
      `(newest status: ${JSON.stringify(newestIdle(last ?? []) ?? "running or none")})`,
    opts,
  );
  return newestIdle(events)!.eventIds;
}

// Waits until the session's newest status is idle with stop reason `reason`.
export async function awaitIdleWith(
  clients: ConformanceClients,
  sessionId: string,
  reason: string,
  opts: PollCoreOptions = {},
): Promise<void> {
  await pollUntil(
    () => sessionLog(clients, sessionId),
    (got) => newestIdle(got)?.type === reason,
    (last, timeoutMs) =>
      `session ${sessionId} did not go idle with ${reason} within ${timeoutMs}ms ` +
      `(newest status: ${JSON.stringify(newestIdle(last ?? []) ?? "running or none")})`,
    opts,
  );
}

// The answers recorded on `runId`'s calls, in log order, as
// `<tool use id> <result>[ "<deny message>"]` for a confirmation and
// `grant <tool use id>` for a grant.
export async function answersOf(clients: ConformanceClients, sessionId: string, runId: string): Promise<string[]> {
  const { events } = await clients.sessionQuery.listEvents({
    sessionId,
    runId,
    types: ["user.tool_confirmation", "stigmer.permission.grant"],
    pageSize: 1000,
  });
  return events.map((event) => {
    switch (event.event.case) {
      case "userToolConfirmation": {
        const { toolUseId, result, denyMessage } = event.event.value;
        return denyMessage === "" ? `${toolUseId} ${result}` : `${toolUseId} ${result} "${denyMessage}"`;
      }
      case "stigmerPermissionGrant":
        return `grant ${event.event.value.toolUseId}`;
      default:
        return String(event.event.case);
    }
  });
}

export interface ConfirmPerContractOptions {
  clients: ConformanceClients;
  // The run whose pending_approvals the contract is asserted on.
  runId: string;
  // Gives the answer (confirmToolUse or grantPermission).
  answer: () => Promise<unknown>;
  // pending_approvals the run must carry right after the answer.
  expectedRemaining: number;
  label: string;
}

// Answers per the contract and returns the run the contract held on.
export async function confirmPerContract(opts: ConfirmPerContractOptions): Promise<Run> {
  const { expect } = await import("vitest");
  await opts.answer();
  const run = await opts.clients.agentExecutionQuery.get({ value: opts.runId });
  // The turn may already have resumed past the gate once nothing waits; a
  // remainder is only stable while something still does.
  expect(run.status?.pendingApprovals.length, opts.label).toBe(opts.expectedRemaining);
  return run;
}
