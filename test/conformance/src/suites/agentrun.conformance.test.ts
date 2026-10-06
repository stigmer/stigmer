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
// Also pinned here, because each refusal comes before the engine gate: a
// turn reaches its conversation's agent through the session's pin, so a
// deleted agent, or another agent later created under its slug, answers
// FAILED_PRECONDITION naming the pinned agent; and a turn's workflow parent
// link must agree with its lineage label, and is admitted from a
// trusted-local caller.
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
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { agentRefOf, makeAgent } from "../support/agents";
import { makeAgentExecution } from "../support/agentruns";
import { makeSession } from "../support/sessions";
import { collectStream } from "../support/collect-stream";
import { uniqueName, uniqueOrg } from "../support/naming";
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
  it("[rpc:AgentExecutionCommandController.create] rejects a session_spec carrying harness_state_id (InvalidArgument — server-owned field)", async () => {
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
            sessionSpec: { harnessStateId: "thread-forged" },
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
  // identical rules and messages in every edition. It judges the settings
  // the turn resolved (the message's, the agent's defaults, the lane's
  // profile), so it runs behind the run gate: each arm creates a real agent,
  // which an enforcing edition would otherwise refuse as PermissionDenied
  // first. Every arm is a refusal, before any side effect.
  async function tierAgent(
    org: string,
    defaults: Pick<Parameters<typeof makeAgent>[0], "harness" | "runConfig"> = {},
  ): Promise<Agent> {
    return clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-tier"), instructions: "You validate service tiers.", ...defaults }),
    );
  }

  async function refusedWith(
    org: string,
    agent: Agent,
    label: string,
    runConfig: Parameters<typeof makeAgentExecution>[0]["runConfig"],
    what: string,
  ): Promise<string> {
    try {
      const err = await expectGrpcCode(
        () =>
          clients.agentExecutionCommand.create(
            makeAgentExecution({ org, name: uniqueName(label), agentRef: agentRefOf(agent), runConfig }),
          ),
        Code.InvalidArgument,
        what,
      );
      return err.rawMessage;
    } finally {
      await clients.agentCommand.delete({ value: agent.metadata!.id });
    }
  }

  it("[rpc:AgentExecutionCommandController.create] rejects fast without a pinned model (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await refusedWith(
      org,
      await tierAgent(org),
      "aex-tier-no-model",
      { serviceTier: ServiceTier.FAST },
      "create with service_tier fast and no model_name",
    );
  });

  it("[rpc:AgentExecutionCommandController.create] rejects fast on a model with no registry fast variant (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // claude-haiku-4-5 is registered but prices no fast variant — selecting
    // a tier billing cannot price would trip the undercharge guard, so
    // selection and billability are coupled by refusing here.
    await refusedWith(
      org,
      await tierAgent(org),
      "aex-tier-unpriced",
      { modelName: "claude-haiku-4-5", serviceTier: ServiceTier.FAST },
      "create with service_tier fast on a model without a fast variant",
    );
  });

  it("[rpc:AgentExecutionCommandController.create] judges a tier a message sets alone on the agent's model, naming both layers (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // The agent's default model prices no fast variant; the message asks
    // for fast without naming a model, so the turn would run fast on the
    // agent's model. The refusal says which layer chose each.
    const message = await refusedWith(
      org,
      await tierAgent(org, { harness: Harness.NATIVE, runConfig: { modelName: "claude-sonnet-5" } }),
      "aex-tier-agent-model",
      { serviceTier: ServiceTier.FAST },
      "create with service_tier fast on the agent's default model, which prices none",
    );
    expect(message).toContain("the request's run_config");
    expect(message).toContain("the agent's run defaults");
  });
});

