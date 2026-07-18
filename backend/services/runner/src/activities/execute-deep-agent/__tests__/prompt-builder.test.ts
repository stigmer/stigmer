import { describe, it, expect } from "vitest";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { buildEnhancedSystemPrompt } from "../prompt-builder.js";
import { PLAN_MODE_DIRECTIVE } from "../../../shared/plan-mode-prompt.js";
import { SourceType } from "../../../shared/workspace/types.js";
import type { ProvisionResult } from "../../../shared/workspace/types.js";

function makeProvisionResult(overrides: Partial<ProvisionResult> = {}): ProvisionResult {
  return {
    rootDir: "/workspace/project",
    sourceType: SourceType.LOCAL_PATH,
    consumedKeys: [],
    workspaceDescription: "User project directory at /workspace/project",
    entryName: "project",
    ...overrides,
  };
}

describe("buildEnhancedSystemPrompt", () => {
  it("starts with instructions", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "You are a helpful assistant.",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt.startsWith("You are a helpful assistant.")).toBe(true);
  });

  it("includes response rules", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("## Response rules");
  });

  it("includes sub-agent delegation rules", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("## Sub-agent delegation rules");
  });

  it("includes single workspace section", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [makeProvisionResult()],
      containerRoot: "/workspace",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("## Workspace");
    expect(prompt).toContain("User project directory");
  });

  it("includes multi-workspace section with entry names", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [
        makeProvisionResult({ entryName: "frontend", rootDir: "/workspace/frontend" }),
        makeProvisionResult({ entryName: "backend", rootDir: "/workspace/backend" }),
      ],
      containerRoot: "/workspace",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("2 workspace entries");
    expect(prompt).toContain("### frontend");
    expect(prompt).toContain("### backend");
  });

  it("includes file tree when present", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [makeProvisionResult({
        fileTree: "### Project Structure\n\n```\nsrc/\n  main.ts\n```",
      })],
      containerRoot: "/workspace",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("src/");
    expect(prompt).toContain("main.ts");
  });

  it("includes skills prompt section", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "\n\n## Skills\n\n- coding-standards",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("coding-standards");
  });

  it("includes referenced files section", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: ["src/config.yaml", "README.md"],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("## Referenced Files");
    expect(prompt).toContain("`src/config.yaml`");
    expect(prompt).toContain("`README.md`");
  });

  it("includes injected files section with size info", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [
        { filename: "data.csv", path: ".stigmer/inputs/data.csv", size: 1024 },
        { filename: "notes.md", path: ".stigmer/inputs/notes.md", size: null },
      ],
    });

    expect(prompt).toContain("## Input Files");
    expect(prompt).toContain("`.stigmer/inputs/data.csv` (1024 bytes)");
    expect(prompt).toContain("`.stigmer/inputs/notes.md`");
    expect(prompt).not.toContain("null");
  });

  it("produces a git repo description for git workspace entries", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [
        makeProvisionResult({
          sourceType: SourceType.GIT_REPO,
          entryName: "my-repo",
          rootDir: "/workspace/my-repo",
          gitMetadata: {
            repoUrl: "https://github.com/org/my-repo",
            branch: "main",
            baseCommit: "abc1234567890",
            gitCredentialsConfigured: true,
          },
        }),
        makeProvisionResult({
          sourceType: SourceType.EMPTY,
          entryName: "scratch",
          rootDir: "/workspace/scratch",
        }),
      ],
      containerRoot: "/workspace",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("https://github.com/org/my-repo");
    expect(prompt).toContain("abc1234");
    expect(prompt).toContain("empty workspace");
  });

  it("omits workspace section when no provision results", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).not.toContain("## Workspace");
  });

  describe("rollover context bridge (DD-013)", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "",
      injectedFiles: [],
    };

    it("appends the bridge as standing session context (every-turn injection)", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        contextBridge: "Subject: Orders\nUser: where is my order?\nAssistant: Shipped.",
      });

      expect(prompt).toContain("## Previous conversation context");
      expect(prompt).toContain("User: where is my order?");
      expect(prompt).toContain("Do not repeat it back");
    });

    it("omits the section when the session carries no bridge", () => {
      const prompt = buildEnhancedSystemPrompt(base);

      expect(prompt).not.toContain("## Previous conversation context");
    });
  });

  describe("plan mode", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    };

    it("appends the shared plan-mode directive as the final section", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        interactionMode: InteractionMode.PLAN,
      });

      expect(prompt).toContain("## Plan mode");
      expect(prompt.endsWith(PLAN_MODE_DIRECTIVE)).toBe(true);
    });

    it("omits the directive for Agent mode", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        interactionMode: InteractionMode.AGENT,
      });

      expect(prompt).not.toContain("## Plan mode");
    });

    it("omits the directive when the mode is unset", () => {
      const prompt = buildEnhancedSystemPrompt(base);

      expect(prompt).not.toContain("## Plan mode");
    });
  });

  describe("build from plan", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    };
    const planFile = {
      filename: "plan.md",
      path: ".stigmer/inputs/plan.md",
      size: 1024,
    };

    it("appends the implement-plan directive pointing at the injected plan", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        buildFromPlan: true,
        injectedFiles: [planFile],
      });

      expect(prompt).toContain("## Implement the approved plan");
      expect(prompt).toContain("`.stigmer/inputs/plan.md`");
      expect(prompt).toContain("APPROVED");
    });

    it("falls back to the conversation-plan variant when the plan did not inject", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        buildFromPlan: true,
      });

      expect(prompt).toContain("## Implement the approved plan");
      expect(prompt).toContain("conversation above");
      expect(prompt).not.toContain("plan.md");
    });

    it("omits the directive for an ordinary execution", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        injectedFiles: [planFile],
      });

      expect(prompt).not.toContain("## Implement the approved plan");
    });

    it("carries the plan-derived progress-tracking instruction (Tier 3)", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        buildFromPlan: true,
        injectedFiles: [planFile],
      });

      expect(prompt).toContain("to-do list");
      expect(prompt).toContain("break the plan into");
    });
  });
});
