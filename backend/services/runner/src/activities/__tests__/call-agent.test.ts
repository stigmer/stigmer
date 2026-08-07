import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

let mockGetAgentByReference: ReturnType<typeof vi.fn>;
let mockCreateSession: ReturnType<typeof vi.fn>;
let mockCreateAgentExecution: ReturnType<typeof vi.fn>;

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      info: {
        taskToken: new Uint8Array([1, 2, 3]),
      },
    }),
  },
  CompleteAsyncError: class CompleteAsyncError extends Error {
    constructor() {
      super("CompleteAsyncError");
      this.name = "CompleteAsyncError";
    }
  },
}));

vi.mock("../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(() => ({
    getAgentByReference: (...args: unknown[]) => mockGetAgentByReference(...args),
    applySession: (...args: unknown[]) => mockCreateSession(...args),
    createAgentExecution: (...args: unknown[]) => mockCreateAgentExecution(...args),
  })),
}));

vi.mock("../../config.js", () => ({
  loadConfig: () => ({
    stigmerBackendEndpoint: "http://localhost:7234",
    stigmerToken: "test-token",
  }),
}));

vi.mock("../../shared/heartbeat.js", () => ({
  startHeartbeat: () => ({ stop: vi.fn() }),
}));

import { callAgentAction } from "../call-agent.js";