describe("AgentExecution conformance — thinking-mode fail-closed validation (#772, #1280)", () => {
  // The tier suite's twin: thinking is capability-gated (it bills at base
  // per-token rates, so no priced variant exists to key on) and validated
  // at create, judged on the harness the execution will run on (the
  // bootstrap session_spec's here; UNSPECIFIED is native). The validation
  // runs behind the run gate, so each arm creates a real agent: an
  // enforcing edition would refuse a fake one as PermissionDenied first.
  // Every arm is a refusal, before any side effect, so no execution runs.
  async function realAgent(org: string): Promise<Agent> {
    return clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-thinking"), instructions: "You validate thinking modes." }),
    );
  }

  async function expectRefused(
    label: string,
    runConfig: Parameters<typeof makeAgentExecution>[0]["runConfig"],
    harness: Harness,
    what: string,
  ): Promise<void> {
    const { org } = await target.provisionTenancy();
    const agent = await realAgent(org);
    try {
      await expectGrpcCode(
        () =>
          clients.agentExecutionCommand.create(
            makeAgentExecution({
              org,
              name: uniqueName(label),
              agentRef: agentRefOf(agent),
              sessionSpec: { harness },
              runConfig,
            }),
          ),
        Code.InvalidArgument,
        what,
      );
    } finally {
      await clients.agentCommand.delete({ value: agent.metadata!.id });
    }
  }

  it("[rpc:AgentExecutionCommandController.create] rejects enabled without a pinned model (InvalidArgument)", async () => {
    await expectRefused(
      "aex-thinking-no-model",
      { thinkingMode: ThinkingMode.ENABLED },
      Harness.UNSPECIFIED,
      "create with thinking_mode enabled and no model_name",
    );
  });

  it("[rpc:AgentExecutionCommandController.create] rejects enabled on a cursor model without the thinking capability (InvalidArgument)", async () => {
    // composer-2.5's cursor-harness registry entry declares no thinking form —
    // ENABLED there would silently serve the base variant, so it is refused
    // (selection and the served variant stay coupled).
    await expectRefused(
      "aex-thinking-incapable",
      { modelName: "composer-2.5", thinkingMode: ThinkingMode.ENABLED },
      Harness.CURSOR,
      "create with thinking_mode enabled on a model without the capability",
    );
  });

  it("[rpc:AgentExecutionCommandController.create] rejects enabled on a native session for a model with no native registry entry (InvalidArgument)", async () => {
    // The harness decides which entry is read: composer-2.5 has no native
    // entry, so a native session cannot ask it to think.
    await expectRefused(
      "aex-thinking-no-native-entry",
      { modelName: "composer-2.5", thinkingMode: ThinkingMode.ENABLED },
      Harness.NATIVE,
      "create with thinking_mode enabled on a native session for a cursor-only model",
    );
  });

  it("[rpc:AgentExecutionCommandController.create] rejects an explicit disabled on a model that always thinks (InvalidArgument)", async () => {
    // claude-fable-5's native entry declares thinkingRequired: the provider
    // refuses a request to turn its thinking off, so the platform refuses the
    // execution that asks for it rather than fail the turn.
    await expectRefused(
      "aex-thinking-required",
      { modelName: "claude-fable-5", thinkingMode: ThinkingMode.DISABLED },
      Harness.NATIVE,
      "create with thinking_mode disabled on a model that requires thinking",
    );
  });
});

// --- the engineless read surfaces -------------------------------------------
//
// No execution record can exist on this target (create's engine gate below),
// so every read RPC is asserted in its zero-record / validation arm — the
// truthful answers a fresh server owes before anything has ever run. The
// populated arms live in suites-execution/.

describe("AgentExecution conformance — a turn belongs to its session's organization (#1580)", () => {
  it("[rpc:AgentExecutionCommandController.create] refuses a turn in a session under another organization (FailedPrecondition, naming neither)", async () => {
    // One caller, two organizations: the session lives in the first, and the
    // turn names the second. The refusal comes right after the run gate,
    // before the engine gate, so no engine is needed.
    const home = await target.provisionTenancy();
    const other = await target.provisionTenancy();
    const session = await clients.sessionCommand.create(
      makeSession({ org: home.org, name: uniqueName("aex-home-session") }),
    );
    const sessionId = session.metadata!.id;
    try {
      const refused = await expectGrpcCode(
        () =>
          clients.agentExecutionCommand.create(
            makeAgentExecution({ org: other.org, name: uniqueName("aex-foreign-org"), sessionId }),
          ),
        Code.FailedPrecondition,
        "create under another organization than the session's",
      );
      expect(refused.rawMessage).toBe(
        `an execution in session '${sessionId}' must belong to the session's organization`,
      );
      // Refused before any side effect: the session holds no execution.
      const listed = await clients.agentExecutionQuery.listBySession({ sessionId });
      expect(listed.entries).toHaveLength(0);
    } finally {
      await clients.sessionCommand.delete({ value: sessionId });
    }
  });
});

