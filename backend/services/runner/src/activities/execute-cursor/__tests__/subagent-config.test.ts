import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  SubAgentSchema,
  McpAccessSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { buildCursorSubAgentDefinitions } from "../subagent-config.js";

function makeSubAgent(opts: {
  name: string;
  description?: string;
  instructions?: string;
  modelOverride?: string;
  mcpServers?: string[];
}) {
  const sa = create(SubAgentSchema);
  sa.name = opts.name;
  sa.description = opts.description ?? "";
  sa.instructions = opts.instructions ?? "";
  sa.modelOverride = opts.modelOverride ?? "";
  if (opts.mcpServers) {
    sa.mcpAccess = opts.mcpServers.map((s) => {
      const a = create(McpAccessSchema);
      a.mcpServer = s;
      return a;
    });
  }
  return sa;
}

describe("buildCursorSubAgentDefinitions", () => {
  it("returns undefined for an empty list", () => {
    expect(buildCursorSubAgentDefinitions([])).toBeUndefined();
  });

  it("maps name/description/instructions to an AgentDefinition keyed by name", () => {
    const agents = buildCursorSubAgentDefinitions([
      makeSubAgent({
        name: "researcher",
        description: "Researches topics",
        instructions: "You are a researcher. Be concise and factual.",
      }),
    ]);

    expect(agents).toBeDefined();
    expect(Object.keys(agents!)).toEqual(["researcher"]);
    expect(agents!.researcher.description).toBe("Researches topics");
    expect(agents!.researcher.prompt).toBe(
      "You are a researcher. Be concise and factual.",
    );
    // Inherits the parent model unless overridden.
    expect(agents!.researcher.model).toBe("inherit");
  });

  it("uses modelOverride when present", () => {
    const agents = buildCursorSubAgentDefinitions([
      makeSubAgent({
        name: "fast",
        description: "d",
        instructions: "do the thing",
        modelOverride: "claude-haiku",
      }),
    ]);
    expect(agents!.fast.model).toEqual({ id: "claude-haiku" });
  });

  it("does NOT expose mcpServers on the definition (Cursor sub-agents inherit parent MCP config)", () => {
    const agents = buildCursorSubAgentDefinitions([
      makeSubAgent({
        name: "tooluser",
        description: "uses tools",
        instructions: "use the echo tool",
        mcpServers: ["server-a", "server-b"],
      }),
    ]);
    // The SDK has no per-sub-agent MCP filtering; mcp_access is advisory only.
    expect(agents!.tooluser.mcpServers).toBeUndefined();
  });

  it("falls back to description, then name, when instructions are empty", () => {
    const fromDescription = buildCursorSubAgentDefinitions([
      makeSubAgent({ name: "a", description: "the description", instructions: "" }),
    ]);
    expect(fromDescription!.a.prompt).toBe("the description");

    const fromName = buildCursorSubAgentDefinitions([
      makeSubAgent({ name: "b", description: "", instructions: "" }),
    ]);
    expect(fromName!.b.prompt).toBe("b");
  });

  it("skips entries with a blank name (unaddressable) and returns undefined if none remain", () => {
    expect(
      buildCursorSubAgentDefinitions([
        makeSubAgent({ name: "   ", description: "d", instructions: "do it now" }),
      ]),
    ).toBeUndefined();
  });

  it("registers multiple sub-agents", () => {
    const agents = buildCursorSubAgentDefinitions([
      makeSubAgent({ name: "one", description: "d1", instructions: "instr one" }),
      makeSubAgent({ name: "two", description: "d2", instructions: "instr two" }),
    ]);
    expect(Object.keys(agents!).sort()).toEqual(["one", "two"]);
  });
});
