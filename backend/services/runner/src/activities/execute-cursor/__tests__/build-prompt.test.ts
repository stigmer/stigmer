/**
 * Unit tests for buildPrompt's prompt-selection matrix, focused on the
 * `trustNativeResume` branch added to validate native local Agent.resume().
 *
 * buildPrompt is a pure string builder — it reads only resolution.reason and
 * resolution.mode (never the live SDK agent), so these tests construct minimal
 * fakes and need no Cursor API key or live SDK.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionMemorySchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";
import type { SessionMemory } from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";

import { buildPrompt } from "../index.js";
import type { BuildPromptInput } from "../index.js";
import type { AgentResolution, AgentResolutionReason } from "../session-lifecycle.js";

const USER_MESSAGE = "What was the secret token I told you?";

function memoryWith(summary: string): SessionMemory {
  return create(SessionMemorySchema, { durableSummary: summary });
}

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
    sessionMemory: memoryWith("prior context summary"),
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

describe("buildPrompt — trustNativeResume branch", () => {
  it("sends the raw user message when trustNativeResume and the local agent resumed successfully", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "resumed_successfully"),
        trustNativeResume: true,
      }),
    );

    expect(prompt).toBe(USER_MESSAGE);
  });

  it("injects the continuation prompt for a local resumed agent when the flag is OFF (current production behavior)", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "resumed_successfully"),
        trustNativeResume: false,
      }),
    );

    expect(prompt).not.toBe(USER_MESSAGE);
    expect(prompt).toContain("<continuation_contract>");
    expect(prompt).toContain("prior context summary");
  });

  it("still uses the continuation prompt for a fresh agent created after a resume failure, even with the flag ON", () => {
    // A fresh agent has no native context to trust, so the continuation prompt
    // (rebuilt from SessionMemory) is still required.
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "created_after_resume_failure"),
        trustNativeResume: true,
      }),
    );

    expect(prompt).not.toBe(USER_MESSAGE);
    expect(prompt).toContain("<continuation_contract>");
  });

  it("uses the enhanced (first-execution) prompt for the first turn regardless of the flag", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "created_first_execution"),
        trustNativeResume: true,
      }),
    );

    expect(prompt).not.toBe(USER_MESSAGE);
    expect(prompt).toContain("<agent_instructions>");
  });

  it("does not affect cloud mode (cloud already trusts native context)", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("cloud", "resumed_successfully"),
        trustNativeResume: false,
      }),
    );

    // Cloud resumed agents already send the raw user message.
    expect(prompt).toBe(USER_MESSAGE);
  });
});
