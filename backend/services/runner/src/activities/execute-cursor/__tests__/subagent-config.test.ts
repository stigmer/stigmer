/**
 * The blueprint sub-agents as the Cursor SDK registers them: the
 * `AgentDefinition` map and the `Agent(type, …)` filter in front of it. Pins
 * the field mapping and fallbacks, that no definition carries an MCP config
 * (the SDK gives sub-agents the parent's), and that a custom type the main
 * agent's lists do not allow is never registered.
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ToolScope } from "../../../shared/tool-lists.js";
import { buildCursorSubAgentDefinitions, subAgentsInScope } from "../subagent-config.js";

function makeSubAgent(opts: {
  name: string;
  description?: string;
  instructions?: string;
  modelOverride?: string;
}) {
  const sa = create(SubAgentSchema);
  sa.name = opts.name;
  sa.description = opts.description ?? "";
  sa.instructions = opts.instructions ?? "";
  sa.modelOverride = opts.modelOverride ?? "";
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
      }),
    ]);
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

  it("keeps only the types the main agent's Agent(type, …) allows, matched case-insensitively", () => {
    const subAgents = [
      makeSubAgent({ name: "Researcher", instructions: "research it" }),
      makeSubAgent({ name: "writer", instructions: "write it" }),
    ];
    const scope = ToolScope.of('Agent "a"', { tools: ["Read", "Agent(researcher)"], disallowedTools: [] });
    expect(subAgentsInScope(subAgents, scope).map((sa) => sa.name)).toEqual(["Researcher"]);
    expect(subAgentsInScope(subAgents, ToolScope.unrestricted())).toHaveLength(2);
    const noAgent = ToolScope.of('Agent "a"', { tools: [], disallowedTools: ["Agent"] });
    expect(subAgentsInScope(subAgents, noAgent)).toEqual([]);
  });

  it("registers multiple sub-agents", () => {
    const agents = buildCursorSubAgentDefinitions([
      makeSubAgent({ name: "one", description: "d1", instructions: "instr one" }),
      makeSubAgent({ name: "two", description: "d2", instructions: "instr two" }),
    ]);
    expect(Object.keys(agents!).sort()).toEqual(["one", "two"]);
  });
});