describe("AgentExecution conformance — a turn runs the agent its session pinned", () => {
  // A session records the agent it runs by id (status.agent_id), and every
  // turn reaches it by that id, never by slug again. Both refusals come from
  // ResolveRunAgent, after the session's own run gate and before the engine
  // gate, so no engine is needed and no execution is created.
  it("[rpc:AgentExecutionCommandController.create] a turn in a session whose agent was deleted is FailedPrecondition naming the session and the agent", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-gone") }));
    const session = await clients.sessionCommand.create(
      makeSession({ org, name: uniqueName("aex-gone-session"), agentRef: agentRefOf(agent) }),
    );
    const sessionId = session.metadata!.id;
    try {
      await clients.agentCommand.delete({ value: agent.metadata!.id });

      const refused = await expectGrpcCode(
        () => clients.agentExecutionCommand.create(makeAgentExecution({ org, name: uniqueName("aex-gone"), sessionId })),
        Code.FailedPrecondition,
        "a turn in a session whose agent was deleted",
      );
      expect(refused.rawMessage).toBe(
        `session '${sessionId}' runs agent '${agent.metadata!.id}', which no longer exists; update the session to another agent, or start a new conversation`,
      );
      const listed = await clients.agentExecutionQuery.listBySession({ sessionId });
      expect(listed.entries, "refused before any side effect").toHaveLength(0);
    } finally {
      await clients.sessionCommand.delete({ value: sessionId });
    }
  });

  it("[rpc:AgentExecutionCommandController.create] an agent deleted and re-created under the same slug does not take over a live conversation: its next turn fails naming the old agent", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent-reborn");
    const original = await clients.agentCommand.create(makeAgent({ org, name }));
    const session = await clients.sessionCommand.create(
      makeSession({ org, name: uniqueName("aex-reborn-session"), agentRef: agentRefOf(original) }),
    );
    const sessionId = session.metadata!.id;
    let reborn: Agent | undefined;
    try {
      await clients.agentCommand.delete({ value: original.metadata!.id });
      reborn = await clients.agentCommand.create(makeAgent({ org, name }));
      expect(reborn.metadata?.slug, "the slug is taken again").toBe(original.metadata?.slug);
      expect(reborn.metadata?.id).not.toBe(original.metadata?.id);

      const refused = await expectGrpcCode(
        () => clients.agentExecutionCommand.create(makeAgentExecution({ org, name: uniqueName("aex-reborn"), sessionId })),
        Code.FailedPrecondition,
        "a turn in a session whose agent's slug now names another agent",
      );
      expect(refused.rawMessage).toContain(`runs agent '${original.metadata!.id}', which no longer exists`);
      const stored = await clients.sessionQuery.get({ value: sessionId });
      expect(stored.status?.agentId, "the pin still names the agent it resolved").toBe(original.metadata?.id);
    } finally {
      await clients.sessionCommand.delete({ value: sessionId });
      if (reborn !== undefined) {
        await clients.agentCommand.delete({ value: reborn.metadata!.id });
      }
    }
  });
});

describe("AgentExecution conformance — the workflow parent link", () => {
  // spec.parent links a turn to the workflow run that started it. It is
  // honoured only from that run's runner, the server, or a holder of the
  // platform's can_write_reserved_labels (open source's trusted-local
  // posture grants it; an enforcing Authorizer does not — the run-gate
  // suite pins that refusal on the enforcing lane). The queue the turn
  // dispatches to is derived from the link; no request field names one.
  it("[rpc:AgentExecutionCommandController.create] a parent link naming another workflow run than the stigmer.ai/workflow-execution-id label is refused (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const refused = await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-parent-mismatch"),
            parent: { workflowRunId: "wfx_linked" },
            labels: { "stigmer.ai/workflow-execution-id": "wfx_labelled" },
          }),
        ),
      Code.InvalidArgument,
      "a parent link whose workflow run differs from the lineage label",
    );
    expect(refused.rawMessage).toBe(
      "parent.workflow_execution_id 'wfx_linked' differs from the stigmer.ai/workflow-execution-id label 'wfx_labelled'; a turn belongs to one workflow run",
    );
  });

  it("[rpc:AgentExecutionCommandController.create] a parent link is admitted under the trusted-local posture: the turn passes every check up to the engine gate", async (ctx) => {
    // Only an engineless target whose primary is trusted-local observes this
    // boundary: an enforcing primary refuses the link (the run-gate suite),
    // and a target with an engine runs the turn (the execution suite).
    if (target.capabilities.enforcingAuthorizer || target.capabilities.scheduleFiring) return ctx.skip();
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({
            org,
            name: uniqueName("aex-parent-local"),
            parent: { workflowRunId: "wfx_trustedlocal" },
          }),
        ),
      Code.Unavailable,
      "a parent link under the trusted-local posture reaches the engine gate",
    );
  });
});

