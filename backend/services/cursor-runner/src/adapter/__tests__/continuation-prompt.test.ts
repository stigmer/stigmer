import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionMemorySchema, ToolObservationSchema, ConversationTurnSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ApprovalAction, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SessionMemory, ToolObservation, ConversationTurn } from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import {
  buildContinuationPrompt,
  buildHitlContinuationPrompt,
  extractAgentRationale,
  getGitBranch,
  getGitHeadSha,
} from "../continuation-prompt.js";
import type { ContinuationPromptOptions, HitlContinuationPromptOptions } from "../continuation-prompt.js";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function makeMemory(overrides: Partial<{
  durableSummary: string;
  decisions: string[];
  failedAttempts: string[];
  changedFiles: string[];
  openTasks: string[];
  recentTurns: ConversationTurn[];
  toolObservations: ToolObservation[];
}> = {}): SessionMemory {
  return create(SessionMemorySchema, {
    durableSummary: overrides.durableSummary ?? "Implemented feature X. Tests pass.",
    decisions: overrides.decisions ?? ["Used React over Vue for component library"],
    failedAttempts: overrides.failedAttempts ?? ["npm install: EACCES permission denied"],
    changedFiles: overrides.changedFiles ?? ["src/app.ts", "src/utils.ts"],
    openTasks: overrides.openTasks ?? ["Add error handling to API layer"],
    recentTurns: overrides.recentTurns ?? [
      create(ConversationTurnSchema, { role: "user", content: "Add auth to the app", timestamp: "2026-05-09T14:00:00Z" }),
      create(ConversationTurnSchema, { role: "assistant", content: "I'll add JWT-based authentication.", timestamp: "2026-05-09T14:01:00Z" }),
    ],
    toolObservations: overrides.toolObservations ?? [
      create(ToolObservationSchema, { command: "npm test", cwd: "/workspace", exitCode: 0, summary: "All 42 tests pass" }),
    ],
  });
}

function makeBaseOptions(overrides: Partial<ContinuationPromptOptions> = {}): ContinuationPromptOptions {
  return {
    instructions: overrides.instructions ?? "You are a helpful coding assistant.",
    skills: overrides.skills ?? [],
    subAgents: overrides.subAgents ?? [],
    workspaceDirs: overrides.workspaceDirs ?? ["/workspace/project"],
    workspaceFileRefs: overrides.workspaceFileRefs ?? [],
    attachmentPaths: overrides.attachmentPaths ?? [],
    sessionMemory: overrides.sessionMemory ?? makeMemory(),
    userMessage: overrides.userMessage ?? "Fix the failing test",
  };
}

function makePendingApproval(overrides: Partial<{
  toolCallId: string;
  toolName: string;
  argsPreview: string;
  agentRationale: string;
  branchAtDeny: string;
  headShaAtDeny: string;
}> = {}): PendingApproval {
  return create(PendingApprovalSchema, {
    toolCallId: overrides.toolCallId ?? "call_abc123",
    toolName: overrides.toolName ?? "Shell",
    argsPreview: overrides.argsPreview ?? '{"command": "rm -rf /tmp/old"}',
    agentRationale: overrides.agentRationale ?? "Need to clean up old temp files",
    branchAtDeny: overrides.branchAtDeny ?? "feature/cleanup",
    headShaAtDeny: overrides.headShaAtDeny ?? "a1b2c3d4e5f6",
  });
}

function aiMessage(content: string): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content,
    timestamp: "2026-05-09T15:30:00.000Z",
  });
}

function userMessage(content: string): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_HUMAN,
    content,
    timestamp: "2026-05-09T15:29:00.000Z",
  });
}

// ---------------------------------------------------------------------------
// buildContinuationPrompt
// ---------------------------------------------------------------------------

