import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  SubAgentSchema,
  McpAccessSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  formatSubAgentsSection,
  formatExplorationGuidance,
  buildEnhancedPrompt,
} from "../prompt-builder.js";

function makeSubAgent(name: string, description: string, mcpServers?: string[]) {
  const sa = create(SubAgentSchema);
  sa.name = name;
  sa.description = description;
  sa.instructions = "do the thing thoroughly";
  if (mcpServers) {
    sa.mcpAccess = mcpServers.map((s) => {
      const a = create(McpAccessSchema);
      a.mcpServer = s;
      return a;
    });
  }
  return sa;
}

describe("formatSubAgentsSection", () => {
  it("lists sub-agents by name and explains Task-tool delegation", () => {
    const section = formatSubAgentsSection([
      makeSubAgent("researcher", "Researches topics"),
    ]);
    expect(section).toContain("<sub_agent_delegation>");
    expect(section).toContain("Task tool");
    expect(section).toContain("**researcher**: Researches topics");
    expect(section).toContain("</sub_agent_delegation>");
  });

  it("marks MCP access as advisory and explains the inheritance caveat", () => {
    const section = formatSubAgentsSection([
      makeSubAgent("tooluser", "uses tools", ["server-a"]),
    ]);
    expect(section).toContain("MCP access (advisory): server-a");
    expect(section).toContain("advisory");
    expect(section.toLowerCase()).toContain("inherit");
  });

  it("omits the MCP caveat line when no sub-agent declares mcp access", () => {
    const section = formatSubAgentsSection([
      makeSubAgent("plain", "no tools"),
    ]);
    expect(section).not.toContain("advisory");
  });
});

describe("formatExplorationGuidance", () => {
  it("encourages the built-in explore sub-agent and discourages trivial delegation", () => {
    const g = formatExplorationGuidance();
    expect(g).toContain("<codebase_exploration>");
    expect(g).toContain("explore");
    expect(g).toContain("Task tool");
    expect(g).toContain("Do NOT delegate trivial");
  });
});

describe("buildEnhancedPrompt delegation integration", () => {
  const base = {
    instructions: "You are a test agent.",
    userMessage: "find the bug",
    skills: [],
    subAgents: [],
    workspaceFileRefs: [],
    attachmentPaths: [],
  };

  it("includes exploration guidance when a workspace dir is present", () => {
    const prompt = buildEnhancedPrompt({
      ...base,
      workspaceDirs: ["/tmp/project"],
    });
    expect(prompt).toContain("<codebase_exploration>");
  });

  it("omits exploration guidance when there is no workspace dir", () => {
    const prompt = buildEnhancedPrompt({
      ...base,
      workspaceDirs: [],
    });
    expect(prompt).not.toContain("<codebase_exploration>");
  });

  it("includes the sub-agent delegation section when blueprint sub-agents exist", () => {
    const prompt = buildEnhancedPrompt({
      ...base,
      workspaceDirs: ["/tmp/project"],
      subAgents: [makeSubAgent("researcher", "Researches topics")],
    });
    expect(prompt).toContain("<sub_agent_delegation>");
    expect(prompt).toContain("**researcher**");
  });
});
