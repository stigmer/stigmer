import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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
let capturedApplySession: any;
let capturedCreateExecution: any;
let allCapturedExecutions: any[];
let mockApplySessionImpl: (session: any) => Promise<any>;
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
    applySession: (session: any) => {
      capturedApplySession = session;
      return mockApplySessionImpl(session);
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
    capturedApplySession = undefined;
    capturedCreateExecution = undefined;
    allCapturedExecutions = [];
    mockAgentEnv = {};
    mockApplySessionImpl = (session: any) =>
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

  describe("Session apply payload", () => {
    it("satisfies server create requirements", async () => {
      await exerciseCallAgent();
      expect(() => assertCreateRequirements(capturedApplySession, "Session", "test"))
        .not.toThrow();
    });

    it("has metadata.name matching expected pattern", async () => {
      await exerciseCallAgent();
      expect(capturedApplySession.metadata.name).toMatch(/^wf-notification-analyst-\d+$/);
    });

    it("has metadata.org from runtime environment", async () => {
      await exerciseCallAgent();
      expect(capturedApplySession.metadata.org).toBe("tt-demo");
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

  describe("session idempotency via apply", () => {
    it("uses apply for session creation (idempotent get-or-create)", async () => {
      await exerciseCallAgent();
      expect(capturedApplySession).toBeDefined();
      expect(capturedApplySession.metadata.org).toBe("tt-demo");
    });

    it("uses session ID returned by apply for agent execution", async () => {
      mockApplySessionImpl = () =>
        Promise.resolve({ metadata: { id: "ses_from_apply" } });
      await exerciseCallAgent();
      expect(capturedCreateExecution.spec.sessionId).toBe("ses_from_apply");
    });

    it("succeeds on recovery when session already exists (apply returns existing)", async () => {
      mockApplySessionImpl = () =>
        Promise.resolve({ metadata: { id: "ses_existing_789" } });
      await exerciseCallAgent(
        {},
        { __stigmer_execution_id: "wex_recovery_test", __stigmer_org_id: "tt-demo" },
      );
      expect(capturedCreateExecution).toBeDefined();
      expect(capturedCreateExecution.spec.sessionId).toBe("ses_existing_789");
    });
  });

  describe("workflow-context naming (deterministic sessions, unique executions)", () => {
    const wfContextConfig = { __taskName: "analyze_player_data" } as any;
    const wfContextEnv = {
      __stigmer_execution_id: "wex_01abc",
      __stigmer_org_id: "tt-demo",
    };

    it("uses deterministic session name from workflow execution ID and task name", async () => {
      await exerciseCallAgent(wfContextConfig, wfContextEnv);
      expect(capturedApplySession.metadata.name).toBe("ses-wf-wex_01abc-analyze_player_data");
    });

    it("uses workflow-context execution name with unique suffix", async () => {
      await exerciseCallAgent(wfContextConfig, wfContextEnv);
      expect(capturedCreateExecution.metadata.name).toMatch(
        /^aex-wf-wex_01abc-analyze_player_data-[0-9a-f]{8}$/,
      );
    });

    it("generates unique execution names across invocations", async () => {
      await exerciseCallAgent(wfContextConfig, wfContextEnv);
      const firstName = allCapturedExecutions[0].metadata.name;

      await exerciseCallAgent(wfContextConfig, wfContextEnv);
      const secondName = allCapturedExecutions[1].metadata.name;

      expect(firstName).not.toBe(secondName);
      expect(firstName).toMatch(/^aex-wf-wex_01abc-analyze_player_data-/);
      expect(secondName).toMatch(/^aex-wf-wex_01abc-analyze_player_data-/);
    });

    it("keeps session name identical across invocations for apply reuse", async () => {
      const sessionNames: string[] = [];
      mockApplySessionImpl = (session: any) => {
        sessionNames.push(session.metadata.name);
        return Promise.resolve({ metadata: { id: "ses_contract_test" } });
      };

      await exerciseCallAgent(wfContextConfig, wfContextEnv);
      await exerciseCallAgent(wfContextConfig, wfContextEnv);

      expect(sessionNames[0]).toBe(sessionNames[1]);
      expect(sessionNames[0]).toBe("ses-wf-wex_01abc-analyze_player_data");
    });

    it("handles long task names without truncation", async () => {
      await exerciseCallAgent({
        __taskName: "design_notification_campaigns",
      } as any, {
        __stigmer_execution_id: "wex_01kscvbb59yc4kjfqce4en8t6e",
        __stigmer_org_id: "tt-demo",
      });
      expect(capturedCreateExecution.metadata.name).toMatch(
        /^aex-wf-wex_01kscvbb59yc4kjfqce4en8t6e-design_notification_campaigns-[0-9a-f]{8}$/,
      );
    });

    it("prefers __wfExecId from config over runtimeEnv.__stigmer_execution_id", async () => {
      await exerciseCallAgent({
        __taskName: "analyze_player_data",
        __wfExecId: "wex_from_config",
      } as any, {
        __stigmer_execution_id: "wex_from_env",
        __stigmer_org_id: "tt-demo",
      });
      expect(capturedCreateExecution.metadata.name).toMatch(
        /^aex-wf-wex_from_config-analyze_player_data-[0-9a-f]{8}$/,
      );
      expect(capturedApplySession.metadata.name).toBe("ses-wf-wex_from_config-analyze_player_data");
    });

    it("uses __wfExecId from config when runtimeEnv lacks __stigmer_execution_id", async () => {
      await exerciseCallAgent({
        __taskName: "analyze_player_data",
        __wfExecId: "wex_config_only",
      } as any, {
        __stigmer_org_id: "tt-demo",
      });
      expect(capturedCreateExecution.metadata.name).toMatch(
        /^aex-wf-wex_config_only-analyze_player_data-[0-9a-f]{8}$/,
      );
    });
  });

  describe("agent execution uniqueness (no ALREADY_EXISTS retry)", () => {
    it("does not retry on create — each invocation uses a unique name", async () => {
      await exerciseCallAgent();
      expect(allCapturedExecutions).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Output schema propagation — verifies that output.schema from the
  // workflow task config is set as executionConfig.structuredOutputSchema
  // on the created AgentExecution. This is the exact failure mode from
  // the daily-notification-plan production bug.
  // -----------------------------------------------------------------------

  describe("output.schema → executionConfig.structuredOutputSchema propagation", () => {
    const cohortSchema = {
      type: "object",
      required: ["executive_summary", "cohorts", "anomalies"],
      properties: {
        executive_summary: { type: "string" },
        dau: { type: "number" },
        cohorts: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "size", "action_needed"],
            properties: {
              name: { type: "string" },
              size: { type: "number" },
              action_needed: { type: "boolean" },
            },
          },
        },
        anomalies: {
          type: "array",
          items: {
            type: "object",
            properties: {
              metric: { type: "string" },
              severity: { type: "string", enum: ["warning", "critical"] },
            },
          },
        },
        data_quality_notes: { type: "string" },
      },
    };

    it("sets structuredOutputSchema when output.schema is present", async () => {
      await exerciseCallAgent({
        output: { schema: cohortSchema, on_invalid: "ON_INVALID_FAIL" },
        run_config: { model_name: "claude-sonnet-4" },
      });
      const execConfig = capturedCreateExecution.spec.executionConfig;
      expect(execConfig).toBeDefined();
      expect(execConfig.structuredOutputSchema).toBeDefined();
      expect(execConfig.structuredOutputSchema.required).toEqual(
        ["executive_summary", "cohorts", "anomalies"],
      );
      expect(execConfig.structuredOutputSchema.properties.cohorts.type).toBe("array");
    });

    it("sets both modelName and structuredOutputSchema when both are present", async () => {
      await exerciseCallAgent({
        output: { schema: cohortSchema },
        run_config: { model_name: "claude-sonnet-4" },
      });
      const execConfig = capturedCreateExecution.spec.executionConfig;
      expect(execConfig.modelName).toBe("claude-sonnet-4");
      expect(execConfig.structuredOutputSchema).toBeDefined();
      expect(execConfig.structuredOutputSchema.required).toContain("executive_summary");
    });

    it("preserves nested array/object schema structure through serialization", async () => {
      await exerciseCallAgent({
        output: { schema: cohortSchema },
      });
      const schema = capturedCreateExecution.spec.executionConfig.structuredOutputSchema;
      expect(schema.properties.cohorts.items.required).toEqual(["name", "size", "action_needed"]);
      expect(schema.properties.anomalies.items.properties.severity.enum)
        .toEqual(["warning", "critical"]);
    });

    it("does not set structuredOutputSchema when output is absent", async () => {
      await exerciseCallAgent({ run_config: { model_name: "claude-sonnet-4" } });
      const execConfig = capturedCreateExecution.spec.executionConfig;
      expect(execConfig).toBeDefined();
      expect(execConfig.modelName).toBe("claude-sonnet-4");
      expect(execConfig.structuredOutputSchema).toBeUndefined();
    });

    it("does not set executionConfig at all when neither model nor schema is present", async () => {
      await exerciseCallAgent({});
      expect(capturedCreateExecution.spec.executionConfig).toBeUndefined();
    });

    it("sets structuredOutputSchema even when model is absent", async () => {
      await exerciseCallAgent({
        output: { schema: { type: "object", properties: { summary: { type: "string" } } } },
      });
      const execConfig = capturedCreateExecution.spec.executionConfig;
      expect(execConfig).toBeDefined();
      expect(execConfig.structuredOutputSchema).toBeDefined();
      expect(execConfig.structuredOutputSchema.properties.summary.type).toBe("string");
    });

    it("daily-notification-plan pattern: full schema with embedded expressions in message", async () => {
      await exerciseCallAgent(
        {
          output: { schema: cohortSchema, on_invalid: "ON_INVALID_FAIL" },
          run_config: { model_name: "claude-sonnet-4" },
          harness: "HARNESS_CURSOR",
          __taskName: "analyze_player_data",
        } as any,
        {
          __stigmer_execution_id: "wex_01test",
          __stigmer_org_id: "tt-demo",
        },
      );

      const exec = capturedCreateExecution;
      expect(exec.spec.executionConfig).toBeDefined();
      expect(exec.spec.executionConfig.modelName).toBe("claude-sonnet-4");
      expect(exec.spec.executionConfig.structuredOutputSchema).toBeDefined();
      expect(exec.spec.executionConfig.structuredOutputSchema.required)
        .toEqual(["executive_summary", "cohorts", "anomalies"]);
      expect(exec.metadata.name).toMatch(
        /^aex-wf-wex_01test-analyze_player_data-[0-9a-f]{8}$/,
      );
    });
  });
});