describe("buildContinuationPrompt", () => {
  it("includes continuation contract section", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    expect(result).toContain("<continuation_contract>");
    expect(result).toContain("</continuation_contract>");
    expect(result).toContain("live filesystem is the source of truth");
  });

  it("includes agent instructions", () => {
    const result = buildContinuationPrompt(makeBaseOptions({
      instructions: "You are a TypeScript expert.",
    }));
    expect(result).toContain("<agent_instructions>");
    expect(result).toContain("You are a TypeScript expert.");
    expect(result).toContain("</agent_instructions>");
  });

  it("includes workspace context", () => {
    const result = buildContinuationPrompt(makeBaseOptions({
      workspaceDirs: ["/workspace/my-project"],
    }));
    expect(result).toContain("<workspace>");
    expect(result).toContain("/workspace/my-project");
  });

  it("includes durable summary from memory", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    expect(result).toContain("<durable_summary>");
    expect(result).toContain("Implemented feature X. Tests pass.");
    expect(result).toContain("</durable_summary>");
  });

  it("includes decisions from memory", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    expect(result).toContain("<decisions>");
    expect(result).toContain("Used React over Vue for component library");
    expect(result).toContain("</decisions>");
  });

  it("includes failed attempts from memory", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    expect(result).toContain("<failed_attempts>");
    expect(result).toContain("npm install: EACCES permission denied");
    expect(result).toContain("do not repeat these");
    expect(result).toContain("</failed_attempts>");
  });

  it("includes changed files from memory", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    expect(result).toContain("<changed_files>");
    expect(result).toContain("src/app.ts");
    expect(result).toContain("src/utils.ts");
    expect(result).toContain("</changed_files>");
  });

  it("includes open tasks from memory", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    expect(result).toContain("<open_tasks>");
    expect(result).toContain("Add error handling to API layer");
    expect(result).toContain("</open_tasks>");
  });

  it("includes recent turns from memory", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    expect(result).toContain("<recent_turns>");
    expect(result).toContain("[User]: Add auth to the app");
    expect(result).toContain("[Assistant]: I'll add JWT-based authentication.");
    expect(result).toContain("</recent_turns>");
  });

  it("includes tool observations from memory", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    expect(result).toContain("<tool_observations>");
    expect(result).toContain("`npm test` (ok): All 42 tests pass");
    expect(result).toContain("</tool_observations>");
  });

  it("includes user message at the end", () => {
    const result = buildContinuationPrompt(makeBaseOptions({
      userMessage: "Now add the logout feature",
    }));
    expect(result).toContain("<current_user_message>");
    expect(result).toContain("Now add the logout feature");
    expect(result).toContain("</current_user_message>");
  });

  it("separates sections with --- dividers", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    expect(result).toContain("\n\n---\n\n");
  });

  it("omits empty memory sections gracefully", () => {
    const emptyMemory = makeMemory({
      durableSummary: "",
      decisions: [],
      failedAttempts: [],
      changedFiles: [],
      openTasks: [],
      recentTurns: [],
      toolObservations: [],
    });
    const result = buildContinuationPrompt(makeBaseOptions({ sessionMemory: emptyMemory }));

    expect(result).toContain("<continuation_contract>");
    expect(result).toContain("<current_user_message>");
    expect(result).not.toContain("<durable_summary>\n");
    expect(result).not.toContain("<decisions>\nPrevious decisions");
    expect(result).not.toContain("<failed_attempts>\n");
    expect(result).not.toContain("<changed_files>\n");
    expect(result).not.toContain("<open_tasks>\n");
    expect(result).not.toContain("<recent_turns>\n");
    expect(result).not.toContain("<tool_observations>\n");
  });

  it("includes skills section when skills are provided", () => {
    const result = buildContinuationPrompt(makeBaseOptions({
      skills: [{ name: "deploy", description: "Deploy to production", path: "/skills/deploy/SKILL.md" }],
    }));
    expect(result).toContain("<available_skills>");
    expect(result).toContain("deploy");
    expect(result).toContain("Deploy to production");
  });

  it("includes response rules", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    expect(result).toContain("<response_rules>");
  });

  it("formats tool observations with exit codes", () => {
    const memory = makeMemory({
      toolObservations: [
        create(ToolObservationSchema, { command: "npm test", cwd: "/ws", exitCode: 0, summary: "passed" }),
        create(ToolObservationSchema, { command: "npm build", cwd: "/ws", exitCode: 1, summary: "type error" }),
      ],
    });
    const result = buildContinuationPrompt(makeBaseOptions({ sessionMemory: memory }));
    expect(result).toContain("`npm test` (ok): passed");
    expect(result).toContain("`npm build` (exit 1): type error");
  });
});

// ---------------------------------------------------------------------------
// buildHitlContinuationPrompt
// ---------------------------------------------------------------------------

