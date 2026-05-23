import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ConnectError, Code } from "@connectrpc/connect";
import {
  assertCreateRequirements,
  assertReferenceRequirements,
} from "../../client/server-contracts.js";

/**
 * Contract compliance tests for the CallAgent activity.
 *
 * Unlike call-agent.test.ts (which verifies behavior with mocked client),
 * these tests verify that the proto messages CONSTRUCTED by callAgentAction
 * satisfy the server's pipeline requirements. This catches the exact class
 * of bug where mocked tests pass but real gRPC calls fail because the
 * server enforces business rules not expressed in the proto schema.
 */

let capturedGetByRef: any;
let capturedCreateSession: any;
let capturedCreateExecution: any;
let allCapturedExecutions: any[];
let mockCreateSessionImpl: (session: any) => Promise<any>;
let mockCreateExecutionImpl: (exec: any) => Promise<any>;
let mockAgentEnv: Record<string, any>;

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      info: {
        taskToken: new Uint8Array([1, 2, 3, 4]),
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
    getAgentByReference: (ref: any) => {
      capturedGetByRef = ref;
      return Promise.resolve({
        metadata: { id: "agt_contract_test" },
        status: { defaultInstanceId: "ain_contract_test" },
        spec: { env: mockAgentEnv },
      });
    },
    createSession: (session: any) => {
      capturedCreateSession = session;
      return mockCreateSessionImpl(session);
    },
    createAgentExecution: (exec: any) => {
      capturedCreateExecution = exec;
      allCapturedExecutions.push(exec);
      return mockCreateExecutionImpl(exec);
    },
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

describe("CallAgent server contract compliance", () => {
  beforeEach(() => {
    capturedGetByRef = undefined;
    capturedCreateSession = undefined;
    capturedCreateExecution = undefined;
    allCapturedExecutions = [];
    mockAgentEnv = {};
    mockCreateSessionImpl = (session: any) =>
      Promise.resolve({ metadata: { id: "ses_contract_test" } });
    mockCreateExecutionImpl = (exec: any) =>
      Promise.resolve({ metadata: { id: "aex_contract_test" } });
  });

  async function exerciseCallAgent(config = {}, env: Record<string, unknown> = {}) {
    try {
      await callAgentAction(
        { agent: "notification-analyst", message: "Analyze cohort data", ...config },
        { __stigmer_org_id: "tt-demo", ...env },
        "wfl_parent_123",
      );
    } catch (e: any) {
      if (e.name !== "CompleteAsyncError") throw e;
    }
  }

  describe("ApiResourceReference (getAgentByReference)", () => {
    it("satisfies reference requirements for simple slug", async () => {
      await exerciseCallAgent();
      expect(() => assertReferenceRequirements(capturedGetByRef, "Agent", "test"))
        .not.toThrow();
    });

    it("sets slug from agent config", async () => {
      await exerciseCallAgent();
      expect(capturedGetByRef.slug).toBe("notification-analyst");
      expect(capturedGetByRef.org).toBe("tt-demo");
      expect(capturedGetByRef.kind).toBe(ApiResourceKind.agent);
    });

    it("satisfies reference requirements for org-prefixed slug", async () => {
      await exerciseCallAgent({ agent: "acme/code-reviewer" });
      expect(() => assertReferenceRequirements(capturedGetByRef, "Agent", "test"))
        .not.toThrow();
      expect(capturedGetByRef.org).toBe("acme");
      expect(capturedGetByRef.slug).toBe("code-reviewer");
    });
  });

  describe("Session create payload", () => {
    it("satisfies server create requirements", async () => {
      await exerciseCallAgent();
      expect(() => assertCreateRequirements(capturedCreateSession, "Session", "test"))
        .not.toThrow();
    });

    it("has metadata.name matching expected pattern", async () => {
      await exerciseCallAgent();
      expect(capturedCreateSession.metadata.name).toMatch(/^wf-notification-analyst-\d+$/);
    });

    it("has metadata.org from runtime environment", async () => {
      await exerciseCallAgent();
      expect(capturedCreateSession.metadata.org).toBe("tt-demo");
    });
  });

  describe("AgentExecution create payload", () => {
    it("satisfies server create requirements", async () => {
      await exerciseCallAgent();
      expect(() => assertCreateRequirements(capturedCreateExecution, "AgentExecution", "test"))
        .not.toThrow();
    });

    it("has metadata.name matching expected pattern", async () => {
      await exerciseCallAgent();
      expect(capturedCreateExecution.metadata.name).toMatch(/^aex-wf-notification-analyst-\d+$/);
    });

    it("has metadata.org set", async () => {
      await exerciseCallAgent();
      expect(capturedCreateExecution.metadata.org).toBe("tt-demo");
    });

    it("has required spec fields for server pipeline", async () => {
      await exerciseCallAgent();
      expect(capturedCreateExecution.spec.sessionId).toBe("ses_contract_test");
      expect(capturedCreateExecution.spec.agentId).toBe("agt_contract_test");
      expect(capturedCreateExecution.spec.message).toBe("Analyze cohort data");
      expect(capturedCreateExecution.spec.callbackToken).toBeDefined();
      expect(capturedCreateExecution.spec.parentWorkflowId).toBe("wfl_parent_123");
    });

    it("would have been rejected by server without the name fix", async () => {
      await exerciseCallAgent();
      const withoutName = {
        ...capturedCreateExecution,
        metadata: { org: capturedCreateExecution.metadata.org },
      };
      expect(() => assertCreateRequirements(withoutName, "AgentExecution", "test"))
        .toThrow(/metadata.name or metadata.slug/);
    });
  });

  describe("runtime env forwarding (workflow → child agent)", () => {
    it("populates runtimeEnv when agent declares matching env vars", async () => {
      mockAgentEnv = {
        POSTGRES_CONNECTION_URL: { isSecret: true, description: "DB URL" },
      };
      await exerciseCallAgent({}, {
        POSTGRES_CONNECTION_URL: "postgresql://user:pass@host:5432/db",
      });
      const runtimeEnv = capturedCreateExecution.spec.runtimeEnv;
      expect(runtimeEnv).toBeDefined();
      expect(runtimeEnv["POSTGRES_CONNECTION_URL"]).toBeDefined();
      expect(runtimeEnv["POSTGRES_CONNECTION_URL"].value).toBe(
        "postgresql://user:pass@host:5432/db",
      );
    });

    it("marks secret vars with isSecret from agent env declarations", async () => {
      mockAgentEnv = {
        SECRET_KEY: { isSecret: true },
        PLAIN_FLAG: { isSecret: false },
      };
      await exerciseCallAgent({}, {
        SECRET_KEY: "s3cret",
        PLAIN_FLAG: "true",
      });
      const runtimeEnv = capturedCreateExecution.spec.runtimeEnv;
      expect(runtimeEnv["SECRET_KEY"].isSecret).toBe(true);
      expect(runtimeEnv["PLAIN_FLAG"].isSecret).toBe(false);
    });

    it("does not forward workflow env vars not declared by agent", async () => {
      mockAgentEnv = {
        DECLARED_VAR: { isSecret: false },
      };
      await exerciseCallAgent({}, {
        DECLARED_VAR: "included",
        UNDECLARED_VAR: "excluded",
      });
      const runtimeEnv = capturedCreateExecution.spec.runtimeEnv;
      expect(runtimeEnv["DECLARED_VAR"]).toBeDefined();
      expect(runtimeEnv["UNDECLARED_VAR"]).toBeUndefined();
    });

    it("task-config env takes precedence over auto-forwarded values", async () => {
      mockAgentEnv = {
        DB_URL: { isSecret: true },
      };
      await exerciseCallAgent(
        { env: { DB_URL: "task-override-url" } },
        { DB_URL: "workflow-url" },
      );
      const runtimeEnv = capturedCreateExecution.spec.runtimeEnv;
      expect(runtimeEnv["DB_URL"].value).toBe("task-override-url");
    });

    it("sends empty runtimeEnv when agent has no env declarations", async () => {
      mockAgentEnv = {};
      await exerciseCallAgent({}, { SOME_VAR: "value" });
      const runtimeEnv = capturedCreateExecution.spec.runtimeEnv;
      expect(Object.keys(runtimeEnv)).toHaveLength(0);
    });
  });

  describe("ALREADY_EXISTS idempotent recovery", () => {
    it("reuses existing session when ALREADY_EXISTS returns resource ID", async () => {
      mockCreateSessionImpl = () => {
        throw new ConnectError(
          "Session with slug 'ses-wf-xxx' already exists in org 'tt-demo' (id: ses_recovered_123)",
          Code.AlreadyExists,
        );
      };
      await exerciseCallAgent();
      expect(capturedCreateExecution.spec.sessionId).toBe("ses_recovered_123");
    });

    it("creates retry execution when ALREADY_EXISTS on agent execution", async () => {
      let callCount = 0;
      mockCreateExecutionImpl = (exec: any) => {
        callCount++;
        if (callCount === 1) {
          throw new ConnectError(
            "AgentExecution with slug 'aex-wf-xxx' already exists (id: aex_old)",
            Code.AlreadyExists,
          );
        }
        return Promise.resolve({ metadata: { id: "aex_retry" } });
      };

      await exerciseCallAgent();
      expect(allCapturedExecutions).toHaveLength(2);
      const retryExec = allCapturedExecutions[1];
      expect(retryExec.metadata.name).toMatch(/-r\d+$/);
      expect(retryExec.spec.sessionId).toBe("ses_contract_test");
    });

    it("throws when session ALREADY_EXISTS but ID cannot be extracted", async () => {
      mockCreateSessionImpl = () => {
        throw new ConnectError(
          "duplicate resource",
          Code.AlreadyExists,
        );
      };
      await expect(
        callAgentAction(
          { agent: "notification-analyst", message: "test" },
          { __stigmer_org_id: "tt-demo" },
          "wfl_parent",
        ),
      ).rejects.toThrow(/ID could not be resolved/);
    });
  });
});
