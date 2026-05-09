import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import { SessionMemorySchema, type SessionMemory } from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";
import type { AgentResolution } from "../../adapter/session-lifecycle.js";

vi.mock("../../adapter/prompt-builder.js", () => ({
  buildEnhancedPrompt: vi.fn(() => "ENHANCED_PROMPT"),
  buildReinvocationPrompt: vi.fn(() => "REINVOCATION_PROMPT"),
  sanitizeWorkspaceDirs: vi.fn((dirs: string[]) => dirs),
  formatInstructions: vi.fn(() => ""),
  formatSkillsSection: vi.fn(() => ""),
  formatSubAgentsSection: vi.fn(() => ""),
  formatWorkspaceContext: vi.fn(() => ""),
  formatInputFiles: vi.fn(() => ""),
  formatReferencedFiles: vi.fn(() => ""),
  formatResponseRules: vi.fn(() => ""),
}));

vi.mock("../../adapter/continuation-prompt.js", () => ({
  buildContinuationPrompt: vi.fn(() => "CONTINUATION_PROMPT"),
  buildHitlContinuationPrompt: vi.fn(() => "HITL_CONTINUATION_PROMPT"),
  extractAgentRationale: vi.fn(() => ""),
  getGitBranch: vi.fn(async () => "main"),
  getGitHeadSha: vi.fn(async () => "abc123"),
}));

import { buildEnhancedPrompt } from "../../adapter/prompt-builder.js";
import { buildReinvocationPrompt } from "../../adapter/prompt-builder.js";
import { buildContinuationPrompt, buildHitlContinuationPrompt } from "../../adapter/continuation-prompt.js";
import { buildPrompt } from "../execute-cursor.js";

function makeResolution(overrides: Partial<AgentResolution>): AgentResolution {
  return {
    agent: { agentId: "agent-test", send: vi.fn(), close: vi.fn() } as any,
    agentId: "agent-test",
    isNew: false,
    resumed: true,
    mode: "local",
    reason: "resumed_successfully",
    ...overrides,
  };
}

function makeSessionMemory(overrides: Parameters<typeof create<typeof SessionMemorySchema>>[1] = {}): SessionMemory {
  return create(SessionMemorySchema, {
    durableSummary: "Previous context summary",
    decisions: ["Used approach A"],
    changedFiles: ["src/main.ts"],
    ...overrides,
  });
}

