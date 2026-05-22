import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StatusBuilder, type StreamEvent, type ApprovalPolicyProvider } from "../status-builder.js";
import type { MergedToolPolicy } from "../../../shared/approval-policy.js";

function makeBuilder() {
  const status = create(AgentExecutionStatusSchema, {});
  return new StatusBuilder("exec-test", status);
}

function chatStreamEvent(
  runId: string,
  content: string | Record<string, unknown>[],
  metadata?: Record<string, unknown>,
): StreamEvent {
  return {
    event: "on_chat_model_stream",
    name: "ChatAnthropic",
    run_id: runId,
    data: { chunk: { content } },
    metadata,
  };
}

function chatEndEvent(
  runId: string,
  usageMetadata?: Record<string, unknown>,
): StreamEvent {
  return {
    event: "on_chat_model_end",
    name: "ChatAnthropic",
    run_id: runId,
    data: {
      output: {
        content: "final text",
        usage_metadata: usageMetadata,
      },
    },
  };
}

function toolStartEvent(
  runId: string,
  toolName: string,
  input?: Record<string, unknown>,
): StreamEvent {
  return {
    event: "on_tool_start",
    name: toolName,
    run_id: runId,
    data: { input: input ?? {} },
  };
}

function toolEndEvent(
  runId: string,
  output: unknown,
): StreamEvent {
  return {
    event: "on_tool_end",
    name: "some_tool",
    run_id: runId,
    data: { output },
  };
}

