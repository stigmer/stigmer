/**
 * Test support: writes into a session's log the asks a runner writes for a
 * run's waiting rows (an `agent.tool_use`, or `agent.mcp_tool_use`, with
 * evaluated_permission `ask`, under the id the runner derives), so a test
 * that seeds a gated run straight into the store holds the log the server
 * decides what waits from. Rows of a sub-agent are written in its thread.
 */
import { create } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../../../store/interface.js";
import { draftOf } from "../../events/codec.js";
import { toolUseEventId } from "../../events/ids.js";
import { sessionIdOfRun } from "../../events/transitions.js";

function askOf(runId: string, call: ToolCall, threadId: string): SessionEvent {
  const id = toolUseEventId(runId, call.id);
  return create(SessionEventSchema, {
    runId,
    threadId,
    event:
      call.mcpServerSlug === ""
        ? {
            case: "agentToolUse",
            value: { id, name: call.name, input: {}, evaluatedPermission: "ask", sessionThreadId: threadId },
          }
        : {
            case: "agentMcpToolUse",
            value: {
              id,
              name: call.name,
              mcpServerName: call.mcpServerSlug,
              input: {},
              evaluatedPermission: "ask",
              sessionThreadId: threadId,
            },
          },
  });
}

/** The ask events of every row of `run` that asked, as the runner writes them. */
export function asksOf(run: Run): SessionEvent[] {
  const runId = run.metadata?.id ?? "";
  const asks: SessionEvent[] = [];
  for (const message of run.status?.messages ?? []) {
    for (const call of message.toolCalls) {
      if (call.requiresApproval) {
        asks.push(askOf(runId, call, ""));
      }
    }
  }
  for (const subAgent of run.status?.subAgentRuns ?? []) {
    const threadId = toolUseEventId(runId, subAgent.id);
    for (const message of subAgent.messages) {
      for (const call of message.toolCalls) {
        if (call.requiresApproval) {
          asks.push(askOf(runId, call, threadId));
        }
      }
    }
  }
  return asks;
}

/** Appends the stored run's asks to its session's log; none for a run in no session. */
export async function appendAsks(store: Store, runId: string): Promise<void> {
  const run = await store.getResource(ApiResourceKind.run, runId, RunSchema);
  const sessionId = sessionIdOfRun(run);
  const asks = asksOf(run);
  if (sessionId === "" || asks.length === 0) {
    return;
  }
  await store.sessionEvents.append(sessionId, run.metadata?.org ?? "", asks.map(draftOf), {
    kind: ApiResourceKind.run,
    id: runId,
    schema: RunSchema,
    admit: () => undefined,
  });
}