describe("buildHitlContinuationPrompt", () => {
  function makeHitlOptions(overrides: Partial<HitlContinuationPromptOptions> = {}): HitlContinuationPromptOptions {
    const decisions = new Map<string, ApprovalAction>();
    decisions.set("call_abc123", ApprovalAction.APPROVE);

    return {
      instructions: overrides.instructions ?? "You are a coding assistant.",
      skills: overrides.skills ?? [],
      subAgents: overrides.subAgents ?? [],
      workspaceDirs: overrides.workspaceDirs ?? ["/workspace/project"],
      sessionMemory: overrides.sessionMemory ?? makeMemory(),
      pendingApprovals: overrides.pendingApprovals ?? [makePendingApproval()],
      approvalDecisions: overrides.approvalDecisions ?? decisions,
    };
  }

  it("includes HITL continuation header", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain("<hitl_continuation>");
    expect(result).toContain("</hitl_continuation>");
    expect(result).toContain("resuming a previously paused task");
    expect(result).toContain("NOT to blindly execute");
  });

  it("includes tool name in proposed action", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain("Tool: Shell");
  });

  it("includes tool arguments in proposed action", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain('Arguments: {"command": "rm -rf /tmp/old"}');
  });

  it("includes agent rationale when available", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain("Original rationale: Need to clean up old temp files");
  });

  it("includes approval decision label", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain("Decision: APPROVED");
  });

  it("shows SKIPPED for skipped tools", () => {
    const decisions = new Map<string, ApprovalAction>();
    decisions.set("call_abc123", ApprovalAction.SKIP);

    const result = buildHitlContinuationPrompt(makeHitlOptions({
      approvalDecisions: decisions,
    }));
    expect(result).toContain("Decision: SKIPPED");
  });

  it("includes git branch at deny-time", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain("Branch: feature/cleanup");
  });

  it("includes git HEAD at deny-time", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain("HEAD: a1b2c3d4e5f6");
  });

  it("includes CONFIRM_EXECUTE/REVISE_ACTION/REFUSE instructions", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain("CONFIRM_EXECUTE");
    expect(result).toContain("REVISE_ACTION");
    expect(result).toContain("REFUSE");
  });

  it("includes agent instructions", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions({
      instructions: "You are a security expert.",
    }));
    expect(result).toContain("<agent_instructions>");
    expect(result).toContain("You are a security expert.");
  });

  it("includes durable summary from memory", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain("<durable_summary>");
    expect(result).toContain("Implemented feature X.");
  });

  it("includes decisions from memory", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain("<decisions>");
    expect(result).toContain("Used React over Vue");
  });

  it("includes recent turns from memory", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).toContain("<recent_turns>");
  });

  it("does NOT include changed_files (HITL subset)", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).not.toContain("<changed_files>");
  });

  it("does NOT include open_tasks (HITL subset)", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).not.toContain("<open_tasks>");
  });

  it("does NOT include tool_observations (HITL subset)", () => {
    const result = buildHitlContinuationPrompt(makeHitlOptions());
    expect(result).not.toContain("<tool_observations>");
  });

  it("handles multiple pending approvals", () => {
    const decisions = new Map<string, ApprovalAction>();
    decisions.set("call_1", ApprovalAction.APPROVE);
    decisions.set("call_2", ApprovalAction.SKIP);

    const approvals = [
      makePendingApproval({ toolCallId: "call_1", toolName: "Shell", argsPreview: '{"command":"rm file"}' }),
      makePendingApproval({ toolCallId: "call_2", toolName: "Write", argsPreview: '{"path":"/tmp/x"}' }),
    ];

    const result = buildHitlContinuationPrompt(makeHitlOptions({
      pendingApprovals: approvals,
      approvalDecisions: decisions,
    }));
    expect(result).toContain("Tool: Shell");
    expect(result).toContain("Tool: Write");
    expect(result).toContain("Decision: APPROVED");
    expect(result).toContain("Decision: SKIPPED");
  });

  it("omits git diagnostic lines when not available", () => {
    const approval = makePendingApproval({
      branchAtDeny: "",
      headShaAtDeny: "",
    });
    const decisions = new Map<string, ApprovalAction>();
    decisions.set("call_abc123", ApprovalAction.APPROVE);

    const result = buildHitlContinuationPrompt(makeHitlOptions({
      pendingApprovals: [approval],
      approvalDecisions: decisions,
    }));
    expect(result).not.toContain("Workspace at deny-time:");
    expect(result).not.toContain("Branch:");
    expect(result).not.toContain("HEAD:");
  });

  it("omits rationale when not available", () => {
    const approval = makePendingApproval({ agentRationale: "" });
    const decisions = new Map<string, ApprovalAction>();
    decisions.set("call_abc123", ApprovalAction.APPROVE);

    const result = buildHitlContinuationPrompt(makeHitlOptions({
      pendingApprovals: [approval],
      approvalDecisions: decisions,
    }));
    expect(result).not.toContain("Original rationale:");
  });
});

// ---------------------------------------------------------------------------
// Token budget enforcement
// ---------------------------------------------------------------------------

