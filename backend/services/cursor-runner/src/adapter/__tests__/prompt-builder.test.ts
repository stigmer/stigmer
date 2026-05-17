import { describe, it, expect } from "vitest";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  buildEnhancedPrompt,
  buildReinvocationPrompt,
  formatResponseRules,
  formatWorkspaceContext,
  sanitizeWorkspaceDirs,
} from "../prompt-builder.js";
import type { EnhancedPromptOptions } from "../prompt-builder.js";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

function makeOptions(overrides: Partial<EnhancedPromptOptions> = {}): EnhancedPromptOptions {
  return {
    instructions: overrides.instructions ?? "You are a helpful coding assistant.",
    userMessage: overrides.userMessage ?? "Fix the bug",
    skills: overrides.skills ?? [],
    subAgents: overrides.subAgents ?? [],
    workspaceDirs: overrides.workspaceDirs ?? ["/workspace/project"],
    workspaceFileRefs: overrides.workspaceFileRefs ?? [],
    attachmentPaths: overrides.attachmentPaths ?? [],
    interactionMode: overrides.interactionMode,
  };
}

describe("buildEnhancedPrompt", () => {
  it("includes user_request section", () => {
    const result = buildEnhancedPrompt(makeOptions());
    expect(result).toContain("<user_request>");
    expect(result).toContain("Fix the bug");
    expect(result).toContain("</user_request>");
  });

  it("includes instructions when provided", () => {
    const result = buildEnhancedPrompt(makeOptions({
      instructions: "You are a security expert.",
    }));
    expect(result).toContain("<agent_instructions>");
    expect(result).toContain("You are a security expert.");
  });

  it("omits response rules when instructions are present", () => {
    const result = buildEnhancedPrompt(makeOptions({
      instructions: "You are a helpful assistant.",
    }));
    expect(result).not.toContain("<response_rules>");
  });

  it("includes response rules when instructions are empty", () => {
    const result = buildEnhancedPrompt(makeOptions({
      instructions: "",
    }));
    expect(result).toContain("<response_rules>");
  });

  it("omits workspace context for single-dir setup", () => {
    const result = buildEnhancedPrompt(makeOptions({
      workspaceDirs: ["/workspace/project"],
    }));
    expect(result).not.toContain("<workspace>");
  });

  it("includes workspace context for multi-dir setup", () => {
    const result = buildEnhancedPrompt(makeOptions({
      workspaceDirs: ["/workspace/frontend", "/workspace/backend"],
    }));
    expect(result).toContain("<workspace>");
    expect(result).toContain("Multi-root workspace");
    expect(result).toContain("/workspace/frontend");
    expect(result).toContain("/workspace/backend");
  });

  it("includes skills section when skills are provided", () => {
    const result = buildEnhancedPrompt(makeOptions({
      skills: [{ name: "Python", description: "Python expert", path: "/skills/python/SKILL.md" }],
    }));
    expect(result).toContain("<available_skills>");
    expect(result).toContain("Python");
  });

  it("includes plan mode prefix when in Plan mode", () => {
    const result = buildEnhancedPrompt(makeOptions({
      interactionMode: InteractionMode.PLAN,
    }));
    expect(result).toContain("<interaction_mode>");
    expect(result).toContain("Plan mode");
  });

  it("separates sections with dividers", () => {
    const result = buildEnhancedPrompt(makeOptions({
      instructions: "Be helpful.",
    }));
    expect(result).toContain("---");
  });

  it("includes input files when provided", () => {
    const result = buildEnhancedPrompt(makeOptions({
      attachmentPaths: ["/workspace/readme.md"],
    }));
    expect(result).toContain("<input_files>");
    expect(result).toContain("/workspace/readme.md");
  });

  it("includes referenced files when provided", () => {
    const result = buildEnhancedPrompt(makeOptions({
      workspaceFileRefs: ["src/app.ts"],
    }));
    expect(result).toContain("<referenced_files>");
    expect(result).toContain("src/app.ts");
  });
});

describe("sanitizeWorkspaceDirs", () => {
  it("filters out runner-internal paths", () => {
    const dirs = [
      "/workspace/project",
      "/home/user/.stigmer/runtimes/cursor-runner/data",
    ];
    const result = sanitizeWorkspaceDirs(dirs);
    expect(result).toEqual(["/workspace/project"]);
  });

  it("keeps safe workspace directories", () => {
    const dirs = ["/workspace/frontend", "/workspace/backend"];
    const result = sanitizeWorkspaceDirs(dirs);
    expect(result).toEqual(dirs);
  });
});

describe("formatResponseRules", () => {
  it("returns response_rules XML block", () => {
    const result = formatResponseRules();
    expect(result).toContain("<response_rules>");
    expect(result).toContain("</response_rules>");
  });
});

describe("formatWorkspaceContext", () => {
  it("formats single directory", () => {
    const result = formatWorkspaceContext(["/workspace"]);
    expect(result).toContain("Working directory: /workspace");
  });

  it("formats multiple directories with numbering", () => {
    const result = formatWorkspaceContext(["/a", "/b"]);
    expect(result).toContain("Multi-root workspace");
    expect(result).toContain("1. /a");
    expect(result).toContain("2. /b");
  });
});

describe("buildReinvocationPrompt", () => {
  it("mentions approved tool calls", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["call_1", ApprovalAction.APPROVE],
    ]);
    const result = buildReinvocationPrompt(decisions);
    expect(result).toContain("approved");
    expect(result).toContain("call_1");
  });

  it("mentions skipped tool calls", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["call_2", ApprovalAction.SKIP],
    ]);
    const result = buildReinvocationPrompt(decisions);
    expect(result).toContain("skipped");
    expect(result).toContain("call_2");
  });

  it("handles mixed approval and skip decisions", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["call_1", ApprovalAction.APPROVE],
      ["call_2", ApprovalAction.SKIP],
    ]);
    const result = buildReinvocationPrompt(decisions);
    expect(result).toContain("call_1");
    expect(result).toContain("call_2");
  });
});
