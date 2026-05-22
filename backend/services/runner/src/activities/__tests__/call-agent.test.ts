import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

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
    createSession: (...args: unknown[]) => mockCreateSession(...args),
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

    it("uses config.org over __stigmer_org_id when both are present", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello", org: "explicit-org" },
          { __stigmer_org_id: "fallback-org" },
          "wfl_parent789",
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const ref = mockGetAgentByReference.mock.calls[0][0];
      expect(ref.org).toBe("explicit-org");
      expect(ref.slug).toBe("my-agent");
      expect(ref.kind).toBe(ApiResourceKind.agent);
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

    it("falls back to __stigmer_org_id from runtime env", async () => {
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
});
