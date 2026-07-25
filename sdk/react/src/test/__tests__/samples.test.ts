import { describe, it, expect, afterEach, vi } from "vitest";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ExecutionPhase, MessageType, ToolCallStatus, ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { formatDuration } from "../../execution/ToolCallDetail";
import { samples, SAMPLE_INSTANT } from "../samples";

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

// ---------------------------------------------------------------------------
// Determinism — the reason these factories exist. A `samples.*` value is
// rendered into Scenar tours that replay in the browser and export to video
// frame by frame, so any live-clock read paints a pixel that changes between
// runs (scenar-cloud DD-006). These tests are the regression lock: each one
// FAILS if a factory is reverted to reading the clock.
// ---------------------------------------------------------------------------

describe("samples determinism", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // A zero-arg call for every factory, with representative arguments. The
  // completeness test below asserts this map covers `samples` exactly, so a
  // newly-added factory that reads the clock cannot slip past the stability
  // sweep unnoticed.
  const invoke: Record<keyof typeof samples, () => unknown> = {
    session: () => samples.session(),
    agent: () => samples.agent(),
    agentExecution: () => samples.agentExecution(),
    skill: () => samples.skill(),
    mcpServer: () => samples.mcpServer(),
    environment: () => samples.environment(),
    agentInstance: () => samples.agentInstance(),
    apiKey: () => samples.apiKey(),
    humanMessage: () => samples.humanMessage("hello"),
    aiMessage: () => samples.aiMessage("hi"),
    toolCall: () => samples.toolCall("lookup_order", '{"orderId":"123"}'),
    artifact: () => samples.artifact("report.md"),
    sessionList: () => samples.sessionList(),
    agentExecutionList: () => samples.agentExecutionList(),
    searchResponse: () => samples.searchResponse(),
    apiKeyList: () => samples.apiKeyList(),
    searchResult: () => samples.searchResult(),
  };

  it("the stability sweep covers every factory", () => {
    expect(Object.keys(invoke).sort()).toEqual(Object.keys(samples).sort());
  });

  // Two calls under system clocks a full calendar day apart must produce
  // identical objects. The day boundary is deliberate: it is what reproduces
  // the `apiKey` bug (a `createdAt` date that changed daily) and the message
  // and tool-call timestamp drift, none of which a same-millisecond back-to-
  // back call would expose.
  it.each(Object.keys(invoke) as (keyof typeof samples)[])(
    "%s is identical across a day boundary",
    (name) => {
      vi.useFakeTimers();

      vi.setSystemTime(new Date("2026-03-01T08:15:00Z"));
      const first = invoke[name]();

      vi.setSystemTime(new Date("2026-03-02T21:45:30Z"));
      const second = invoke[name]();

      expect(second).toEqual(first);
    },
  );

  it("stamps the frozen instant on every timestamped primitive", () => {
    expect(samples.humanMessage("x").timestamp).toBe(SAMPLE_INSTANT);
    expect(samples.aiMessage("x").timestamp).toBe(SAMPLE_INSTANT);
    expect(samples.artifact("x").createdAt).toBe(SAMPLE_INSTANT);
    expect(samples.toolCall("x", "y").startedAt).toBe(SAMPLE_INSTANT);

    const createdAt = samples.apiKey().status?.audit?.specAudit?.createdAt;
    expect(createdAt).toBeDefined();
    expect(timestampDate(createdAt!).toISOString()).toBe(SAMPLE_INSTANT);
  });

  it("renders a stable duration chip rather than the old 0ms flake", () => {
    const tc = samples.toolCall("lookup_order", "{}");
    expect(formatDuration(tc.startedAt, tc.completedAt)).toBe("1.2s");
  });

  it("derives a clock-free tool-call id from the name", () => {
    expect(samples.toolCall("process_return", "{}").id).toBe("tc-process_return");
  });

  it("honors an ApiKeyOverrides.createdAt override", () => {
    const frozen = "2026-01-02T03:04:05.000Z";
    const key = samples.apiKey({ createdAt: frozen });
    const createdAt = key.status?.audit?.specAudit?.createdAt;
    expect(timestampDate(createdAt!).toISOString()).toBe(frozen);
  });
});
