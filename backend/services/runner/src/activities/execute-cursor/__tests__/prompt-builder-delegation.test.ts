/**
 * The Cursor prompt's delegation sections: the subagents the main agent may
 * start (the saved agents it lists and the plugins' agents), how to reach
 * them through the Task tool, and the guidance toward Cursor's built-in
 * explore sub-agent. Pins that the section names each subagent and the
 * model it runs on when it runs on its own, and carries no tool-access
 * prose (a subagent's tools are its lists' business, enforced, not
 * prompted).
 */
import { describe, it, expect } from "vitest";
import {
  formatSubAgentsSection,
  formatExplorationGuidance,
  buildEnhancedPrompt,
  type PromptSubagent,
} from "../prompt-builder.js";

function makeSubAgent(name: string, description: string, model?: string): PromptSubagent {
  return { name, description, model };
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

  it("names a sub-agent's model override", () => {
    const section = formatSubAgentsSection([makeSubAgent("fast", "quick lookups", "claude-haiku"), makeSubAgent("same", "the turn's model")]);
    expect(section).toContain("**fast**: quick lookups\n  Model: claude-haiku");
    expect(section, "a subagent on the turn's model names none").not.toContain("**same**: the turn's model\n  Model:");
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
    files: { message: [], conversation: [], references: [] },
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
