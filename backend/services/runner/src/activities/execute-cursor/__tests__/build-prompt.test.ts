/**
 * Unit tests for buildPrompt's prompt-selection logic.
 *
 * Conversation continuity is carried entirely by the Cursor SDK's native agent
 * state (no separate continuation store), so buildPrompt depends only on
 * resolution.reason and HITL state. It is a pure string builder — it never
 * touches the live SDK agent — so these tests need no Cursor API key.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ApprovalAction, InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";

import { buildPrompt } from "../index.js";
import type { BuildPromptInput } from "../index.js";
import { buildReinvocationPrompt, formatInteractionModePrefix, formatImplementPlanSection, formatToolApprovalProtocol, buildToolApprovalRuleFile } from "../prompt-builder.js";
import { PLAN_MODE_DIRECTIVE } from "../../../shared/plan-mode-prompt.js";
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

  it("carries the rollover context bridge on the first execution (DD-013)", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "created_first_execution"),
        contextBridge: "Subject: Orders\nUser: where is my order?\nAssistant: Shipped.",
      }),
    );
    expect(prompt).toContain("<previous_conversation_context>");
    expect(prompt).toContain("User: where is my order?");
    // The bridge is CONTEXT; the approval protocol keeps its pinned
    // last-before-task slot so instructions outweigh it.
    expect(prompt.indexOf("<previous_conversation_context>"))
      .toBeLessThan(prompt.indexOf("<tool_approval_protocol>"));
  });

  it("never bridges a successfully resumed agent — its native context IS the conversation", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "resumed_successfully"),
        contextBridge: "Subject: Orders\nUser: hi\nAssistant: hello",
      }),
    );
    expect(prompt).toBe(USER_MESSAGE);
  });

  it("omits the bridge section when the session carries none", () => {
    const prompt = buildPrompt(
      input({ resolution: resolution("local", "created_first_execution") }),
    );
    expect(prompt).not.toContain("<previous_conversation_context>");
  });

  it("uses the reinvocation prompt for a HITL reinvocation (human-meaningful, no opaque ids)", () => {
    const approvalDecisions = new Map<string, ApprovalAction>([
      ["tool-call-1", ApprovalAction.APPROVE],
    ]);
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "resumed_successfully"),
        approvalDecisions,
        pendingApprovals: [
          create(PendingApprovalSchema, {
            toolCallId: "tool-call-1",
            toolName: "Write",
            message: "Write file: gated.txt",
          }),
        ],
      }),
    );
    expect(prompt).not.toBe(USER_MESSAGE);
    expect(prompt).toContain("APPROVED");
    expect(prompt).toContain("Write file: gated.txt");
    // The opaque tool-call id must not leak into the prompt.
    expect(prompt).not.toContain("tool-call-1");
  });
});

describe("tool-approval protocol injection", () => {
  it("includes the tool-approval protocol on the first execution", () => {
    const prompt = buildPrompt(
      input({ resolution: resolution("local", "created_first_execution") }),
    );
    expect(prompt).toContain("<tool_approval_protocol>");
    // The decisive override against a server's "ask first" guidance.
    expect(prompt).toContain("calling the appropriate tool directly");
    expect(prompt).toContain("Invoke the tool and let the platform");
  });

  it("places the protocol after the agent instructions, before the user request", () => {
    const prompt = buildPrompt(
      input({ resolution: resolution("local", "created_first_execution") }),
    );
    const protocolIdx = prompt.indexOf("<tool_approval_protocol>");
    const requestIdx = prompt.indexOf("<user_request>");
    expect(protocolIdx).toBeGreaterThan(prompt.indexOf("<agent_instructions>"));
    expect(protocolIdx).toBeLessThan(requestIdx);
  });

  it("also injects the protocol for a fresh agent after a resume failure", () => {
    const prompt = buildPrompt(
      input({ resolution: resolution("local", "created_after_resume_failure") }),
    );
    expect(prompt).toContain("<tool_approval_protocol>");
  });
});

describe("formatToolApprovalProtocol", () => {
  it("instructs the agent to invoke tools and never ask for permission in prose", () => {
    const section = formatToolApprovalProtocol();
    expect(section).toContain("<tool_approval_protocol>");
    expect(section).toContain("</tool_approval_protocol>");
    expect(section.toLowerCase()).toContain("never ask the");
    // Explicit override of MCP-server "confirm before acting" guidance.
    expect(section.toLowerCase()).toContain("even if a tool or mcp server");
    expect(section).toContain("Invoke the tool and let the platform");
  });

  it("reframes a denied/blocked tool as the gate working, not a broken environment", () => {
    const section = formatToolApprovalProtocol().toLowerCase();
    // The load-bearing fix for the leaky Cursor deny path: the model must not
    // read "blocked by a hook" as an error or tell the user to fix settings.
    expect(section).toContain("blocked by a hook");
    expect(section).toContain("not an error");
    expect(section).toContain("cursor settings");
  });

  it("contains no characters that would break the prompt assembly", () => {
    // Sanity: the protocol is plain prose joined into the user-message prompt.
    expect(formatToolApprovalProtocol()).not.toContain("undefined");
  });
});

describe("buildToolApprovalRuleFile", () => {
  it("emits an always-applied .cursor/rules .mdc carrying the same protocol", () => {
    const rule = buildToolApprovalRuleFile();
    // Valid .mdc frontmatter that Cursor injects on every turn.
    expect(rule.startsWith("---\n")).toBe(true);
    expect(rule).toContain("alwaysApply: true");
    expect(rule).toContain("# Tool approval protocol");
    // Same single-sourced guidance as the system-prompt copy.
    expect(rule.toLowerCase()).toContain("blocked by a hook");
    expect(rule.toLowerCase()).toContain("not an error");
    expect(rule.toLowerCase()).toContain("never tell the user to change cursor settings");
    expect(rule).not.toContain("undefined");
  });
});

describe("buildReinvocationPrompt", () => {
  function pending(toolCallId: string, message: string) {
    return create(PendingApprovalSchema, { toolCallId, toolName: "Write", message });
  }

  it("tells the agent to carry out approved actions and keep invoking tools", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.APPROVE],
    ]);
    const prompt = buildReinvocationPrompt([pending("tc-1", "Write file: a.txt")], decisions);
    expect(prompt).toContain("APPROVED");
    expect(prompt).toContain("Write file: a.txt");
    // The continuation + override directive must be present.
    expect(prompt).toContain("Continue the rest of the task");
    expect(prompt.toLowerCase()).toContain("do not ask the user for permission in prose");
  });

  it("still carries the continuation/override when every action was skipped", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.SKIP],
    ]);
    const prompt = buildReinvocationPrompt([pending("tc-1", "Write file: a.txt")], decisions);
    expect(prompt).toContain("SKIPPED");
    expect(prompt).toContain("Continue the rest of the task");
  });

  it("describes a runner-applied approval as ALREADY applied, not as one to carry out", () => {
    // tc-1 was exact-applied by the runner (a whole-file write); tc-2 (a shell
    // command) was approved but stays on the model's carry-out path.
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.APPROVE],
      ["tc-2", ApprovalAction.APPROVE],
    ]);
    const prompt = buildReinvocationPrompt(
      [pending("tc-1", "Write file: a.txt"), pending("tc-2", "Run command: ls")],
      decisions,
      new Set(["tc-1"]),
    );

    // The applied write is announced as done — and explicitly NOT redo-able.
    expect(prompt).toContain("ALREADY applied");
    expect(prompt).toMatch(/do NOT redo/i);
    // Both actions still appear by their human description.
    expect(prompt).toContain("Write file: a.txt");
    expect(prompt).toContain("Run command: ls");
    // The applied write must NOT be in the "Carry them out now" block; only the
    // shell command is. Assert by position: the already-applied block precedes
    // the carry-out block, and the write is in the former.
    const carryIdx = prompt.indexOf("Carry them out now");
    const appliedIdx = prompt.indexOf("ALREADY applied");
    expect(appliedIdx).toBeGreaterThanOrEqual(0);
    expect(carryIdx).toBeGreaterThan(appliedIdx);
    expect(prompt.slice(carryIdx)).toContain("Run command: ls");
    expect(prompt.slice(carryIdx)).not.toContain("Write file: a.txt");
  });

  it("treats APPROVE_ALL like APPROVE for an already-applied write", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.APPROVE_ALL],
    ]);
    const prompt = buildReinvocationPrompt(
      [pending("tc-1", "Write file: a.txt")],
      decisions,
      new Set(["tc-1"]),
    );
    expect(prompt).toContain("ALREADY applied");
    expect(prompt).not.toContain("Carry them out now");
  });
});

describe("formatInteractionModePrefix", () => {
  it("wraps the shared plan-mode directive in the interaction_mode section", () => {
    const prefix = formatInteractionModePrefix(InteractionMode.PLAN);

    expect(prefix).toBeDefined();
    expect(prefix!.startsWith("<interaction_mode>")).toBe(true);
    expect(prefix!.endsWith("</interaction_mode>")).toBe(true);
    expect(prefix).toContain(PLAN_MODE_DIRECTIVE);
  });

  it.each([
    ["AGENT", InteractionMode.AGENT],
    ["UNSPECIFIED", InteractionMode.UNSPECIFIED],
    ["undefined", undefined],
  ])("returns undefined for %s", (_label, mode) => {
    expect(formatInteractionModePrefix(mode)).toBeUndefined();
  });

  it("injects the directive into a Plan-mode first prompt", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "created_first_execution"),
        interactionMode: InteractionMode.PLAN,
      }),
    );

    expect(prompt).toContain("<interaction_mode>");
    expect(prompt).toContain("your FINAL message IS the plan");
  });

  it("prefixes the directive on a resumed Plan-mode follow-up (mode is per-execution)", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "resumed_successfully"),
        interactionMode: InteractionMode.PLAN,
      }),
    );

    expect(prompt.startsWith("<interaction_mode>")).toBe(true);
    expect(prompt.endsWith(USER_MESSAGE)).toBe(true);
  });

  it("keeps a resumed Agent-mode follow-up as the raw user message", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "resumed_successfully"),
        interactionMode: InteractionMode.AGENT,
      }),
    );

    expect(prompt).toBe(USER_MESSAGE);
  });
});

describe("formatImplementPlanSection", () => {
  const PLAN_PATH = ".stigmer/inputs/plan.md";

  it("wraps the attached-plan directive when the plan is among the attachments", () => {
    const section = formatImplementPlanSection(true, [PLAN_PATH, ".stigmer/inputs/data.csv"]);

    expect(section).toBeDefined();
    expect(section!.startsWith("<implement_plan>")).toBe(true);
    expect(section!.endsWith("</implement_plan>")).toBe(true);
    expect(section).toContain(`\`${PLAN_PATH}\``);
    expect(section).toContain("APPROVED");
  });

  it("falls back to the conversation-plan directive when no plan attachment resolved", () => {
    const section = formatImplementPlanSection(true, [".stigmer/inputs/data.csv"]);

    expect(section).toBeDefined();
    expect(section).not.toContain("plan.md");
    expect(section).toContain("conversation above");
  });

  it("returns undefined for an ordinary (non-build) execution", () => {
    expect(formatImplementPlanSection(false, [PLAN_PATH])).toBeUndefined();
    expect(formatImplementPlanSection(undefined, [PLAN_PATH])).toBeUndefined();
  });

  it("carries the plan-derived progress-tracking instruction (Tier 3)", () => {
    const section = formatImplementPlanSection(true, [PLAN_PATH]);

    expect(section).toContain("to-do list");
    expect(section).toContain("break the plan into");
  });

  it("injects the directive into a build-from-plan first prompt", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "created_first_execution"),
        buildFromPlan: true,
        attachmentPaths: [PLAN_PATH],
      }),
    );

    expect(prompt).toContain("<implement_plan>");
    expect(prompt).toContain(`\`${PLAN_PATH}\``);
    expect(prompt).toContain(USER_MESSAGE);
  });

  it("prefixes the directive on a resumed build turn (build_from_plan is per-execution)", () => {
    // The common shape: the plan turn ran earlier in the session, so the
    // build turn resumes the agent — the directive must still arrive.
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "resumed_successfully"),
        buildFromPlan: true,
        attachmentPaths: [PLAN_PATH],
      }),
    );

    expect(prompt.startsWith("<implement_plan>")).toBe(true);
    expect(prompt.endsWith(USER_MESSAGE)).toBe(true);
  });

  it("keeps a resumed non-build follow-up as the raw user message", () => {
    const prompt = buildPrompt(
      input({
        resolution: resolution("local", "resumed_successfully"),
        buildFromPlan: false,
        attachmentPaths: [PLAN_PATH],
      }),
    );

    expect(prompt).toBe(USER_MESSAGE);
  });
});
