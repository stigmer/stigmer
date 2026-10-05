/**
 * The CallAgent activity (`activities/call-agent.ts`), the workflow
 * `agent_call` step's half that starts the agent's turn. Pinned here, with
 * the control-plane client mocked at the module seam:
 *   - the task's agent string becomes an agent reference (bare slug in the
 *     workflow's organization, "org/slug" in that one), and the child is
 *     always created in the organization the workflow runs in;
 *   - the session is applied on the RESOLVED agent's own reference (its
 *     organization and slug, no version: the server pins the current one),
 *     never on a stand-in, so a step naming an agent cannot silently run
 *     the built-in assistant (stigmer#1770); a resolved row missing its id,
 *     organization or slug is refused before anything is written, since an
 *     empty reference would name that assistant;
 *   - the turn is created in that session and linked to the workflow run by
 *     `parent` (execution id, the workflow to signal, the task token); the
 *     task's execution id wins over the environment's unless it is empty,
 *     and the turn is refused before anything is written when neither has
 *     one;
 *   - the step's run_config becomes the child's request (`spec.run_config`)
 *     field for field, unset staying unset, with the output schema at the
 *     spec's top level and no approval mode (the server's fact of the
 *     lane);
 *   - workspace entries, provenance labels and env forwarding map onto the
 *     request as the module header describes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApprovalMode, ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

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

vi.mock("../../shared/heartbeat.js", () => ({
  startHeartbeat: () => ({ stop: vi.fn() }),
}));

import { callAgentAction } from "../call-agent.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";

// The runner's injected Config, as the factory passes it (the mocked client
// constructor above is what its refs resolve to).
const appConfig = testConfig({ stigmerTokenRef: { current: "test-token" } });

/** The workflow execution every step below runs in, unless a test says otherwise. */
const WEX = "wex_test1";

/** The AgentExecution the activity handed the control plane's create. */
function createdExecution(): AgentExecution {
  return mockCreateAgentExecution.mock.calls[0][0] as AgentExecution;
}

/** The agent every reference resolves to: its own organization (an id) and slug. */
const RESOLVED_AGENT = { metadata: { id: "agt_test123", org: "org_agents", slug: "my-agent" } };

