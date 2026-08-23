// Conformance suite for AgentExecution create-time validation (CRUD-level).
// Domain: agentic / agentexecution — the request-shape contract that fires
// before any resource resolution, engine contact, or side effect.
//
// This file exists separately from the execution-engine suite
// (suites-execution/agentexecution.conformance.test.ts) because of how the
// suites are targeted: src/suites/** runs against every edition — including
// `npm run test:cloud` — while suites-execution/** needs a provisioned engine
// (Temporal + runner + mock LLM) and only runs against the local Go execution
// target. Validation is step 1 of both editions' create pipelines, so these
// rejections are provable on any target with fake IDs and no engine — and
// keeping them here is what makes the cloud (Java) edition's protovalidate
// enforcement a gated contract rather than an assumption.
//
// Positive bootstrap behavior (spec forwarding, resolution precedence,
// single-source-of-truth clearing) needs a live engine and stays in the
// execution suite.
import { Code } from "@connectrpc/connect";
import {
  FileDecisionAction,
  FileDecisionScope,
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { makeAgentExecution } from "../support/agentexecutions";
import { collectStream } from "../support/collect-stream";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterAll(async () => {
  await target?.teardown();
});

describe("AgentExecution conformance — one-call session bootstrap validation (session_spec)", () => {
  it("rejects session_id and session_spec together (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // Validation fires before any resource resolution, so fake ids suffice.
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-bootstrap-exclusive"),
            sessionId: "ses_existing",
            sessionSpec: { agentInstanceId: "ain_1" },
          }),
        ),
      Code.InvalidArgument,
      "create with both session_id and session_spec",
    );
  });

  it("rejects a session_spec carrying harness_state_id (InvalidArgument — server-owned field)", async () => {
    const { org } = await target.provisionTenancy();
    // harness_state_id is engine-owned conversation continuity state; a
    // caller-supplied value would fake state on a brand-new session and trip
    // the immutability sentinel.
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-bootstrap-hstate"),
            sessionSpec: { agentInstanceId: "ain_1", harnessStateId: "thread-forged" },
          }),
        ),
      Code.InvalidArgument,
      "create with a session_spec carrying harness_state_id",
    );
  });
});

describe("AgentExecution conformance — service-tier fail-closed validation (#357)", () => {
  // The tier exists to make pricing deterministic, so it is validated where
  // the price is decided — at create, against the model registry — with
  // identical rules and messages in both editions (OSS Go
  // validateServiceTierStep, cloud Java ValidateServiceTierStep). Both
  // refusals fire before any resource resolution, so fake ids suffice.

  it("rejects fast without a pinned model (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-tier-no-model"),
            agentId: "agt_fake",
            executionConfig: { serviceTier: ServiceTier.FAST },
          }),
        ),
      Code.InvalidArgument,
      "create with service_tier fast and no model_name",
    );
  });

  it("rejects fast on a model with no registry fast variant (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // claude-haiku-4-5 is registered but prices no fast variant — selecting
    // a tier billing cannot price would trip the undercharge guard, so
    // selection and billability are coupled by refusing here.
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-tier-unpriced"),
            agentId: "agt_fake",
            executionConfig: {
              modelName: "claude-haiku-4-5",
              serviceTier: ServiceTier.FAST,
            },
          }),
        ),
      Code.InvalidArgument,
      "create with service_tier fast on a model without a fast variant",
    );
  });
});

describe("AgentExecution conformance — thinking-mode fail-closed validation (#772)", () => {
  // The tier suite's twin: thinking is capability-gated (it bills at base
  // per-token rates, so no priced variant exists to key on) and validated
  // at create with identical rules and messages in both editions (OSS Go
  // validateThinkingModeStep, cloud Java ValidateThinkingModeStep). Both
  // refusals fire before any resource resolution, so fake ids suffice.

  it("rejects enabled without a pinned model (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-thinking-no-model"),
            agentId: "agt_fake",
            executionConfig: { thinkingMode: ThinkingMode.ENABLED },
          }),
        ),
      Code.InvalidArgument,
      "create with thinking_mode enabled and no model_name",
    );
  });

  it("rejects enabled on a model without the thinking capability (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // composer-2.5's cursor-harness registry entry declares thinking=false —
    // ENABLED there would silently serve the base variant, so it is refused
    // (selection and the served variant stay coupled).
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-thinking-incapable"),
            agentId: "agt_fake",
            executionConfig: {
              modelName: "composer-2.5",
              thinkingMode: ThinkingMode.ENABLED,
            },
          }),
        ),
      Code.InvalidArgument,
      "create with thinking_mode enabled on a model without the capability",
    );
  });
});

// --- CW-7: the engineless read surfaces -------------------------------------
//
// No execution record can exist on this target (create's engine gate below),
// so every read RPC is asserted in its zero-record / validation arm — the
// truthful answers a fresh server owes before anything has ever run. The
// populated arms live in suites-execution/.

describe("AgentExecution conformance — the engine gate (CW-7)", () => {
  it("create refuses Unavailable before any side effect when no engine is connected", async () => {
    const { org } = await target.provisionTenancy();
    // agt_fake passes the reference-presence guard; existence is resolved
    // AFTER the engine gate (default-instance creation), so the refusal
    // proves the gate itself.
    const err = await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({ org, name: uniqueName("aex-gate"), agentId: "agt_fake" }),
        ),
      Code.Unavailable,
      "create with no execution engine behind the server",
    );
    expect(err.rawMessage).toBe(
      "The execution engine is temporarily unavailable. Please try again shortly.",
    );
  });
});

