import { describe, it, expect } from "vitest";
import { ExecutionPhase, MessageType, ToolCallStatus, ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "../samples";

describe("samples", () => {
  describe("session", () => {
    it("creates a session with defaults", () => {
      const s = samples.session();
      expect(s.apiVersion).toBe("agentic.stigmer.ai/v1");
      expect(s.kind).toBe("Session");
      expect(s.metadata?.name).toBe("demo-session");
      expect(s.metadata?.org).toBe("demo");
      expect(s.spec?.subject).toBe("Demo conversation");
    });

    it("applies overrides", () => {
      const s = samples.session({ name: "my-chat", subject: "Custom topic", org: "acme" });
      expect(s.metadata?.name).toBe("my-chat");
      expect(s.metadata?.org).toBe("acme");
      expect(s.spec?.subject).toBe("Custom topic");
    });
  });

  describe("agent", () => {
    it("creates an agent with defaults", () => {
      const a = samples.agent();
      expect(a.kind).toBe("Agent");
      expect(a.metadata?.name).toBe("Demo Agent");
      expect(a.spec?.description).toContain("sample agent");
    });

    it("derives slug from name override", () => {
      const a = samples.agent({ name: "My Custom Agent" });
      expect(a.metadata?.slug).toBe("my-custom-agent");
    });
  });

  describe("agentExecution", () => {
    it("creates a completed execution with default messages", () => {
      const ex = samples.agentExecution();
      expect(ex.kind).toBe("AgentExecution");
      expect(ex.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
      expect(ex.status?.messages.length).toBeGreaterThanOrEqual(2);
    });

    it("uses provided phase and messages", () => {
      const msgs = [
        samples.humanMessage("test input"),
        samples.aiMessage("test response"),
      ];
      const ex = samples.agentExecution({
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        messages: msgs,
      });
      expect(ex.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
      expect(ex.status?.messages).toHaveLength(2);
      expect(ex.status?.messages[0].content).toBe("test input");
    });
  });

  describe("skill", () => {
    it("creates a skill with SKILL.md content", () => {
      const sk = samples.skill();
      expect(sk.kind).toBe("Skill");
      expect(sk.spec?.skillMd).toContain("# Demo Skill");
    });

    it("applies custom skillMd", () => {
      const sk = samples.skill({ skillMd: "# My Skill\nCustom content" });
      expect(sk.spec?.skillMd).toContain("# My Skill");
    });
  });

  describe("mcpServer", () => {
    it("creates an MCP server with defaults", () => {
      const m = samples.mcpServer();
      expect(m.kind).toBe("McpServer");
      expect(m.metadata?.name).toBe("Demo MCP Server");
    });
  });

  describe("environment", () => {
    it("creates an environment with defaults", () => {
      const e = samples.environment();
      expect(e.kind).toBe("Environment");
      expect(e.metadata?.name).toBe("demo-env");
    });
  });

  describe("agentInstance", () => {
    it("creates an agent instance referencing demo agent", () => {
      const ai = samples.agentInstance();
      expect(ai.kind).toBe("AgentInstance");
      expect(ai.spec?.agentId).toContain("agt-");
    });
  });

  describe("message primitives", () => {
    it("humanMessage has correct type", () => {
      const msg = samples.humanMessage("Hello");
      expect(msg.type).toBe(MessageType.MESSAGE_HUMAN);
      expect(msg.content).toBe("Hello");
      expect(msg.timestamp).toBeTruthy();
    });

    it("aiMessage has correct type and optional tool calls", () => {
      const tc = samples.toolCall("web-search", "results here");
      const msg = samples.aiMessage("Here are the results", [tc]);
      expect(msg.type).toBe(MessageType.MESSAGE_AI);
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls[0].name).toBe("web-search");
    });

    it("toolCall is completed with a result", () => {
      const tc = samples.toolCall("lookup-order", '{"orderId": "123"}');
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(tc.name).toBe("lookup-order");
      expect(tc.result).toBe('{"orderId": "123"}');
    });

    it("artifact defaults to FILE kind", () => {
      const a = samples.artifact("report.md");
      expect(a.name).toBe("report.md");
      expect(a.kind).toBe(ExecutionArtifactKind.FILE);
      expect(a.storageKey).toContain("demo-artifact-");
    });
  });

  describe("list responses", () => {
    it("sessionList wraps sessions", () => {
      const list = samples.sessionList();
      expect(list.entries).toHaveLength(1);
      expect(list.totalPages).toBe(1);
    });

    it("sessionList accepts custom entries", () => {
      const sessions = [
        samples.session({ name: "s1" }),
        samples.session({ name: "s2" }),
      ];
      const list = samples.sessionList(sessions);
      expect(list.entries).toHaveLength(2);
    });

    it("agentExecutionList wraps executions", () => {
      const list = samples.agentExecutionList();
      expect(list.entries).toHaveLength(1);
      expect(list.totalPages).toBe(1);
    });

    it("searchResponse wraps search results", () => {
      const resp = samples.searchResponse();
      expect(resp.entries).toHaveLength(1);
      expect(resp.totalCount).toBe(1);
      expect(resp.totalPages).toBe(1);
    });

    it("searchResult accepts overrides", () => {
      const r = samples.searchResult({
        kind: ApiResourceKind.skill,
        name: "My Skill",
        slug: "my-skill",
        org: "acme",
      });
      expect(r.kind).toBe(ApiResourceKind.skill);
      expect(r.name).toBe("My Skill");
      expect(r.qualifiedSlug).toBe("acme/my-skill");
    });
  });
});