describe("callAgentAction", () => {
  beforeEach(() => {
    mockGetAgentByReference = vi.fn().mockResolvedValue(RESOLVED_AGENT);
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
          { __stigmer_org_id: "tt-demo", __stigmer_execution_id: WEX },
          "wfl_parent123",
          appConfig,
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
          { __stigmer_org_id: "default-org", __stigmer_execution_id: WEX },
          "wfl_parent456",
          appConfig,
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
          { __stigmer_org_id: "workflow-org", __stigmer_execution_id: WEX },
          "wfl_parent789",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const ref = mockGetAgentByReference.mock.calls[0][0];
      expect(ref.org).toBe("explicit-org");
      expect(ref.slug).toBe("my-agent");
      expect(ref.kind).toBe(ApiResourceKind.agent);

      // The execution itself is still created in the organization the
      // workflow execution runs in — the cross-org reference changes agent
      // lookup, never the billing organization.
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
          appConfig,
        ),
      ).rejects.toThrow("call:agent requires an organization context");
    });

    it("uses __stigmer_org_id from runtime env", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "env-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const ref = mockGetAgentByReference.mock.calls[0][0];
      expect(ref.org).toBe("env-org");
    });
  });

  describe("agent resolution failure", () => {
    it("throws when resolved agent has no metadata.id", async () => {
      mockGetAgentByReference.mockResolvedValue({ metadata: {} });

      await expect(
        callAgentAction(
          { agent: "ghost-agent", message: "Hello" },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("resolved but has no metadata.id");
    });

    // The session names the agent by org and slug, and an empty reference
    // is the built-in assistant: a row missing either never reaches the
    // session apply.
    it.each([
      ["slug", { id: "agt_test123", org: "org_agents", slug: "" }, "has no metadata.slug"],
      ["org", { id: "agt_test123", org: "", slug: "my-agent" }, "has no metadata.org"],
    ])("throws when resolved agent has no metadata.%s", async (_field, metadata, message) => {
      mockGetAgentByReference.mockResolvedValue({ metadata });

      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow(message);

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockCreateAgentExecution).not.toHaveBeenCalled();
    });
  });

  describe("post-resolution validation", () => {
    it("throws when agent field resolves to empty string", async () => {
      await expect(
        callAgentAction(
          { agent: "", message: "Hello" },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("'agent' resolved to empty");
    });

    it("throws when message field resolves to empty string", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "" },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("'message' resolved to empty");
    });
  });

  describe("downstream calls", () => {
    it("creates session with correct envelope, metadata, and spec", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello", harness: "CURSOR" },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      expect(mockCreateSession).toHaveBeenCalledOnce();
      const session = mockCreateSession.mock.calls[0][0];
      expect(session.apiVersion).toBe("agentic.stigmer.ai/v1");
      expect(session.kind).toBe("Session");
      expect(session.metadata.org).toBe("test-org");
      expect(session.metadata.name).toMatch(/^wf-my-agent-\d+$/);
      expect(session.spec.agentRef).toMatchObject({
        kind: ApiResourceKind.agent,
        org: "org_agents",
        slug: "my-agent",
        version: "",
      });
    });

    it.each<[string, Record<string, unknown>, Harness]>([
      ["the engine the step names", { harness: "CURSOR" }, Harness.CURSOR],
      ["native when the step names a model but no engine", { run_config: { model_name: "claude-haiku-4.5" } }, Harness.NATIVE],
      ["no engine when the step names neither, so the agent's own engine applies", {}, Harness.UNSPECIFIED],
    ])("starts the step's conversation on %s", async (_, step, harness) => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello", ...step },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");
      expect(mockCreateSession.mock.calls[0][0].spec.harness).toBe(harness);
    });

    it("names the agent the reference resolved to, in its own organization, never the reference's spelling", async () => {
      mockGetAgentByReference.mockResolvedValue({
        metadata: { id: "agt_shared", org: "org_acme_id", slug: "reviewer" },
      });

      await expect(
        callAgentAction(
          { agent: "acme/reviewer", message: "Hello" },
          { __stigmer_org_id: "workflow-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const session = mockCreateSession.mock.calls[0][0];
      expect(session.metadata.org).toBe("workflow-org");
      expect(session.spec.agentRef).toMatchObject({ org: "org_acme_id", slug: "reviewer", version: "" });
    });

    it("applies the session on the agent even when the agent has no other record of how to run (stigmer#1770)", async () => {
      // An agent row carrying nothing but its identity: the step still
      // starts a conversation on that agent, never the built-in assistant.
      mockGetAgentByReference.mockResolvedValue({ metadata: { id: "agt_bare", org: "org_agents", slug: "bare" } });

      await expect(
        callAgentAction(
          { agent: "bare", message: "Hello" },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const session = mockCreateSession.mock.calls[0][0];
      expect(session.spec.agentRef?.slug).toBe("bare");
      expect(session.spec.agentRef?.kind).toBe(ApiResourceKind.agent);
    });

    it("creates session with 'Auto-created session' sentinel subject", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
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
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent_id",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      expect(mockCreateAgentExecution).toHaveBeenCalledOnce();
      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.apiVersion).toBe("agentic.stigmer.ai/v1");
      expect(execution.kind).toBe("AgentExecution");
      expect(execution.metadata.org).toBe("test-org");
      expect(execution.metadata.name).toMatch(/^aex-wf-my-agent-\d+$/);
      expect(execution.spec.target).toEqual({ case: "sessionId", value: "ses_test789" });
      expect(execution.spec.message).toBe("Review this");
      expect(execution.spec.parent?.workflowExecutionId).toBe(WEX);
      expect(execution.spec.parent?.signalWorkflowId).toBe("wfl_parent_id");
      expect(execution.spec.parent?.callbackToken).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("links the turn by the task's workflow execution id over the environment's", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello", __wfExecId: "wex_from_task", __taskName: "triage" } as never,
          { __stigmer_org_id: "test-org", __stigmer_execution_id: "wex_from_env" },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.spec.parent?.workflowExecutionId).toBe("wex_from_task");
    });

    it("links the turn by the environment's execution id when the task's is empty", async () => {
      // An empty id is no id: it falls back rather than linking the turn to "".
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello", __wfExecId: "", __taskName: "triage" } as never,
          { __stigmer_org_id: "test-org", __stigmer_execution_id: "wex_from_env" },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.spec.parent?.workflowExecutionId).toBe("wex_from_env");
    });

    it("refuses without a workflow execution id, before any session or turn is written", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "test-org" },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("has no workflow execution id");

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockCreateAgentExecution).not.toHaveBeenCalled();
    });
  });

  describe("run_config → the child turn's request (spec.run_config)", () => {
    it("carries all six settings onto spec.runConfig, the output schema at the spec's top level, and no approval mode", async () => {
      const schema = { type: "object", required: ["verdict"], properties: { verdict: { type: "string" } } };
      await expect(
        callAgentAction(
          {
            agent: "my-agent",
            message: "Hello",
            run_config: {
              model_name: "claude-sonnet-4-6",
              max_cost_usd: 0.75,
              max_tool_rounds: 15,
              max_tool_result_chars: 12_000,
              service_tier: "SERVICE_TIER_FAST",
              thinking_mode: "THINKING_MODE_ENABLED",
            },
            output: { schema },
          },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = createdExecution();
      const runConfig = execution.spec?.runConfig;
      expect(runConfig).toBeDefined();
      expect(runConfig?.modelName).toBe("claude-sonnet-4-6");
      expect(runConfig?.maxCostUsd).toBe(0.75);
      expect(runConfig?.maxToolRounds).toBe(15);
      expect(runConfig?.maxToolResultChars).toBe(12_000);
      expect(runConfig?.serviceTier).toBe(ServiceTier.FAST);
      expect(runConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);
      expect(execution.spec?.structuredOutputSchema).toEqual(schema);
      // The approval mode is the server's fact of the lane: the request
      // carries none, and the runner never stamps the status it does not own.
      expect(execution.status?.approvalMode ?? ApprovalMode.UNSPECIFIED).toBe(ApprovalMode.UNSPECIFIED);
      expect(execution.status?.runConfig).toBeUndefined();
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
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow(
        "call:agent run_config.service_tier 'SERVICE_TIER_TURBO' has no proto mapping",
      );
    });

    it("fails loudly on a thinking_mode value with no proto mapping", async () => {
      await expect(
        callAgentAction(
          {
            agent: "my-agent",
            message: "Hello",
            run_config: { thinking_mode: "THINKING_MODE_MAX" },
          },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow(
        "call:agent run_config.thinking_mode 'THINKING_MODE_MAX' has no proto mapping",
      );
    });

    it("leaves spec.runConfig and the output schema unset when the step has neither", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = createdExecution();
      expect(execution.spec?.runConfig).toBeUndefined();
      expect(execution.spec?.structuredOutputSchema).toBeUndefined();
    });

    it("carries an unset setting as unset, never inventing a value", async () => {
      await expect(
        callAgentAction(
          {
            agent: "my-agent",
            message: "Hello",
            run_config: { model_name: "claude-sonnet-4-6", max_cost_usd: 0 },
          },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const runConfig = createdExecution().spec?.runConfig;
      expect(runConfig?.modelName).toBe("claude-sonnet-4-6");
      // Zero and UNSPECIFIED are "not set at this layer": the server's
      // resolution fills them from the agent's defaults, not this activity.
      expect(runConfig?.maxCostUsd).toBe(0);
      expect(runConfig?.maxToolRounds).toBe(0);
      expect(runConfig?.maxToolResultChars).toBe(0);
      expect(runConfig?.serviceTier).toBe(ServiceTier.UNSPECIFIED);
      expect(runConfig?.thinkingMode).toBe(ThinkingMode.UNSPECIFIED);
    });
  });

  describe("workspace entries and workflow provenance (#358)", () => {
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
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
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
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
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
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
        ),
      ).rejects.toThrow("CompleteAsyncError");

      const execution = mockCreateAgentExecution.mock.calls[0][0];
      expect(execution.metadata.labels["stigmer.ai/workflow-execution-id"]).toBe("wex_prov1");
      expect(execution.metadata.labels["stigmer.ai/workflow-task"]).toBe("triage");
    });

    it("stamps no provenance labels without the task's name", async () => {
      await expect(
        callAgentAction(
          { agent: "my-agent", message: "Hello" },
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
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
        ...RESOLVED_AGENT,
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
          { __stigmer_org_id: "test-org", __stigmer_execution_id: WEX },
          "wfl_parent",
          appConfig,
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