describe("AgentExecution conformance — zero-record read surfaces (CW-7)", () => {
  it("getExecutionSummary answers the pinned zero shape — no cost fields by design", async () => {
    const { org } = await target.provisionTenancy();
    const summary = await clients.agentExecutionQuery.getExecutionSummary({ org });

    expect(summary.activeCount).toBe(0);
    expect(summary.phaseCounts).toEqual({});
    // An average over nothing is absence, not 0; and unlike the workflow
    // summary there are deliberately NO cost fields on this shape at all.
    expect(summary.avgDuration).toBeUndefined();
    expect(summary.topFailingAgents).toHaveLength(0);
  });

  it("the execution-scoped usage report validates and checks existence (the ONE report that 404s)", async () => {
    await expectGrpcCode(
      () => clients.agentExecutionQuery.getExecutionUsageReport({ executionId: "" }),
      Code.InvalidArgument,
      "execution usage report without an id",
    );
    await expectGrpcCode(
      () =>
        clients.agentExecutionQuery.getExecutionUsageReport({
          executionId: "aexec_01conformancemissing",
        }),
      Code.NotFound,
      "execution usage report for an unknown execution",
    );
  });

  it("the session/agent/org usage reports answer zero-valued SHAPES with no existence check", async () => {
    // The zero-shapes contract: these aggregation reads never error for
    // "nothing to aggregate" — they answer structurally complete,
    // zero-valued reports (OSS deliberately records no usage data at all,
    // so on this edition even populated executions aggregate to zero).
    const session = await clients.agentExecutionQuery.getSessionUsageReport({
      sessionId: "ses_01conformancemissing",
    });
    expect(session.sessionId).toBe("ses_01conformancemissing");
    expect(session.executionCount).toBe(0);
    expect(session.totalUsage, "the aggregate is always present, zero-valued").toBeDefined();
    expect(session.executions).toHaveLength(0);
    expect(session.modelBreakdown).toHaveLength(0);
    expect(session.firstExecutionAt).toBe("");
    expect(session.lastExecutionAt).toBe("");

    const agent = await clients.agentExecutionQuery.getAgentUsageReport({
      agentId: "agt_01conformancemissing",
      orgId: "conf-org-missing",
    });
    // The name resolves only when the org has executions; until then the
    // id is echoed — pinned so clients know not to treat it as a name.
    expect(agent.agentName).toBe("agt_01conformancemissing");
    expect(agent.totalUsage).toBeDefined();
    expect(agent.sessions).toHaveLength(0);
    expect(agent.totalSessions).toBe(0);
    expect(agent.totalExecutions).toBe(0);

    const orgReport = await clients.agentExecutionQuery.getOrgUsageReport({
      orgId: "conf-org-missing",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });
    expect(orgReport.orgId).toBe("conf-org-missing");
    expect(orgReport.totalAgents).toBe(0);
    expect(orgReport.totalSessions).toBe(0);
    expect(orgReport.totalExecutions).toBe(0);
    expect(orgReport.modelBreakdown).toHaveLength(0);
    expect(orgReport.topAgentsByCost).toHaveLength(0);
    expect(orgReport.dailyCosts).toHaveLength(0);
  });

  it("the agent/org usage reports refuse missing scope fields (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.agentExecutionQuery.getAgentUsageReport({ agentId: "agt_x" }),
      Code.InvalidArgument,
      "agent usage report without org_id",
    );
    await expectGrpcCode(
      () => clients.agentExecutionQuery.getOrgUsageReport({ orgId: "conf-org" }),
      Code.InvalidArgument,
      "org usage report without the date range",
    );
  });

  it("subscribe refuses an empty id (InvalidArgument) and an unknown id (NotFound)", async () => {
    await expectGrpcCode(
      () =>
        collectStream((signal) => clients.agentExecutionQuery.subscribe({ value: "" }, { signal })),
      Code.InvalidArgument,
      "subscribe with an empty id",
    );
    await expectGrpcCode(
      () =>
        collectStream((signal) =>
          clients.agentExecutionQuery.subscribe({ value: "aexec_01conformancemissing" }, { signal }),
        ),
      Code.NotFound,
      "subscribe to an unknown execution",
    );
  });
});

describe("AgentExecution conformance — submitFileDecision negatives (CW-7)", () => {
  it("rejects structurally invalid inputs before any load (InvalidArgument)", async () => {
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitFileDecision({
          agentExecutionId: "",
          changeSetId: "cs_x",
          expectedDigest: "digest",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
        }),
      Code.InvalidArgument,
      "submitFileDecision without an execution id",
    );
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitFileDecision({
          agentExecutionId: "aexec_x",
          changeSetId: "cs_x",
          expectedDigest: "digest",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.UNSPECIFIED,
        }),
      Code.InvalidArgument,
      "submitFileDecision with an unspecified action",
    );
  });

  it("an unknown execution answers NotFound", async () => {
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitFileDecision({
          agentExecutionId: "aexec_01conformancemissing",
          changeSetId: "cs_x",
          expectedDigest: "digest",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
        }),
      Code.NotFound,
      "submitFileDecision on a nonexistent agent execution",
    );
  });
});
