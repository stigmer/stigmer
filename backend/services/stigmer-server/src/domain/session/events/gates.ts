/**
 * Which ask each session event opens or closes: the derivation the domain
 * hands the store at open (StoreOpenOptions.sessionEventGates), so the
 * store keeps every event's gates in columns beside its bytes and answers
 * "what waits" without decoding the log (store/session-events.ts, "Gates").
 *
 *   agent.tool_use / agent.mcp_tool_use with evaluated_permission "ask"
 *       opens the gate named by its own id: the call waits for a person.
 *   user.tool_confirmation, agent.tool_result, agent.mcp_tool_result
 *       close the gate of the tool use they name: the call was answered,
 *       or it ran (or was refused) and returned.
 *
 * Every other event has no gate. A change to this rule bumps `revision`,
 * and the store re-derives every stored event at the next open, the way
 * list keys are (store/list-index.ts); that is also how the asks a log
 * held before the columns existed gain their gates.
 *
 * Proven by __tests__/gates.test.ts and, per driver, by the gate cases of
 * the session event store kit (store/session-events-contract.ts).
 */
import { fromBinary } from "@bufbuild/protobuf";

import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { NO_SESSION_EVENT_GATES } from "../../../store/session-events.js";
import type {
  SessionEventGateDeclaration,
  SessionEventGates,
} from "../../../store/session-events.js";

/** The permission a tool use that waits for a person carries. */
export const ASK_PERMISSION = "ask";

/** The gates an event opens and closes. */
export function gatesOfEvent(event: SessionEvent): SessionEventGates {
  switch (event.event.case) {
    case "agentToolUse":
    case "agentMcpToolUse":
      return event.event.value.evaluatedPermission === ASK_PERMISSION
        ? { opens: event.event.value.id, closes: "" }
        : NO_SESSION_EVENT_GATES;
    case "userToolConfirmation":
    case "agentToolResult":
      return { opens: "", closes: event.event.value.toolUseId };
    case "agentMcpToolResult":
      return { opens: "", closes: event.event.value.mcpToolUseId };
    default:
      return NO_SESSION_EVENT_GATES;
  }
}

/** The declaration the composition root opens the store with. */
export const SESSION_EVENT_GATES: SessionEventGateDeclaration = {
  revision: 1,
  types: [
    "agent.tool_use",
    "agent.mcp_tool_use",
    "user.tool_confirmation",
    "agent.tool_result",
    "agent.mcp_tool_result",
  ],
  gatesOf(_type, data) {
    let event: SessionEvent;
    try {
      event = fromBinary(SessionEventSchema, data);
    } catch {
      // An event that does not decode names no call: it neither opens nor
      // closes anything.
      return NO_SESSION_EVENT_GATES;
    }
    return gatesOfEvent(event);
  },
};
