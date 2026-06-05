/**
 * Unit tests for buildPrompt's prompt-selection logic.
 *
 * Conversation continuity is carried entirely by the Cursor SDK's native agent
 * state (no separate continuation store), so buildPrompt depends only on
 * resolution.reason and HITL state. It is a pure string builder — it never
 * touches the live SDK agent — so these tests need no Cursor API key.
 */

import { describe, it, expect } from "vitest";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { buildPrompt } from "../index.js";
import type { BuildPromptInput } from "../index.js";
import type { AgentResolution, AgentResolutionReason } from "../session-lifecycle.js";

const USER_MESSAGE = "What was the secret token I told you?";

function resolution(
  mode: "local" | "cloud",
  reason: AgentResolutionReason,
): AgentResolution {
  return {
    // buildPrompt never touches the agent handle; a stub keeps the type happy.
    agent: {} as AgentResolution["agent"],
    agentId: "agent-test",
    isNew: reason !== "resumed_successfully",
    resumed: reason === "resumed_successfully",
    mode,
    reason,
  };
}

function input(overrides: Partial<BuildPromptInput>): BuildPromptInput {
  return {
    resolution: resolution("local", "resumed_successfully"),
    approvalDecisions: undefined,
    instructions: "You are a test agent.",
    userMessage: USER_MESSAGE,
    skills: [],
    subAgents: [],
    workspaceDirs: ["/tmp/ws"],
    workspaceFileRefs: [],
    attachmentPaths: [],
    pendingApprovals: [],
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("sends the raw user message when a local agent resumed successfully (native context carries it)", () => {
    const prompt = buildPrompt(
      input({ resolution: resolution("local", "resumed_successfully") }),
    );
    expect(prompt).toBe(USER_MESSAGE);
  });

  it("sends the raw user message when a cloud agent resumed successfully", () => {
    const prompt = buildPrompt(
      input({ resolution: resolution("cloud", "resumed_successfully") }),
    );
    expect(prompt).toBe(USER_MESSAGE);
  });

  it("uses the enhanced first-execution prompt on the first turn", () => {
    const prompt = buildPrompt(
      input({ resolution: resolution("local", "created_first_execution") }),
    );
    expect(prompt).not.toBe(USER_MESSAGE);
    expect(prompt).toContain("<agent_instructions>");
    expect(prompt).toContain(USER_MESSAGE);
  });

  it("uses the enhanced prompt (no prior context) for a fresh agent after a resume failure", () => {
    // With SessionMemory removed, a fresh agent created after a resume failure
    // has no prior conversation to inherit — it starts a new turn with full
    // instructions plus the user message.
    const prompt = buildPrompt(
      input({ resolution: resolution("local", "created_after_resume_failure") }),
    );
    expect(prompt).not.toBe(USER_MESSAGE);
    expect(prompt).toContain("<agent_instructions>");
    expect(prompt).toContain(USER_MESSAGE);
  });

  it("uses the reinvocation prompt for a HITL reinvocation (resumed agent carries the conversation)", () => {
    const approvalDecisions = new Map<string, ApprovalAction>([
      ["tool-call-1", ApprovalAction.APPROVE],
    ]);
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "resumed_successfully"),
        approvalDecisions,
      }),
    );
    expect(prompt).not.toBe(USER_MESSAGE);
    expect(prompt).toContain("approved");
    expect(prompt).toContain("tool-call-1");
  });
});