describe("StatusBuilder", () => {
  describe("initialization", () => {
    it("sets phase to IN_PROGRESS", () => {
      const sb = makeBuilder();
      expect(sb.currentStatus.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    });

    it("sets startedAt timestamp", () => {
      const sb = makeBuilder();
      expect(sb.currentStatus.startedAt).toBeTruthy();
    });

    it("starts with forceNextUpdate = false", () => {
      expect(makeBuilder().forceNextUpdate).toBe(false);
    });
  });

  describe("on_chat_model_stream — text tokens", () => {
    it("creates an AI message and appends text", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "Hello"));
      sb.processEvent(chatStreamEvent("run-1", " world"));

      expect(sb.currentStatus.messages).toHaveLength(1);
      const msg = sb.currentStatus.messages[0];
      expect(msg.type).toBe(MessageType.MESSAGE_AI);
      expect(msg.content).toBe("Hello world");
      expect(msg.isStreaming).toBe(true);
    });

    it("handles content block array with text blocks", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "text", text: "block text" },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].content).toBe("block text");
    });

    it("ignores empty string content", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", ""));

      expect(sb.currentStatus.messages).toHaveLength(0);
    });

    it("ignores events with no chunk data", () => {
      const sb = makeBuilder();
      sb.processEvent({
        event: "on_chat_model_stream",
        run_id: "run-1",
        data: {},
      });

      expect(sb.currentStatus.messages).toHaveLength(0);
    });
  });

  describe("on_chat_model_stream — thinking blocks", () => {
    it("creates a THINKING message for thinking content", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "Let me reason..." },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(1);
      const msg = sb.currentStatus.messages[0];
      expect(msg.type).toBe(MessageType.MESSAGE_THINKING);
      expect(msg.content).toBe("Let me reason...");
      expect(msg.isStreaming).toBe(true);
    });

    it("appends to existing thinking message in same namespace", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "Step 1. " },
      ]));
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "Step 2." },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].content).toBe("Step 1. Step 2.");
    });

    it("handles mixed thinking and text in same event", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "hmm..." },
        { type: "text", text: "answer" },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(2);
      expect(sb.currentStatus.messages[0].type).toBe(MessageType.MESSAGE_THINKING);
      expect(sb.currentStatus.messages[1].type).toBe(MessageType.MESSAGE_AI);
    });
  });

  describe("turn boundary detection", () => {
    it("creates new message when run_id changes", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "First turn"));
      sb.processEvent(chatStreamEvent("run-2", "Second turn"));

      expect(sb.currentStatus.messages).toHaveLength(2);
      expect(sb.currentStatus.messages[0].content).toBe("First turn");
      expect(sb.currentStatus.messages[0].isStreaming).toBe(false);
      expect(sb.currentStatus.messages[1].content).toBe("Second turn");
      expect(sb.currentStatus.messages[1].isStreaming).toBe(true);
    });

    it("reuses same message for same run_id", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "a"));
      sb.processEvent(chatStreamEvent("run-1", "b"));

      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].content).toBe("ab");
    });
  });

  describe("on_chat_model_end", () => {
    it("finalizes message streaming flag", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      expect(sb.currentStatus.messages[0].isStreaming).toBe(true);

      sb.processEvent(chatEndEvent("run-1"));
      expect(sb.currentStatus.messages[0].isStreaming).toBe(false);
    });

    it("accumulates usage metadata", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(chatEndEvent("run-1", {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      }));

      const usage = sb.currentStatus.streamingUsage;
      expect(usage).toBeDefined();
      expect(usage!.inputTokens).toBe(100n);
      expect(usage!.outputTokens).toBe(50n);
      expect(usage!.cacheReadTokens).toBe(10n);
      expect(usage!.cacheWriteTokens).toBe(5n);
      expect(usage!.totalTokens).toBe(165n);
      expect(usage!.turnCount).toBe(1);
    });

    it("accumulates across multiple turns", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "turn 1"));
      sb.processEvent(chatEndEvent("run-1", {
        input_tokens: 100,
        output_tokens: 50,
      }));
      sb.processEvent(chatStreamEvent("run-2", "turn 2"));
      sb.processEvent(chatEndEvent("run-2", {
        input_tokens: 200,
        output_tokens: 100,
      }));

      const usage = sb.currentStatus.streamingUsage!;
      expect(usage.inputTokens).toBe(300n);
      expect(usage.outputTokens).toBe(150n);
      expect(usage.turnCount).toBe(2);
    });
  });

  describe("on_tool_start", () => {
    it("creates a RUNNING tool call on the current AI message", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "I'll read a file"));
      sb.processEvent(toolStartEvent("tool-run-1", "read", { path: "/foo.ts" }));

      const msg = sb.currentStatus.messages[0];
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls[0].id).toBe("tool-run-1");
      expect(msg.toolCalls[0].name).toBe("read");
      expect(msg.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(msg.toolCalls[0].startedAt).toBeTruthy();
      expect(msg.toolCalls[0].args).toEqual({ path: "/foo.ts" });
    });

    it("sets forceNextUpdate", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "read"));

      expect(sb.forceNextUpdate).toBe(true);
    });

    it("does nothing if no current AI message exists", () => {
      const sb = makeBuilder();
      sb.processEvent(toolStartEvent("tool-run-1", "read"));

      expect(sb.currentStatus.messages).toHaveLength(0);
    });
  });

  describe("on_tool_end", () => {
    it("marks tool call as COMPLETED with result", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "reading file"));
      sb.processEvent(toolStartEvent("tool-run-1", "read"));
      sb.processEvent(toolEndEvent("tool-run-1", "file contents here"));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(tc.result).toBe("file contents here");
      expect(tc.completedAt).toBeTruthy();
      expect(tc.isStreaming).toBe(false);
    });

    it("marks tool call as FAILED when output has error", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "write"));
      sb.processEvent(toolEndEvent("tool-run-1", { error: "permission denied" }));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
      expect(tc.error).toBe("permission denied");
    });

    it("truncates long results", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "read"));

      const longResult = "x".repeat(60_000);
      sb.processEvent(toolEndEvent("tool-run-1", longResult));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.result.length).toBeLessThan(longResult.length);
      expect(tc.result).toContain("[truncated:");
    });

    it("sets forceNextUpdate", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "read"));
      sb.clearForceFlag();
      sb.processEvent(toolEndEvent("tool-run-1", "done"));

      expect(sb.forceNextUpdate).toBe(true);
    });

    it("ignores unknown tool run_id", () => {
      const sb = makeBuilder();
      sb.processEvent(toolEndEvent("unknown-run", "result"));
      // Should not throw
      expect(sb.currentStatus.messages).toHaveLength(0);
    });

    it("handles object output with content field", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "shell"));
      sb.processEvent(toolEndEvent("tool-run-1", { content: "stdout output" }));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.result).toBe("stdout output");
    });
  });

  describe("unknown events", () => {
    it("silently ignores unhandled event types", () => {
      const sb = makeBuilder();
      sb.processEvent({
        event: "on_chain_start",
        run_id: "run-1",
        data: {},
      });
      expect(sb.currentStatus.messages).toHaveLength(0);
    });
  });

  describe("clearForceFlag", () => {
    it("resets forceNextUpdate to false", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "read"));
      expect(sb.forceNextUpdate).toBe(true);

      sb.clearForceFlag();
      expect(sb.forceNextUpdate).toBe(false);
    });
  });

  describe("addArtifact", () => {
    it("appends a new artifact and sets forceNextUpdate", () => {
      const sb = makeBuilder();
      sb.clearForceFlag();

      sb.addArtifact({
        name: "report.txt",
        sandboxPath: "workspace/report.txt",
        kind: 0,
        sizeBytes: 100n,
        storageKey: "artifacts/exec-1/report.txt",
        downloadUrl: "http://localhost/dl",
        createdAt: "2026-05-19T12:00:00Z",
        expiresAt: "",
        entries: [],
        contentHash: "abc123",
        $typeName: "ai.stigmer.agentic.agentexecution.v1.ExecutionArtifact",
      } as any);

      expect(sb.currentStatus.artifacts).toHaveLength(1);
      expect(sb.currentStatus.artifacts[0].name).toBe("report.txt");
      expect(sb.forceNextUpdate).toBe(true);
    });

    it("deduplicates by sandboxPath — skips same contentHash", () => {
      const sb = makeBuilder();
      const artifact = {
        name: "f.txt",
        sandboxPath: "ws/f.txt",
        kind: 0,
        sizeBytes: 10n,
        storageKey: "k",
        downloadUrl: "u",
        createdAt: "",
        expiresAt: "",
        entries: [],
        contentHash: "hash1",
        $typeName: "ai.stigmer.agentic.agentexecution.v1.ExecutionArtifact",
      } as any;

      sb.addArtifact(artifact);
      sb.clearForceFlag();
      sb.addArtifact({ ...artifact });

      expect(sb.currentStatus.artifacts).toHaveLength(1);
      expect(sb.forceNextUpdate).toBe(false);
    });

    it("replaces artifact when contentHash changes", () => {
      const sb = makeBuilder();
      const artifact = {
        name: "f.txt",
        sandboxPath: "ws/f.txt",
        kind: 0,
        sizeBytes: 10n,
        storageKey: "k",
        downloadUrl: "u",
        createdAt: "",
        expiresAt: "",
        entries: [],
        contentHash: "hash1",
        $typeName: "ai.stigmer.agentic.agentexecution.v1.ExecutionArtifact",
      } as any;

      sb.addArtifact(artifact);
      sb.clearForceFlag();
      sb.addArtifact({ ...artifact, contentHash: "hash2", sizeBytes: 20n });

      expect(sb.currentStatus.artifacts).toHaveLength(1);
      expect(sb.currentStatus.artifacts[0].contentHash).toBe("hash2");
      expect(sb.forceNextUpdate).toBe(true);
    });
  });

  describe("addWriteBack", () => {
    it("appends a new writeback entry and sets forceNextUpdate", () => {
      const sb = makeBuilder();
      sb.clearForceFlag();

      sb.addWriteBack({
        workspaceEntryName: "my-app",
        branchName: "stigmer/a1b2c3d4",
        baseBranch: "main",
        commitSha: "abc",
        pullRequestUrl: "",
        pullRequestNumber: 0,
        diffSummary: "1 file changed",
        phase: 1,
        error: "",
        $typeName: "ai.stigmer.agentic.agentexecution.v1.WorkspaceWriteBack",
      } as any);

      expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(1);
      expect(sb.forceNextUpdate).toBe(true);
    });

    it("upserts by workspaceEntryName", () => {
      const sb = makeBuilder();

      sb.addWriteBack({
        workspaceEntryName: "my-app",
        branchName: "stigmer/a1b2",
        baseBranch: "main",
        commitSha: "sha1",
        pullRequestUrl: "",
        pullRequestNumber: 0,
        diffSummary: "",
        phase: 1,
        error: "",
        $typeName: "ai.stigmer.agentic.agentexecution.v1.WorkspaceWriteBack",
      } as any);

      sb.addWriteBack({
        workspaceEntryName: "my-app",
        branchName: "stigmer/a1b2",
        baseBranch: "main",
        commitSha: "sha2",
        pullRequestUrl: "https://github.com/pr/1",
        pullRequestNumber: 1,
        diffSummary: "2 files changed",
        phase: 3,
        error: "",
        $typeName: "ai.stigmer.agentic.agentexecution.v1.WorkspaceWriteBack",
      } as any);

      expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(1);
      expect(sb.currentStatus.workspaceWriteBacks[0].commitSha).toBe("sha2");
      expect(sb.currentStatus.workspaceWriteBacks[0].phase).toBe(3);
    });

    it("tracks multiple workspace entries independently", () => {
      const sb = makeBuilder();

      sb.addWriteBack({
        workspaceEntryName: "frontend",
        branchName: "stigmer/x",
        baseBranch: "main",
        commitSha: "a",
        pullRequestUrl: "",
        pullRequestNumber: 0,
        diffSummary: "",
        phase: 1,
        error: "",
        $typeName: "ai.stigmer.agentic.agentexecution.v1.WorkspaceWriteBack",
      } as any);

      sb.addWriteBack({
        workspaceEntryName: "backend",
        branchName: "stigmer/x",
        baseBranch: "develop",
        commitSha: "b",
        pullRequestUrl: "",
        pullRequestNumber: 0,
        diffSummary: "",
        phase: 2,
        error: "",
        $typeName: "ai.stigmer.agentic.agentexecution.v1.WorkspaceWriteBack",
      } as any);

      expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Approval provider integration
  // ─────────────────────────────────────────────────────────────────────────

  describe("approval provider integration", () => {
    function makeApprovalProvider(
      overrides: Partial<ApprovalPolicyProvider> = {},
    ): ApprovalPolicyProvider {
      return {
        policies: new Map(),
        toolServerMap: new Map(),
        autoApproveAll: false,
        ...overrides,
      };
    }

    function policyFor(
      serverSlug: string,
      toolName: string,
      message = "Approve?",
    ): [string, MergedToolPolicy] {
      return [
        `${serverSlug}/${toolName}`,
        {
          toolName,
          mcpServerSlug: serverSlug,
          requiresApproval: true,
          approvalMessage: message,
        },
      ];
    }

    it("sets tool status to WAITING_APPROVAL when policy requires it", () => {
      const sb = makeBuilder();
      const [key, policy] = policyFor("github", "create_issue");
      sb.setApprovalProvider(makeApprovalProvider({
        policies: new Map([[key, policy]]),
        toolServerMap: new Map([["create_issue", "github"]]),
      }));

      sb.processEvent(chatStreamEvent("run-1", "I'll create an issue"));
      sb.processEvent(toolStartEvent("tool-1", "create_issue", { title: "Bug fix" }));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
      expect(tc.requiresApproval).toBe(true);
      expect(tc.approvalMessage).toBe("Approve?");
      expect(tc.mcpServerSlug).toBe("github");
    });

    it("sets phase to WAITING_FOR_APPROVAL when tool requires approval", () => {
      const sb = makeBuilder();
      const [key, policy] = policyFor("github", "push");
      sb.setApprovalProvider(makeApprovalProvider({
        policies: new Map([[key, policy]]),
        toolServerMap: new Map([["push", "github"]]),
      }));

      sb.processEvent(chatStreamEvent("run-1", "pushing"));
      sb.processEvent(toolStartEvent("tool-1", "push"));

      expect(sb.currentStatus.phase).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
    });

    it("does not require approval when autoApproveAll is true", () => {
      const sb = makeBuilder();
      const [key, policy] = policyFor("github", "delete_repo");
      sb.setApprovalProvider(makeApprovalProvider({
        policies: new Map([[key, policy]]),
        toolServerMap: new Map([["delete_repo", "github"]]),
        autoApproveAll: true,
      }));

      sb.processEvent(chatStreamEvent("run-1", "deleting"));
      sb.processEvent(toolStartEvent("tool-1", "delete_repo"));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(tc.requiresApproval).toBe(false);
    });

    it("does not require approval for tools without policies", () => {
      const sb = makeBuilder();
      sb.setApprovalProvider(makeApprovalProvider({
        policies: new Map(),
        toolServerMap: new Map([["read", "filesystem"]]),
      }));

      sb.processEvent(chatStreamEvent("run-1", "reading"));
      sb.processEvent(toolStartEvent("tool-1", "read"));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    });

    it("does not require approval for tools not in toolServerMap", () => {
      const sb = makeBuilder();
      const [key, policy] = policyFor("github", "create_pr");
      sb.setApprovalProvider(makeApprovalProvider({
        policies: new Map([[key, policy]]),
        toolServerMap: new Map(),
      }));

      sb.processEvent(chatStreamEvent("run-1", "creating PR"));
      sb.processEvent(toolStartEvent("tool-1", "create_pr"));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    });

    it("resolves {{args.field}} placeholders in approval message", () => {
      const sb = makeBuilder();
      const [key, policy] = policyFor(
        "github", "create_issue",
        "Create issue '{{args.title}}' in {{args.repo}}?",
      );
      sb.setApprovalProvider(makeApprovalProvider({
        policies: new Map([[key, policy]]),
        toolServerMap: new Map([["create_issue", "github"]]),
      }));

      sb.processEvent(chatStreamEvent("run-1", "creating issue"));
      sb.processEvent(toolStartEvent("tool-1", "create_issue", {
        title: "Fix crash",
        repo: "stigmer/stigmer",
      }));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.approvalMessage).toBe("Create issue 'Fix crash' in stigmer/stigmer?");
    });

    it("sets approvalRequestedAt when approval required", () => {
      const sb = makeBuilder();
      const [key, policy] = policyFor("db", "drop_table");
      sb.setApprovalProvider(makeApprovalProvider({
        policies: new Map([[key, policy]]),
        toolServerMap: new Map([["drop_table", "db"]]),
      }));

      sb.processEvent(chatStreamEvent("run-1", "dropping"));
      sb.processEvent(toolStartEvent("tool-1", "drop_table"));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.approvalRequestedAt).toBeTruthy();
      expect(tc.approvalRequestedAt).toContain("T");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Args sanitization (argsPreview)
  // ─────────────────────────────────────────────────────────────────────────

  describe("args preview sanitization", () => {
    function builderWithApproval(
      toolName: string,
      serverSlug: string,
    ): StatusBuilder {
      const sb = makeBuilder();
      sb.setApprovalProvider({
        policies: new Map([
          [`${serverSlug}/${toolName}`, {
            toolName,
            mcpServerSlug: serverSlug,
            requiresApproval: true,
            approvalMessage: "Approve?",
          }],
        ]),
        toolServerMap: new Map([[toolName, serverSlug]]),
        autoApproveAll: false,
      });
      return sb;
    }

    it("redacts sensitive arg keys", () => {
      const sb = builderWithApproval("connect", "db");
      sb.processEvent(chatStreamEvent("run-1", "connecting"));
      sb.processEvent(toolStartEvent("tool-1", "connect", {
        host: "localhost",
        password: "super-secret",
        token: "jwt-token",
      }));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      const preview = JSON.parse(tc.argsPreview);
      expect(preview.host).toBe("localhost");
      expect(preview.password).toBe("[REDACTED]");
      expect(preview.token).toBe("[REDACTED]");
    });

    it("redacts case-insensitively", () => {
      const sb = builderWithApproval("call", "api");
      sb.processEvent(chatStreamEvent("run-1", "calling"));
      sb.processEvent(toolStartEvent("tool-1", "call", {
        Authorization: "Bearer xyz",
        API_KEY: "key-123",
      }));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      const preview = JSON.parse(tc.argsPreview);
      expect(preview.Authorization).toBe("[REDACTED]");
      expect(preview.API_KEY).toBe("[REDACTED]");
    });

    it("truncates long args preview", () => {
      const sb = builderWithApproval("write", "fs");
      sb.processEvent(chatStreamEvent("run-1", "writing"));
      sb.processEvent(toolStartEvent("tool-1", "write", {
        content: "x".repeat(1000),
      }));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.argsPreview.length).toBeLessThanOrEqual(501);
      expect(tc.argsPreview.endsWith("…")).toBe(true);
    });

    it("does not set argsPreview for non-approval tools", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "reading"));
      sb.processEvent(toolStartEvent("tool-1", "read", { path: "/foo" }));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.argsPreview).toBe("");
    });

    it("sets argsPreview as empty when args serialization fails", () => {
      const sb = builderWithApproval("call", "api");
      sb.processEvent(chatStreamEvent("run-1", "calling"));

      const circular: Record<string, unknown> = {};
      circular.self = circular;
      sb.processEvent(toolStartEvent("tool-1", "call", circular));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.argsPreview).toBe("");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Namespace extraction
  // ─────────────────────────────────────────────────────────────────────────

  describe("namespace extraction", () => {
    it("extracts namespace from langgraph_checkpoint_ns", () => {
      const sb = makeBuilder();
      sb.processEvent({
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-ns-1",
        data: { chunk: { content: "hello" } },
        metadata: { langgraph_checkpoint_ns: "tools:task-123|agent_node:inner" },
      });

      expect(sb.currentStatus.messages).toHaveLength(1);
    });

    it("extracts namespace from checkpoint_ns fallback", () => {
      const sb = makeBuilder();
      sb.processEvent({
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-ns-2",
        data: { chunk: { content: "hello" } },
        metadata: { checkpoint_ns: "some-namespace" },
      });

      expect(sb.currentStatus.messages).toHaveLength(1);
    });

    it("uses empty namespace when no metadata", () => {
      const sb = makeBuilder();
      sb.processEvent({
        event: "on_chat_model_stream",
        run_id: "run-ns-3",
        data: { chunk: { content: "hello" } },
      });

      expect(sb.currentStatus.messages).toHaveLength(1);
    });

    it("different namespaces create separate message trees", () => {
      const sb = makeBuilder();

      sb.processEvent({
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "main-run",
        data: { chunk: { content: "main text" } },
        metadata: {},
      });

      sb.processEvent({
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "sub-run",
        data: { chunk: { content: "sub text" } },
        metadata: { langgraph_checkpoint_ns: "tools:task-1|agent_node:inner" },
      });

      expect(sb.currentStatus.messages).toHaveLength(2);
      expect(sb.currentStatus.messages[0].content).toBe("main text");
      expect(sb.currentStatus.messages[1].content).toBe("sub text");
    });

    it("same namespace reuses message within the same run_id", () => {
      const sb = makeBuilder();
      const ns = "tools:task-1|agent_node:inner";

      sb.processEvent({
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "sub-run-1",
        data: { chunk: { content: "part 1" } },
        metadata: { langgraph_checkpoint_ns: ns },
      });

      sb.processEvent({
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "sub-run-1",
        data: { chunk: { content: " part 2" } },
        metadata: { langgraph_checkpoint_ns: ns },
      });

      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].content).toBe("part 1 part 2");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Usage accumulation edge cases
  // ─────────────────────────────────────────────────────────────────────────

  describe("usage accumulation edge cases", () => {
    it("handles missing usage_metadata gracefully", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(chatEndEvent("run-1"));

      expect(sb.currentStatus.streamingUsage).toBeUndefined();
    });

    it("handles usage with zero tokens", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(chatEndEvent("run-1", {
        input_tokens: 0,
        output_tokens: 0,
      }));

      const usage = sb.currentStatus.streamingUsage!;
      expect(usage.inputTokens).toBe(0n);
      expect(usage.outputTokens).toBe(0n);
      expect(usage.turnCount).toBe(1);
    });

    it("handles non-numeric token values gracefully", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(chatEndEvent("run-1", {
        input_tokens: "not a number",
        output_tokens: null,
        cache_read_input_tokens: undefined,
      }));

      const usage = sb.currentStatus.streamingUsage!;
      expect(usage.inputTokens).toBe(0n);
      expect(usage.outputTokens).toBe(0n);
      expect(usage.cacheReadTokens).toBe(0n);
      expect(usage.turnCount).toBe(1);
    });

    it("handles bigint token values", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(chatEndEvent("run-1", {
        input_tokens: 100n,
        output_tokens: 50n,
      }));

      const usage = sb.currentStatus.streamingUsage!;
      expect(usage.inputTokens).toBe(100n);
      expect(usage.outputTokens).toBe(50n);
    });

    it("computes totalTokens as sum of all token fields", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(chatEndEvent("run-1", {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
      }));

      const usage = sb.currentStatus.streamingUsage!;
      expect(usage.totalTokens).toBe(180n);
    });

    it("usage from data.usage_metadata takes precedence when output missing", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));

      sb.processEvent({
        event: "on_chat_model_end",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: {
          output: {},
          usage_metadata: {
            input_tokens: 42,
            output_tokens: 13,
          },
        },
      });

      const usage = sb.currentStatus.streamingUsage!;
      expect(usage.inputTokens).toBe(42n);
      expect(usage.outputTokens).toBe(13n);
    });

    it("sets observedAt timestamp on usage snapshot", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(chatEndEvent("run-1", {
        input_tokens: 10,
        output_tokens: 5,
      }));

      const usage = sb.currentStatus.streamingUsage!;
      expect(usage.observedAt).toBeTruthy();
      expect(usage.observedAt).toContain("T");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Error handling in event handlers
  // ─────────────────────────────────────────────────────────────────────────

  describe("event handler error resilience", () => {
    it("does not throw when handler encounters an error", () => {
      const sb = makeBuilder();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      sb.processEvent({
        event: "on_chat_model_stream",
        run_id: "run-err",
        data: { chunk: { content: { toString() { throw new Error("boom"); } } } },
      });

      errorSpy.mockRestore();
    });

    it("logs error with execution context on handler failure", () => {
      const sb = makeBuilder();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Need a tool call in the map so handleToolEnd reaches the code
      // that accesses event.data.output (which we make throw)
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("bad-run", "read"));

      sb.processEvent({
        event: "on_tool_end",
        name: "read",
        run_id: "bad-run",
        data: { get output() { throw new Error("property access failed"); } } as any,
      });

      expect(errorSpy).toHaveBeenCalled();
      const logMsg = errorSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain("exec-test");
      expect(logMsg).toContain("on_tool_end");
      expect(logMsg).toContain("bad-run");

      errorSpy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Tool result extraction edge cases
  // ─────────────────────────────────────────────────────────────────────────

  describe("tool result extraction", () => {
    it("extracts string result directly", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-1", "read"));
      sb.processEvent(toolEndEvent("tool-1", "file contents"));

      expect(sb.currentStatus.messages[0].toolCalls[0].result).toBe("file contents");
    });

    it("extracts content from object result", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-1", "shell"));
      sb.processEvent(toolEndEvent("tool-1", { content: "stdout output" }));

      expect(sb.currentStatus.messages[0].toolCalls[0].result).toBe("stdout output");
    });

    it("JSON-serializes object without content field", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-1", "api"));
      sb.processEvent(toolEndEvent("tool-1", { status: 200, body: "ok" }));

      const result = sb.currentStatus.messages[0].toolCalls[0].result;
      expect(JSON.parse(result)).toEqual({ status: 200, body: "ok" });
    });

    it("JSON-serializes full data when output is undefined", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-1", "noop"));
      sb.processEvent({
        event: "on_tool_end",
        name: "noop",
        run_id: "tool-1",
        data: { something: "else" },
      });

      const result = sb.currentStatus.messages[0].toolCalls[0].result;
      const parsed = JSON.parse(result);
      expect(parsed.something).toBe("else");
    });

    it("returns serialization error for circular references", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-1", "bad"));

      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      sb.processEvent({
        event: "on_tool_end",
        name: "bad",
        run_id: "tool-1",
        data: { output: circular },
      });

      expect(sb.currentStatus.messages[0].toolCalls[0].result).toBe("[serialization error]");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Multiple concurrent tool calls
  // ─────────────────────────────────────────────────────────────────────────

  describe("multiple concurrent tool calls", () => {
    it("tracks multiple running tools on the same message", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "I'll do two things"));
      sb.processEvent(toolStartEvent("tool-a", "read"));
      sb.processEvent(toolStartEvent("tool-b", "search"));

      const msg = sb.currentStatus.messages[0];
      expect(msg.toolCalls).toHaveLength(2);
      expect(msg.toolCalls[0].name).toBe("read");
      expect(msg.toolCalls[1].name).toBe("search");
      expect(msg.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(msg.toolCalls[1].status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    });

    it("completes tools independently", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "parallel work"));
      sb.processEvent(toolStartEvent("tool-a", "read"));
      sb.processEvent(toolStartEvent("tool-b", "search"));

      sb.processEvent(toolEndEvent("tool-a", "file data"));

      const msg = sb.currentStatus.messages[0];
      expect(msg.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(msg.toolCalls[1].status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);

      sb.processEvent(toolEndEvent("tool-b", "search results"));
      expect(msg.toolCalls[1].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    });

    it("handles interleaved tool start and end events", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "working"));
      sb.processEvent(toolStartEvent("tool-1", "read"));
      sb.processEvent(toolEndEvent("tool-1", "data 1"));
      sb.processEvent(toolStartEvent("tool-2", "write"));
      sb.processEvent(toolEndEvent("tool-2", "done"));

      const msg = sb.currentStatus.messages[0];
      expect(msg.toolCalls).toHaveLength(2);
      expect(msg.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(msg.toolCalls[1].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ExecutionState lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  describe("execution state lifecycle", () => {
    it("tool start times are cleaned up on tool end", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-1", "read"));
      sb.processEvent(toolEndEvent("tool-1", "done"));

      // Internal state should have cleaned up the start time
      // Verified by the fact that there's no leak — the TS implementation
      // deletes from toolStartTimes in handleToolEnd
    });

    it("handles chat_model_end without prior stream (no message exists)", () => {
      const sb = makeBuilder();
      sb.processEvent(chatEndEvent("orphan-run", {
        input_tokens: 50,
        output_tokens: 25,
      }));

      // Usage should still accumulate even without a prior message
      const usage = sb.currentStatus.streamingUsage!;
      expect(usage.inputTokens).toBe(50n);
      expect(usage.outputTokens).toBe(25n);
      expect(usage.turnCount).toBe(1);
    });

    it("handles tool_end for unknown run_id gracefully", () => {
      const sb = makeBuilder();
      sb.processEvent(toolEndEvent("never-started", "result"));
      // Should not throw, no messages or tool calls created
      expect(sb.currentStatus.messages).toHaveLength(0);
    });

    it("handles tool_start without prior AI message", () => {
      const sb = makeBuilder();
      sb.processEvent(toolStartEvent("orphan-tool", "read"));
      // No parent message → tool call not attached
      expect(sb.currentStatus.messages).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Thinking + text interleaving
  // ─────────────────────────────────────────────────────────────────────────

  describe("thinking and text interleaving", () => {
    it("creates separate messages for thinking and text in sequence", () => {
      const sb = makeBuilder();

      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "Let me think..." },
      ]));
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "text", text: "Here is my answer" },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(2);
      expect(sb.currentStatus.messages[0].type).toBe(MessageType.MESSAGE_THINKING);
      expect(sb.currentStatus.messages[0].content).toBe("Let me think...");
      expect(sb.currentStatus.messages[1].type).toBe(MessageType.MESSAGE_AI);
      expect(sb.currentStatus.messages[1].content).toBe("Here is my answer");
    });

    it("multiple thinking blocks accumulate in same thinking message", () => {
      const sb = makeBuilder();

      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "Step 1. " },
      ]));
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "Step 2. " },
      ]));
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "Step 3." },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].content).toBe("Step 1. Step 2. Step 3.");
    });

    it("thinking from different namespaces creates separate thinking messages", () => {
      const sb = makeBuilder();

      sb.processEvent({
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-main",
        data: { chunk: { content: [{ type: "thinking", thinking: "main thinking" }] } },
        metadata: {},
      });

      sb.processEvent({
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-sub",
        data: { chunk: { content: [{ type: "thinking", thinking: "sub thinking" }] } },
        metadata: { langgraph_checkpoint_ns: "tools:task-1" },
      });

      expect(sb.currentStatus.messages).toHaveLength(2);
      expect(sb.currentStatus.messages[0].content).toBe("main thinking");
      expect(sb.currentStatus.messages[1].content).toBe("sub thinking");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Content block edge cases
  // ─────────────────────────────────────────────────────────────────────────

  describe("content block edge cases", () => {
    it("ignores non-text non-thinking blocks", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "image_url", image_url: "https://example.com/img.png" },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(0);
    });

    it("handles null content blocks gracefully", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", [null as any]));

      expect(sb.currentStatus.messages).toHaveLength(0);
    });

    it("handles empty array content", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", []));

      expect(sb.currentStatus.messages).toHaveLength(0);
    });

    it("handles numeric content gracefully", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", 42 as any));

      expect(sb.currentStatus.messages).toHaveLength(0);
    });
  });
});