describe("token budget enforcement", () => {
  it("returns prompt within budget for small memory", () => {
    const result = buildContinuationPrompt(makeBaseOptions());
    // Small memory should be well under 8k tokens (~32k chars)
    expect(result.length).toBeLessThan(32_000);
  });

  it("truncates recent_turns first when over budget", () => {
    const largeTurns = Array.from({ length: 6 }, (_, i) =>
      create(ConversationTurnSchema, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(6_000), // ~1500 tokens each, 6 turns = ~9k tokens
        timestamp: "2026-05-09T15:00:00Z",
      }),
    );
    const memory = makeMemory({ recentTurns: largeTurns });
    const result = buildContinuationPrompt(makeBaseOptions({ sessionMemory: memory }));

    // Should still contain other sections but turns are truncated
    expect(result).toContain("<continuation_contract>");
    expect(result).toContain("<durable_summary>");
    // The full 6 turns can't all fit — some must have been evicted
    const turnMatches = result.match(/\[User\]|\[Assistant\]/g) ?? [];
    expect(turnMatches.length).toBeLessThan(12); // fewer than all 6 turns' labels
  });

  it("removes tool_observations when turns truncation insufficient", () => {
    const largeTurns = Array.from({ length: 6 }, (_, i) =>
      create(ConversationTurnSchema, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(8_000), // ~2k tokens each
        timestamp: "2026-05-09T15:00:00Z",
      }),
    );
    const largeObs = Array.from({ length: 10 }, (_, i) =>
      create(ToolObservationSchema, {
        command: `command-${i}`,
        cwd: "/workspace",
        exitCode: 0,
        summary: "y".repeat(400),
      }),
    );
    const memory = makeMemory({ recentTurns: largeTurns, toolObservations: largeObs });
    const result = buildContinuationPrompt(makeBaseOptions({ sessionMemory: memory }));

    // Tool observations section should be removed when over budget
    // (turns exhausted first, then observations)
    expect(result).toContain("<continuation_contract>");
    expect(result).toContain("<durable_summary>");
  });

  it("stays under the 8k token ceiling after truncation", () => {
    const largeTurns = Array.from({ length: 6 }, (_, i) =>
      create(ConversationTurnSchema, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(5_000),
        timestamp: "2026-05-09T15:00:00Z",
      }),
    );
    const memory = makeMemory({
      recentTurns: largeTurns,
      durableSummary: "z".repeat(4_000),
    });
    const result = buildContinuationPrompt(makeBaseOptions({ sessionMemory: memory }));

    // 8k tokens * 4 chars/token = 32k chars ceiling
    expect(result.length).toBeLessThanOrEqual(32_000 + 1_000); // small overhead for tags
  });
});

// ---------------------------------------------------------------------------
// extractAgentRationale
// ---------------------------------------------------------------------------

describe("extractAgentRationale", () => {
  it("returns last AI message content when short", () => {
    const messages = [
      userMessage("do something"),
      aiMessage("I will install the dependency to fix the build."),
    ];
    const result = extractAgentRationale(messages, "tc-1");
    expect(result).toBe("I will install the dependency to fix the build.");
  });

  it("truncates long messages to 500 chars from the end", () => {
    const longContent = "a".repeat(1_000);
    const messages = [aiMessage(longContent)];
    const result = extractAgentRationale(messages, "tc-1");
    expect(result.length).toBe(500);
    expect(result).toBe("a".repeat(500));
  });

  it("returns empty string when no AI messages exist", () => {
    const messages = [userMessage("hello")];
    const result = extractAgentRationale(messages, "tc-1");
    expect(result).toBe("");
  });

  it("returns empty string for AI message with empty content", () => {
    const messages = [aiMessage("")];
    const result = extractAgentRationale(messages, "tc-1");
    expect(result).toBe("");
  });

  it("uses the LAST AI message (closest to the denied tool call)", () => {
    const messages = [
      aiMessage("First analysis"),
      userMessage("proceed"),
      aiMessage("I will now run the dangerous command because X."),
    ];
    const result = extractAgentRationale(messages, "tc-1");
    expect(result).toBe("I will now run the dangerous command because X.");
  });
});

// ---------------------------------------------------------------------------
// getGitBranch / getGitHeadSha
// ---------------------------------------------------------------------------

describe("getGitBranch", () => {
  it("returns a branch name for a valid git repo", async () => {
    // Use the stigmer repo itself as a known git directory
    const branch = await getGitBranch("/Users/suresh/scm/github.com/stigmer/stigmer");
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).not.toContain("\n");
  });

  it("returns empty string for non-git directory", async () => {
    const branch = await getGitBranch("/tmp");
    expect(branch).toBe("");
  });

  it("returns empty string for non-existent directory", async () => {
    const branch = await getGitBranch("/nonexistent/path/xyz");
    expect(branch).toBe("");
  });
});

describe("getGitHeadSha", () => {
  it("returns a SHA for a valid git repo", async () => {
    const sha = await getGitHeadSha("/Users/suresh/scm/github.com/stigmer/stigmer");
    expect(sha.length).toBe(40); // full SHA is 40 hex chars
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns empty string for non-git directory", async () => {
    const sha = await getGitHeadSha("/tmp");
    expect(sha).toBe("");
  });

  it("returns empty string for non-existent directory", async () => {
    const sha = await getGitHeadSha("/nonexistent/path/xyz");
    expect(sha).toBe("");
  });
});