describe("AgentExecution conformance — the engine gate", () => {
  it("[rpc:AgentExecutionCommandController.create] create refuses Unavailable before any side effect when no engine is connected", async (ctx) => {
    // Only the engineless local CRUD targets observe this boundary —
    // scheduleFiring doubles as "a Temporal engine backs this target", and
    // the cloud CRUD target serves a live engine (and resolves the agent
    // reference before its gate).
    if (target.capabilities.scheduleFiring) return ctx.skip();
    const { org } = await target.provisionTenancy();
    // A turn with no target is a conversation with the built-in assistant:
    // it names no agent, so every check before the engine gate passes and
    // the refusal proves the gate itself.
    const err = await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({ org, name: uniqueName("aex-gate") }),
        ),
      Code.Unavailable,
      "create with no execution engine behind the server",
    );
    expect(err.rawMessage).toBe(
      "The execution engine is temporarily unavailable. Please try again shortly.",
    );
  });
});

describe("AgentExecution conformance — zero-record read surfaces", () => {
  it("[rpc:AgentExecutionQueryController.getExecutionSummary] getExecutionSummary answers the pinned zero shape — no cost fields by design", async () => {
    const { org } = await target.provisionTenancy();
    const summary = await clients.agentExecutionQuery.getRunSummary({ org });

    expect(summary.activeCount).toBe(0);
    expect(summary.phaseCounts).toEqual({});
    // An average over nothing is absence, not 0; and unlike the workflow
    // summary there are deliberately NO cost fields on this shape at all.
    expect(summary.avgDuration).toBeUndefined();
    expect(summary.topFailingAgents).toHaveLength(0);
  });

  it("[rpc:AgentExecutionQueryController.getExecutionUsageReport] the execution-scoped usage report validates and checks existence (the ONE report that 404s)", async () => {
    await expectGrpcCode(
      () => clients.agentExecutionQuery.getRunUsageReport({ runId: "" }),
      Code.InvalidArgument,
      "execution usage report without an id",
    );
    // Single-user arm: the multi-tenant edition's authorization fails
    // closed on an unresolvable id (PermissionDenied, no existence leak).
    if (target.capabilities.enforcingAuthorizer) return;
    const err = await expectGrpcCode(
      () =>
        clients.agentExecutionQuery.getRunUsageReport({
          runId: "aexec_01conformancemissing",
        }),
      Code.NotFound,
      "execution usage report for an unknown execution",
    );
    expect(err.rawMessage).toBe("agent_execution not found: aexec_01conformancemissing");
  });

  it("[rpc:AgentExecutionQueryController.getSessionUsageReport] [rpc:AgentExecutionQueryController.getAgentUsageReport] [rpc:AgentExecutionQueryController.getOrgUsageReport] the session/agent/org usage reports answer zero-valued SHAPES for nothing to aggregate", async (ctx) => {
    // Single-user posture only: where orgs are real, an unauthorized scope
    // answers PermissionDenied instead of a zero report — the aggregation
    // reads are authorization-gated per scope on the multi-tenant edition.
    if (target.capabilities.enforcingAuthorizer) return ctx.skip();
    // The zero-shapes contract: these aggregation reads never error for
    // "nothing to aggregate" — they answer structurally complete,
    // zero-valued reports (OSS deliberately records no usage data at all,
    // so on this edition even populated executions aggregate to zero).
    // The session report names no Organization and checks no existence;
    // the agent and org reports name one, which must exist (below).
    const { org } = await target.provisionTenancy();
    const session = await clients.agentExecutionQuery.getSessionUsageReport({
      sessionId: "ses_01conformancemissing",
    });
    expect(session.sessionId).toBe("ses_01conformancemissing");
    expect(session.runCount).toBe(0);
    expect(session.totalUsage, "the aggregate is always present, zero-valued").toBeDefined();
    expect(session.runs).toHaveLength(0);
    expect(session.modelBreakdown).toHaveLength(0);
    expect(session.firstRunAt).toBe("");
    expect(session.lastRunAt).toBe("");

    const agent = await clients.agentExecutionQuery.getAgentUsageReport({
      agentId: "agt_01conformancemissing",
      org,
    });
    // The name resolves only when the org has executions; until then the
    // id is echoed — pinned so clients know not to treat it as a name.
    expect(agent.agentName).toBe("agt_01conformancemissing");
    expect(agent.totalUsage).toBeDefined();
    expect(agent.sessions).toHaveLength(0);
    expect(agent.totalSessions).toBe(0);
    expect(agent.totalRuns).toBe(0);

    const orgReport = await clients.agentExecutionQuery.getOrgUsageReport({
      org,
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });
    expect(orgReport.org).toBe(org);
    expect(orgReport.totalAgents).toBe(0);
    expect(orgReport.totalSessions).toBe(0);
    expect(orgReport.totalRuns).toBe(0);
    expect(orgReport.modelBreakdown).toHaveLength(0);
    expect(orgReport.topAgentsByCost).toHaveLength(0);
    expect(orgReport.dailyCosts).toHaveLength(0);
  });

  it("[rpc:AgentExecutionQueryController.getAgentUsageReport] [rpc:AgentExecutionQueryController.getOrgUsageReport] the agent/org usage reports of an Organization that does not exist are NotFound with the load-first copy", async () => {
    // Nothing to aggregate is a zero report (above); no Organization at all
    // is NOT_FOUND, the answer every edition gives for a scope it does not
    // hold, with or without sign-in (stigmer#1163).
    const missing = uniqueOrg();
    for (const [lane, call] of [
      [
        "agent report",
        () => clients.agentExecutionQuery.getAgentUsageReport({ agentId: "agt_01conformancemissing", org: missing }),
      ],
      [
        "org report",
        () =>
          clients.agentExecutionQuery.getOrgUsageReport({ org: missing, fromDate: "2026-01-01", toDate: "2026-01-31" }),
      ],
    ] as const) {
      const error = await expectGrpcCode(call, Code.NotFound, `${lane} of a missing organization`);
      expect(error.rawMessage, lane).toBe(`Organization not found: ${missing}`);
    }
  });

  it("[rpc:AgentExecutionQueryController.getAgentUsageReport] [rpc:AgentExecutionQueryController.getOrgUsageReport] the agent/org usage reports refuse missing scope fields (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.agentExecutionQuery.getAgentUsageReport({ agentId: "agt_x" }),
      Code.InvalidArgument,
      "agent usage report without org",
    );
    await expectGrpcCode(
      () => clients.agentExecutionQuery.getOrgUsageReport({ org: "conf-org" }),
      Code.InvalidArgument,
      "org usage report without the date range",
    );
  });

  it("[rpc:AgentExecutionQueryController.subscribe] subscribe refuses an empty id (InvalidArgument) and an unknown id (NotFound)", async () => {
    await expectGrpcCode(
      () =>
        collectStream((signal) => clients.agentExecutionQuery.subscribe({ value: "" }, { signal })),
      Code.InvalidArgument,
      "subscribe with an empty id",
    );
    // Single-user arm here; on the multi-tenant edition an unresolvable id
    // answers the SAME NotFound through the authorizer's deny-path
    // existence probe (the uniform not-found posture) — pinned
    // with an outsider caller in the direct-handler-authorization suite.
    if (target.capabilities.enforcingAuthorizer) return;
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

describe("AgentExecution conformance — submitFileDecision negatives", () => {
  // Single-user-posture arms: the multi-tenant edition's authorization
  // interceptor resolves the execution BEFORE proto validation, so invalid
  // or unknown ids surface as NotFound/PermissionDenied there instead — a
  // known ordering divergence.
  it("[rpc:AgentExecutionCommandController.submitFileDecision] rejects structurally invalid inputs before any load (InvalidArgument)", async (ctx) => {
    if (target.capabilities.enforcingAuthorizer) return ctx.skip();
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitFileDecision({
          agentRunId: "",
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
          agentRunId: "aexec_x",
          changeSetId: "cs_x",
          expectedDigest: "digest",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.UNSPECIFIED,
        }),
      Code.InvalidArgument,
      "submitFileDecision with an unspecified action",
    );
  });

  it("[rpc:AgentExecutionCommandController.submitFileDecision] an unknown execution answers NotFound", async (ctx) => {
    if (target.capabilities.enforcingAuthorizer) return ctx.skip();
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitFileDecision({
          agentRunId: "aexec_01conformancemissing",
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