const BASE_INPUT = {
  instructions: "You are an assistant.",
  userMessage: "Hello",
  skills: [],
  subAgents: [],
  workspaceDirs: ["/workspace"],
  workspaceFileRefs: [],
  attachmentPaths: [],
  pendingApprovals: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildPrompt — prompt selection logic", () => {
  describe("first execution (no prior memory)", () => {
    it("uses buildEnhancedPrompt when reason is created_first_execution", () => {
      const resolution = makeResolution({
        reason: "created_first_execution",
        isNew: true,
        resumed: false,
      });

      const result = buildPrompt({
        resolution,
        approvalDecisions: undefined,
        sessionMemory: undefined,
        ...BASE_INPUT,
      });

      expect(result).toBe("ENHANCED_PROMPT");
      expect(buildEnhancedPrompt).toHaveBeenCalledTimes(1);
      expect(buildContinuationPrompt).not.toHaveBeenCalled();
      expect(buildHitlContinuationPrompt).not.toHaveBeenCalled();
      expect(buildReinvocationPrompt).not.toHaveBeenCalled();
    });

    it("passes correct options to buildEnhancedPrompt", () => {
      const resolution = makeResolution({
        reason: "created_first_execution",
        isNew: true,
        resumed: false,
      });

      buildPrompt({
        resolution,
        approvalDecisions: undefined,
        sessionMemory: undefined,
        ...BASE_INPUT,
      });

      expect(buildEnhancedPrompt).toHaveBeenCalledWith({
        instructions: "You are an assistant.",
        userMessage: "Hello",
        skills: [],
        subAgents: [],
        workspaceDirs: ["/workspace"],
        workspaceFileRefs: [],
        attachmentPaths: [],
      });
    });
  });

  describe("subsequent execution — resumed successfully with memory", () => {
    it("uses buildContinuationPrompt", () => {
      const resolution = makeResolution({
        reason: "resumed_successfully",
        isNew: false,
        resumed: true,
      });
      const memory = makeSessionMemory();

      const result = buildPrompt({
        resolution,
        approvalDecisions: undefined,
        sessionMemory: memory,
        ...BASE_INPUT,
      });

      expect(result).toBe("CONTINUATION_PROMPT");
      expect(buildContinuationPrompt).toHaveBeenCalledTimes(1);
      expect(buildEnhancedPrompt).not.toHaveBeenCalled();
    });

    it("passes session memory and user message to buildContinuationPrompt", () => {
      const resolution = makeResolution({ reason: "resumed_successfully" });
      const memory = makeSessionMemory({ durableSummary: "My context" });

      buildPrompt({
        resolution,
        approvalDecisions: undefined,
        sessionMemory: memory,
        ...BASE_INPUT,
        userMessage: "Continue please",
      });

      expect(buildContinuationPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionMemory: memory,
          userMessage: "Continue please",
          instructions: "You are an assistant.",
        }),
      );
    });
  });

  describe("subsequent execution — fallback after resume failure with memory", () => {
    it("uses buildContinuationPrompt", () => {
      const resolution = makeResolution({
        reason: "created_after_resume_failure",
        isNew: true,
        resumed: false,
        resumeFailureDetail: "Agent not found",
      });
      const memory = makeSessionMemory();

      const result = buildPrompt({
        resolution,
        approvalDecisions: undefined,
        sessionMemory: memory,
        ...BASE_INPUT,
      });

      expect(result).toBe("CONTINUATION_PROMPT");
      expect(buildContinuationPrompt).toHaveBeenCalledTimes(1);
      expect(buildEnhancedPrompt).not.toHaveBeenCalled();
    });
  });

  describe("subsequent execution — resumed but memory is missing", () => {
    it("falls back to buildEnhancedPrompt when session memory is undefined", () => {
      const resolution = makeResolution({
        reason: "resumed_successfully",
        isNew: false,
        resumed: true,
      });

      const result = buildPrompt({
        resolution,
        approvalDecisions: undefined,
        sessionMemory: undefined,
        ...BASE_INPUT,
      });

      expect(result).toBe("ENHANCED_PROMPT");
      expect(buildEnhancedPrompt).toHaveBeenCalledTimes(1);
      expect(buildContinuationPrompt).not.toHaveBeenCalled();
    });
  });

  describe("HITL reinvocation with session memory", () => {
    it("uses buildHitlContinuationPrompt", () => {
      const resolution = makeResolution({ reason: "resumed_successfully" });
      const memory = makeSessionMemory();
      const approvalDecisions = new Map<string, ApprovalAction>([
        ["tc-1", ApprovalAction.APPROVE],
      ]);

      const result = buildPrompt({
        resolution,
        approvalDecisions,
        sessionMemory: memory,
        ...BASE_INPUT,
      });

      expect(result).toBe("HITL_CONTINUATION_PROMPT");
      expect(buildHitlContinuationPrompt).toHaveBeenCalledTimes(1);
      expect(buildContinuationPrompt).not.toHaveBeenCalled();
      expect(buildReinvocationPrompt).not.toHaveBeenCalled();
    });

    it("passes approval decisions and memory to buildHitlContinuationPrompt", () => {
      const resolution = makeResolution({ reason: "resumed_successfully" });
      const memory = makeSessionMemory();
      const approvalDecisions = new Map<string, ApprovalAction>([
        ["tc-1", ApprovalAction.APPROVE],
        ["tc-2", ApprovalAction.APPROVE],
      ]);

      buildPrompt({
        resolution,
        approvalDecisions,
        sessionMemory: memory,
        ...BASE_INPUT,
        pendingApprovals: [{ toolCallId: "tc-1" }, { toolCallId: "tc-2" }] as any,
      });

      expect(buildHitlContinuationPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionMemory: memory,
          approvalDecisions,
          pendingApprovals: expect.arrayContaining([
            expect.objectContaining({ toolCallId: "tc-1" }),
          ]),
        }),
      );
    });
  });

  describe("HITL reinvocation after resume failure with memory", () => {
    it("uses buildHitlContinuationPrompt even on fallback agent", () => {
      const resolution = makeResolution({
        reason: "created_after_resume_failure",
        isNew: true,
        resumed: false,
      });
      const memory = makeSessionMemory();
      const approvalDecisions = new Map<string, ApprovalAction>([
        ["tc-1", ApprovalAction.APPROVE],
      ]);

      const result = buildPrompt({
        resolution,
        approvalDecisions,
        sessionMemory: memory,
        ...BASE_INPUT,
      });

      expect(result).toBe("HITL_CONTINUATION_PROMPT");
    });
  });

  describe("HITL reinvocation without session memory (legacy path)", () => {
    it("falls back to buildReinvocationPrompt when no memory exists", () => {
      const resolution = makeResolution({ reason: "resumed_successfully" });
      const approvalDecisions = new Map<string, ApprovalAction>([
        ["tc-1", ApprovalAction.APPROVE],
      ]);

      const result = buildPrompt({
        resolution,
        approvalDecisions,
        sessionMemory: undefined,
        ...BASE_INPUT,
      });

      expect(result).toBe("REINVOCATION_PROMPT");
      expect(buildReinvocationPrompt).toHaveBeenCalledTimes(1);
      expect(buildReinvocationPrompt).toHaveBeenCalledWith(approvalDecisions);
      expect(buildHitlContinuationPrompt).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("empty approvalDecisions map is not treated as HITL reinvocation", () => {
      const resolution = makeResolution({ reason: "resumed_successfully" });
      const memory = makeSessionMemory();
      const approvalDecisions = new Map<string, ApprovalAction>();

      const result = buildPrompt({
        resolution,
        approvalDecisions,
        sessionMemory: memory,
        ...BASE_INPUT,
      });

      expect(result).toBe("CONTINUATION_PROMPT");
      expect(buildHitlContinuationPrompt).not.toHaveBeenCalled();
    });

    it("undefined approvalDecisions is not treated as HITL reinvocation", () => {
      const resolution = makeResolution({ reason: "resumed_successfully" });
      const memory = makeSessionMemory();

      const result = buildPrompt({
        resolution,
        approvalDecisions: undefined,
        sessionMemory: memory,
        ...BASE_INPUT,
      });

      expect(result).toBe("CONTINUATION_PROMPT");
      expect(buildHitlContinuationPrompt).not.toHaveBeenCalled();
    });

    it("HITL takes precedence over continuation when both conditions met", () => {
      const resolution = makeResolution({
        reason: "created_after_resume_failure",
      });
      const memory = makeSessionMemory();
      const approvalDecisions = new Map<string, ApprovalAction>([
        ["tc-1", ApprovalAction.APPROVE],
      ]);

      const result = buildPrompt({
        resolution,
        approvalDecisions,
        sessionMemory: memory,
        ...BASE_INPUT,
      });

      expect(result).toBe("HITL_CONTINUATION_PROMPT");
      expect(buildContinuationPrompt).not.toHaveBeenCalled();
    });
  });
});
