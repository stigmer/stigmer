// Billing gates conformance — the settle observer, the approval STOP gate and
// the recover re-arm, observed through real agent executions (Class B;
// billingGates + billingLedger targets). E1 of the DD-012 reset (entry
// 20260906.04); the sibling of billing-denial, which pins the create-time
// reserve gate.
// Domain: billing (execution-time gates).
//
// Why Class B: these arms need an execution that RUNS — the reservation is
// taken when the workflow authorizes, released when it settles, and the
// approval and recover gates read the reservation's signal — so the
// execution target's runner and mock LLM drive the run while the ledger is
// read through the billing RPCs. Credits are moved between phases with
// adjustCredits (the org owner may) so a gate can be observed flipping.
//
// Java's copy is the contract (byte-pinned by the C5 facade's gates.ts too):
//   approval on STOP  → FAILED_PRECONDITION "Insufficient credits to continue
//                       this execution. Please add credits before acting on
//                       this approval, or cancel the execution."
//   recover unfunded  → FAILED_PRECONDITION "Insufficient credits to recover
//                       this execution: Insufficient credits to start execution"
import { Code } from "@connectrpc/connect";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { ECHO_TOOL_NAME, type McpToolFixture } from "../harness/mcp-server";
import { anthropicText, anthropicToolUses, type MockLlmProxy } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitPhase, awaitTerminal, makeAgentExecution, requireLlmProxy, requireMcpFixture } from "../support/agentexecutions";
import { makeHttpMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

const collectionTarget = createTarget();
const gatesEnabled = collectionTarget.capabilities.billingGates && collectionTarget.capabilities.billingLedger;

const APPROVAL_STOP_COPY =
  "Insufficient credits to continue this execution. Please add credits before acting on this approval, or cancel the execution.";
const RECOVER_DENIED_COPY = "Insufficient credits to recover this execution: Insufficient credits to start execution";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
const fixtures = new FixtureTracker();

describe.skipIf(!gatesEnabled)("Billing gates — settle, the approval STOP gate, the recover re-arm (billingGates + billingLedger targets)", () => {
  beforeAll(async () => {
    target = createTarget();
    await target.setup();
    clients = target.clients();
    mock = requireLlmProxy(target);
    mcp = requireMcpFixture(target);
  });

  afterEach(async () => {
    await fixtures.cleanup();
    mock.reset();
  });

  afterAll(async () => {
    await target?.teardown();
  });

  async function fundedOrg(): Promise<TenancyContext> {
    // The execution target's provisionTenancy funds by default.
    const context = await target.provisionTenancy();
    fixtures.defer(() => target.cleanupTenancy(context));
    return context;
  }

  async function balance(org: string) {
    return clients.billingQuery.getCreditBalance({ orgId: org });
  }

  // Drives the org's available balance BELOW the point where the gates flip,
  // as its owner — the lever between two observations. Zero is not enough:
  // the engine grants an org `allowed_negative_balance_micros` of overdraft,
  // and the approval signal counts the run's live reservation as headroom
  // (ExecutionBillingService.querySignal: STOP when
  // available + headroom <= -allowedNegative). The re-arm denies when
  // min(default cap, available + allowedNegative) < the start threshold.
  // `beyondMicros` is what to drain past -allowedNegative: the held
  // reservation plus one for the STOP arm, one for the re-arm arm.
  async function drainPast(org: string, beyondMicros: bigint): Promise<void> {
    const account = await clients.billingQuery.getBillingAccount({ orgId: org });
    const available = account.balance?.availableMicros ?? 0n;
    const allowedNegative = account.allowedNegativeBalanceMicros;
    const amount = -(available + allowedNegative + beyondMicros);
    await clients.billingCommand.adjustCredits({
      orgId: org,
      amountMicros: amount,
      reason: "conformance drain past the gate threshold",
      idempotencyKey: uniqueName("drain"),
    });
  }

  // Refunds past every threshold with a FRESH idempotency key: the target's
  // fundTenancy seeds under `conformance-seed-<org>`, which the initial seed
  // already consumed — replaying it adds nothing (billing.rpc.adjust-credits
  // .idempotency-key-replays-once), so a refund must be its own adjustment.
  async function refund(org: string): Promise<void> {
    await clients.billingCommand.adjustCredits({
      orgId: org,
      amountMicros: 200_000_000n,
      reason: "conformance refund after drain",
      idempotencyKey: uniqueName("refund"),
    });
  }

  async function provisionAgent(org: string): Promise<string> {
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    return agent.metadata!.id;
  }

  async function provisionGatedAgent(org: string): Promise<string> {
    const server = await clients.mcpServerCommand.create(makeHttpMcpServer({ org, name: uniqueName("mcp"), url: mcp.url() }));
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-gated"),
        mcpServerUsages: [{ slug: server.metadata!.slug, toolApprovalOverrides: [{ toolName: ECHO_TOOL_NAME, requiresApproval: true }] }],
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    return agent.metadata!.id;
  }

  it("[billing.gate.reserve.funded-execution-holds-then-settles] a completed run settles its reservation — nothing stays held and the balance reflects the run", async () => {
    const { org } = await fundedOrg();
    const agentId = await provisionAgent(org);
    const before = await balance(org);

    mock.enqueue(anthropicText("Done.", { inputTokens: 100, outputTokens: 20 }));
    const created = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name: uniqueName("aex-settle"), agentId }));
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));

    const final = await awaitTerminal(clients, created.metadata!.id);
    expect(final.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // Settle runs in the workflow's finally block after the terminal status;
    // give the observer a moment, then require the hold to be gone.
    const deadline = Date.now() + 15_000;
    let after = await balance(org);
    while (after.reservedMicros !== 0n && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      after = await balance(org);
    }
    expect(after.reservedMicros, "no reservation remains held after settle").toBe(0n);
    expect(after.availableMicros, "the run cost at most what it used; the hold itself is not spent").toBeLessThanOrEqual(before.availableMicros);
  });

  it("[billing.gate.approval-signal.stop-refuses-approval] once the org is drained, acting on a pending approval is refused with the STOP copy; refunding clears it", async () => {
    const { org } = await fundedOrg();
    const agentId = await provisionGatedAgent(org);

    mock.enqueue(anthropicToolUses([{ toolCallId: "call_gate", toolName: ECHO_TOOL_NAME, toolInput: { text: "hi" } }]));
    mock.enqueue(anthropicText("Done."));
    const created = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name: uniqueName("aex-gate"), agentId }));
    const executionId = created.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
    const gated = await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL, { label: "WAITING_FOR_APPROVAL" });
    const toolCallId = gated.status!.pendingApprovals[0]!.toolCallId;

    const held = (await balance(org)).reservedMicros;
    await drainPast(org, held + 1n);
    const refused = await expectGrpcCode(
      () => clients.agentExecutionCommand.submitApproval({ agentExecutionId: executionId, toolCallId, action: ApprovalAction.APPROVE }),
      Code.FailedPrecondition,
      "approval while the billing signal is STOP",
    );
    expect(refused.rawMessage).toBe(APPROVAL_STOP_COPY);

    await refund(org);
    const approved = await clients.agentExecutionCommand.submitApproval({ agentExecutionId: executionId, toolCallId, action: ApprovalAction.APPROVE });
    expect(approved.status?.pendingApprovals.length).toBe(0);
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  it("[billing.gate.rearm.recover-refused-when-unfunded] recovering a failed run is refused with the re-arm copy while unfunded, and re-arms once funded", async () => {
    const { org } = await fundedOrg();
    const agentId = await provisionAgent(org);

    mock.enqueueError(400);
    mock.enqueue(anthropicText("Recovered."));
    const created = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name: uniqueName("aex-rearm"), agentId }));
    const executionId = created.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
    await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_FAILED);

    await drainPast(org, 1n);
    const refused = await expectGrpcCode(
      () => clients.agentExecutionCommand.recover({ id: executionId }),
      Code.FailedPrecondition,
      "recover while unfunded",
    );
    expect(refused.rawMessage).toBe(RECOVER_DENIED_COPY);

    await refund(org);
    const recovered = await clients.agentExecutionCommand.recover({ id: executionId });
    expect(recovered.status?.phase).not.toBe(ExecutionPhase.EXECUTION_FAILED);
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });
});
