/**
 * Test support: writes into a session's log the asks a runner writes for
 * the calls of a run that wait for an answer (an `agent.tool_use`, or
 * `agent.mcp_tool_use` for a call of an MCP server, with
 * evaluated_permission `ask`, under the id the runner derives, and its
 * `stigmer.permission.asked` with the rule that asked as one word and its
 * hook), so a test that seeds a waiting run holds the log the server
 * decides what waits from. A sub-agent's call is written in its thread.
 */
import { create } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../../../store/interface.js";
import { draftOf } from "../../events/codec.js";
import { toolUseEventId } from "../../events/ids.js";
import { sessionIdOfRun } from "../../events/transitions.js";

/** One call that asks, as the runner writes it. */
export interface AskedCall {
  /** The provider's call id. */
  readonly id: string;
  readonly name: string;
  /** The MCP server the tool belongs to; absent for a built-in. */
  readonly server?: string;
  /** The asked event's policy source word; "hook" when `hook` is given, else empty. */
  readonly policySource?: string;
  /** The plugin whose hook asked; set only for a hook's ask. */
  readonly hook?: string;
  /** The sub-agent's thread the call ran in; absent for the root. */
  readonly threadId?: string;
}

/** A call's tool use and its asked event. */
export function askOf(runId: string, call: AskedCall): SessionEvent[] {
  const id = toolUseEventId(runId, call.id);
  const threadId = call.threadId ?? "";
  const policySource = call.policySource ?? (call.hook === undefined ? "" : "hook");
  const asked = create(SessionEventSchema, {
    runId,
    threadId,
    event: {
      case: "stigmerPermissionAsked",
      value: { id: `${id}.ask`, toolUseId: id, policySource, policyHook: call.hook ?? "" },
    },
  });
  const use = create(SessionEventSchema, {
    runId,
    threadId,
    event:
      call.server === undefined || call.server === ""
        ? {
            case: "agentToolUse",
            value: { id, name: call.name, input: {}, evaluatedPermission: "ask", sessionThreadId: threadId },
          }
        : {
            case: "agentMcpToolUse",
            value: {
              id,
              name: call.name,
              mcpServerName: call.server,
              input: {},
              evaluatedPermission: "ask",
              sessionThreadId: threadId,
            },
          },
  });
  return [use, asked];
}

/** Appends the asks of `calls` to the stored run's session's log; none for a run in no session. */
export async function appendAsks(store: Store, runId: string, calls: ReadonlyArray<AskedCall>): Promise<void> {
  const run = await store.getResource(ApiResourceKind.run, runId, RunSchema);
  const sessionId = sessionIdOfRun(run);
  if (sessionId === "" || calls.length === 0) {
    return;
  }
  await store.sessionEvents.append(
    sessionId,
    run.metadata?.org ?? "",
    calls.flatMap((call) => askOf(runId, call)).map(draftOf),
    {
      kind: ApiResourceKind.run,
      id: runId,
      schema: RunSchema,
      admit: () => undefined,
    },
  );
}