describe("callAgentAction", () => {
  beforeEach(() => {
    mockGetAgentByReference = vi.fn().mockResolvedValue({
      metadata: { id: "agt_test123" },
      status: { defaultInstanceId: "ain_default456" },
    });
    mockCreateSession = vi.fn().mockResolvedValue({
      metadata: { id: "ses_test789" },
    });
    mockCreateAgentExecution = vi.fn().mockResolvedValue({
      metadata: { id: "aex_test000" },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("ApiResourceReference construction", () => {
    it("sets kind to ApiResourceKind.agent for org-relative slug", async () => {
      await expect(
        callAgentAction(
          { agent: "notification-analyst", message: "Analyze data" },
          { __stigmer_org_id: "tt-demo" },
          "wfl_parent123",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      expect(mockGetAgentByReference).toHaveBeenCalledOnce();
      const ref = mockGetAgentByReference.mock.calls[0][0];
      expect(ref.kind).toBe(ApiResourceKind.agent);
      expect(ref.org).toBe("tt-demo");
      expect(ref.slug).toBe("notification-analyst");
    });

    it("sets kind to ApiResourceKind.agent for org-prefixed slug", async () => {
      await expect(
        callAgentAction(
          { agent: "acme/my-agent", message: "Do something" },
          { __stigmer_org_id: "default-org" },
          "wfl_parent456",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      expect(mockGetAgentByReference).toHaveBeenCalledOnce();
      const ref = mockGetAgentByReference.mock.calls[0][0];
      expect(ref.kind).toBe(ApiResourceKind.agent);
      expect(ref.org).toBe("acme");
      expect(ref.slug).toBe("my-agent");
    });

    it("org/slug agent reference overrides the workflow org for lookup only", async () => {
      await expect(
        callAgentAction(
          { agent: "explicit-org/my-agent", message: "Hello" },
          { __stigmer_org_id: "workflow-org" },
          "wfl_parent789",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const ref = mockGetAgentByReference.mock.calls[0][0];
      expect(ref.org).toBe("explicit-org");
      expect(ref.slug).toBe("my-agent");
      expect(ref.kind).toBe(ApiResourceKind.agent);

      // The execution itself is still created in the workflow's org — the
      // cross-org reference changes agent lookup, never the billing org.
      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.metadata?.org).toBe("workflow-org");
    });
  });

  describe("org resolution", () => {
    it("throws when no org is available", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          {},
          "wfl_parent",
        ),
      ).rejects.toThrow("call:agent requires an organization context");
    });

    it("uses __stigmer_org_id from runtime env", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "env-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const ref = mockGetAgentByReference.mock.calls[0][0];
      expect(ref.org).toBe("env-org");
    });
  });

  describe("agent resolution failure", () => {
    it("throws when resolved agent has no metadata.id", async () => {
      mockGetAgentByReference.mockResolvedValue({
        metadata: {},
        status: { defaultInstanceId: "ain_123" },
      });

      await expect(
        callAgentAction(
          { agent: "ghost-agent", message: "Hello" },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("resolved but has no metadata.id");
    });
  });

  describe("post-resolution validation", () => {
    it("throws when agent field resolves to empty string", async () => {
      await expect(
        callAgentAction(
          { agent: "", message: "Hello" },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("'agent' resolved to empty");
    });

    it("throws when message field resolves to empty string", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "" },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("'message' resolved to empty");
    });
  });

  describe("downstream calls", () => {
    it("creates session with correct envelope, metadata, and spec", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello", harness: "CURSOR" },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      expect(mockCreateSession).toHaveBeenCalledOnce();
      const session = mockCreateSession.mock.calls[0][0];
      expect(session.apiVersion).toBe("agentic.stigmer.ai/v1");
      expect(session.kind).toBe("Session");
      expect(session.metadata.org).toBe("test-org");
      expect(session.metadata.name).toMatch(/^wf-my-agent-\d+$/);
      expect(session.spec.agentInstanceId).toBe("ain_default456");
    });

    it("creates session with 'Auto-created session' sentinel subject", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      expect(mockCreateSession).toHaveBeenCalledOnce();
      const session = mockCreateSession.mock.calls[0][0];
      expect(session.spec.subject).toBe("Auto-created session");
    });

    it("creates agent execution with correct envelope and spec", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Review this" },
          { __stigmer_org_id: "test-org" },
          "wfl_parent_id",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      expect(mockCreateAgentExecution).toHaveBeenCalledOnce();
      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.apiVersion).toBe("agentic.stigmer.ai/v1");
      expect(execution.kind).toBe("AgentExecution");
      expect(execution.metadata.org).toBe("test-org");
      expect(execution.metadata.name).toMatch(/^aex-wf-my-agent-\d+$/);
      expect(execution.spec.agentId).toBe("agt_test123");
      expect(execution.spec.sessionId).toBe("ses_test789");
      expect(execution.spec.message).toBe("Review this");
      expect(execution.spec.parentWorkflowId).toBe("wfl_parent_id");
      expect(execution.spec.callbackToken).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("propagates sandbox queue affinity from parent", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          {
            __stigmer_org_id: "test-org",
            __stigmer_activity_task_queue: "wfexec:wex_abc123",
          },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.spec.activityTaskQueue).toBe("wfexec:wex_abc123");
    });

    it("does not propagate non-wfexec queue", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          {
            __stigmer_org_id: "test-org",
            __stigmer_activity_task_queue: "stigmer_runner",
          },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.spec.activityTaskQueue).toBe("");
    });
  });

  describe("run_config → ExecutionConfig mapping (#358)", () => {
    it("maps model_name, max_cost_usd, and max_tool_rounds onto ExecutionConfig", async () => {
      await expect(
        callAgentAction(
          {
            agent: "my-agent",
            message: "Hello",
            run_config: {
              model_name: "claude-sonnet-4-6",
              max_cost_usd: 0.75,
              max_tool_rounds: 15,
            },
          },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.spec.executionConfig).toBeDefined();
      expect(execution.spec.executionConfig.modelName).toBe("claude-sonnet-4-6");
      expect(execution.spec.executionConfig.maxCostUsd).toBe(0.75);
      expect(execution.spec.executionConfig.maxToolRounds).toBe(15);
    });

    it("maps a canonical service_tier onto ExecutionConfig.serviceTier (#357)", async () => {
      await expect(
        callAgentAction(
          {
            agent: "my-agent",
            message: "Hello",
            run_config: { service_tier: "SERVICE_TIER_FAST" },
          },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.spec.executionConfig).toBeDefined();
      expect(execution.spec.executionConfig.serviceTier).toBe(ServiceTier.FAST);
    });

    it("fails loudly on a service_tier value with no proto mapping", async () => {
      // The loader canonicalizes tiers; an unmapped value reaching the
      // activity means loader/activity drift. A pricing directive must
      // never be silently dropped.
      await expect(
        callAgentAction(
          {
            agent: "my-agent",
            message: "Hello",
            run_config: { service_tier: "SERVICE_TIER_TURBO" },
          },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow(
        "call:agent run_config.service_tier 'SERVICE_TIER_TURBO' has no proto mapping",
      );
    });

    it("omits ExecutionConfig entirely when run_config and output are absent", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.spec.executionConfig).toBeUndefined();
    });

    it("treats zero bounds as no override", async () => {
      await expect(
        callAgentAction(
          {
            agent: "my-agent",
            message: "Hello",
            run_config: { model_name: "claude-sonnet-4-6", max_cost_usd: 0, max_tool_rounds: 0 },
          },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.spec.executionConfig.modelName).toBe("claude-sonnet-4-6");
      // Proto zero values: unset numerics read back as 0, but nothing was
      // deliberately written — the guards must not have set them from a
      // zero "no override" input.
      expect(execution.spec.executionConfig.maxCostUsd).toBe(0);
      expect(execution.spec.executionConfig.maxToolRounds).toBe(0);
    });
  });

  describe("workspace entries and workflow provenance (#358 Phase 2)", () => {
    it("maps git workspace entries onto the created session's spec", async () => {
      await expect(
        callAgentAction(
          {
            agent: "my-agent",
            message: "Hello",
            workspace_entries: [
              { name: "app", source: { git_repo: { url: "https://github.com/acme/app", branch: "main" } } },
              { source: { git_repo: { url: "https://github.com/acme/lib" } } },
            ],
          },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const session = mockCreateSession.mock.calls[0][0];
      const entries = session.spec.workspaceEntries;
      expect(entries).toHaveLength(2);
      expect(entries[0].name).toBe("app");
      expect(entries[0].source.source.case).toBe("gitRepo");
      expect(entries[0].source.source.value.url).toBe("https://github.com/acme/app");
      expect(entries[0].source.source.value.branch).toBe("main");
      expect(entries[1].source.source.value.url).toBe("https://github.com/acme/lib");
    });

    it("creates sessions without workspace entries when none are configured", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const session = mockCreateSession.mock.calls[0][0];
      expect(session.spec.workspaceEntries).toHaveLength(0);
    });

    it("stamps workflow provenance labels the server keys environment resolution on", async () => {
      await expect(
        callAgentAction(
          {
            agent: "my-agent",
            message: "Hello",
            __wfExecId: "wex_prov1",
            __taskName: "triage",
          } as any,
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.metadata.labels["stigmer.ai/workflow-execution-id"]).toBe("wex_prov1");
      expect(execution.metadata.labels["stigmer.ai/workflow-task"]).toBe("triage");
    });

    it("stamps no provenance labels without workflow context", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(Object.keys(execution.metadata.labels ?? {})).toHaveLength(0);
    });
  });

  describe("env secret marking", () => {
    it("preserves the agent-declared secret flag when a task env override supplies the value", async () => {
      // The agent declares API_TOKEN as secret. A task-level env override
      // provides the value — the secret marking must survive (#358: the
      // override used to hardcode isSecret:false, a redaction downgrade).
      mockGetAgentByReference.mockResolvedValue({
        metadata: { id: "agt_test123" },
        status: { defaultInstanceId: "ain_default456" },
        spec: {
          env: {
            API_TOKEN: { isSecret: true },
            REGION: { isSecret: false },
          },
        },
      });

      await expect(
        callAgentAction(
          {
            agent: "my-agent",
            message: "Hello",
            env: { API_TOKEN: "resolved-secret-value", REGION: "us-east-1", EXTRA: "plain" },
          },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      const runtimeEnv = execution.spec.runtimeEnv;
      expect(runtimeEnv.API_TOKEN.value).toBe("resolved-secret-value");
      expect(runtimeEnv.API_TOKEN.isSecret).toBe(true);
      expect(runtimeEnv.REGION.isSecret).toBe(false);
      // Keys the agent never declared stay non-secret.
      expect(runtimeEnv.EXTRA.isSecret).toBe(false);
    });
  });
});
