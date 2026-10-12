/**
 * Pins which ask each session event opens or closes (../gates.ts): a tool
 * use (built-in or MCP) opens its own gate only when it asks; its answer
 * and its result close it; every other event has none; and the declaration
 * the store derives with reads the same from an event's bytes, lists every
 * type that can carry a gate, and gives bytes that do not decode none.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { eventTypeOf } from "../catalog.js";
import { SESSION_EVENT_GATES, gatesOfEvent } from "../gates.js";

const event = (value: MessageInitShape<typeof SessionEventSchema>["event"]) => create(SessionEventSchema, { event: value });

const CASES = [
  {
    name: "a tool use that asks opens its own gate",
    event: event({ case: "agentToolUse", value: { id: "u1", name: "write", input: {}, evaluatedPermission: "ask" } }),
    gates: { opens: "u1", closes: "" },
  },
  {
    name: "an MCP tool use that asks opens its own gate",
    event: event({
      case: "agentMcpToolUse",
      value: { id: "u2", name: "delete_repo", mcpServerName: "github", input: {}, evaluatedPermission: "ask" },
    }),
    gates: { opens: "u2", closes: "" },
  },
  {
    name: "a tool use that does not ask opens nothing",
    event: event({ case: "agentToolUse", value: { id: "u3", name: "read", input: {}, evaluatedPermission: "allow" } }),
    gates: { opens: "", closes: "" },
  },
  {
    name: "an MCP tool use that does not ask opens nothing",
    event: event({ case: "agentMcpToolUse", value: { id: "u4", name: "list", mcpServerName: "github", input: {} } }),
    gates: { opens: "", closes: "" },
  },
  {
    name: "an answer closes the gate it names",
    event: event({ case: "userToolConfirmation", value: { id: "c1", result: "deny", toolUseId: "u1" } }),
    gates: { opens: "", closes: "u1" },
  },
  {
    name: "a result closes its tool use's gate",
    event: event({ case: "agentToolResult", value: { id: "u1.r", toolUseId: "u1" } }),
    gates: { opens: "", closes: "u1" },
  },
  {
    name: "an MCP result closes its tool use's gate",
    event: event({ case: "agentMcpToolResult", value: { id: "u2.r", mcpToolUseId: "u2" } }),
    gates: { opens: "", closes: "u2" },
  },
  {
    name: "any other event has no gate",
    event: event({ case: "agentMessage", value: { id: "m1" } }),
    gates: { opens: "", closes: "" },
  },
];

describe("an event's gates", () => {
  it.each(CASES)("$name", ({ event: e, gates }) => {
    expect(gatesOfEvent(e)).toEqual(gates);
    expect(SESSION_EVENT_GATES.gatesOf(eventTypeOf(e), toBinary(SessionEventSchema, e))).toEqual(gates);
  });

  it("the declaration lists every type that can carry a gate, and no other", () => {
    const gated = CASES.filter((c) => c.gates.opens !== "" || c.gates.closes !== "").map((c) => eventTypeOf(c.event));
    expect([...SESSION_EVENT_GATES.types].sort()).toEqual([...new Set(gated)].sort());
  });

  it("bytes that do not decode name no gate", () => {
    expect(SESSION_EVENT_GATES.gatesOf("agent.tool_use", new Uint8Array([0xff, 0xff, 0xff]))).toEqual({ opens: "", closes: "" });
  });
});
