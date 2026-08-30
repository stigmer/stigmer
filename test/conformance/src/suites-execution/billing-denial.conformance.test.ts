// Conformance suite for the zero-credit execution denial (billingGates targets).
// Domain: billing — the execution-credit gate an agent-execution create runs
// through, pinned at the ONE deliberately divergent point of the C5 billing
// facade (20260830.02.sp.billing-facade, plan-gate ruling Q5).
//
// Both cloud editions authorize execution credits through the same engine
// predicate and the same denial vocabulary, but WHERE the denial lands is a
// ruled, recorded divergence — not drift:
//
// - The Java baseline accepts the create and fails the execution
//   asynchronously: InvokeAgentExecutionWorkflow authorizes billing before
//   dispatch, stamps EXECUTION_FAILED with status.error
//   "Insufficient credits: <reason>" and the system message
//   "Execution could not start: <reason>" (InvokeAgentExecutionWorkflowImpl).
// - The TS composition refuses the create RPC synchronously:
//   the ReserveExecutionCredits gate answers FAILED_PRECONDITION with the
//   engine's denial_reason verbatim (blueprint §7 "strictly earlier than the
//   Java refusal"; the C1 NOT_FOUND-arm disposition precedent).
//
// Because both editions serve behind the same `cloud` target type, the suite
// cannot tell them apart by target name. The arm is declared explicitly via
// STIGMER_CONFORMANCE_BILLING_DENIAL_CONTRACT ("async" | "sync", default
// "async" — the Java baseline, so the nightly hermetic lane runs unchanged;
// composition readouts set "sync"). Each arm is enforced strictly: a
// composition regressing to the async shape, or Java changing its failure
// bytes, turns this suite red.
//
// Precondition: an org whose billing account exists AT THE ZERO BALANCE an
// org create provisions (GetOrCreateBillingAccountHandler creates accounts
// with zero balance and default thresholds — there is no signup grant), with
// the conformance credit seed deliberately skipped. The negative control
// funds the SAME org and proves the denial clears — credit-driven, not
// environmental.
//
// Skipped entirely on the local OSS targets: no billing engine exists there
// by DD-001 boundary (see CapabilityFlags.billingGates), so there is no
// denial contract to pin — the scheduleFiring skip posture.
import { Code } from "@connectrpc/connect";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import {
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
} from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile, type TenancyContext } from "../targets";

// Collection-time capability read (the schedule-firing/forwarder pattern).
const billingEnabled = createTarget().capabilities.billingGates;

// The engine's one denial vocabulary (ExecutionBillingService.previewInternal)
// and the two caller-facing framings built from it — byte-pinned.
const ENGINE_DENIAL_REASON = "Insufficient credits to start execution";
const ASYNC_FAILURE_ERROR = `Insufficient credits: ${ENGINE_DENIAL_REASON}`;
const ASYNC_FAILURE_MESSAGE = `Execution could not start: ${ENGINE_DENIAL_REASON}`;

const DENIAL_CONTRACT_ENV = "STIGMER_CONFORMANCE_BILLING_DENIAL_CONTRACT";
type DenialContract = "async" | "sync";

function resolveDenialContract(): DenialContract {
  const raw = process.env[DENIAL_CONTRACT_ENV] ?? "async";
  if (raw !== "async" && raw !== "sync") {
    throw new Error(
      `${DENIAL_CONTRACT_ENV} must be "async" or "sync" when set; got "${raw}"`,
    );
  }
  return raw;
}

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

describe.skipIf(!billingEnabled)(
  "Billing denial — the zero-credit execution contract (billingGates targets)",
  () => {
    beforeAll(async () => {
      target = createTarget();
      await target.setup();
      clients = target.clients();
      mock = requireLlmProxy(target);
    });

    afterEach(async () => {
      await fixtures.cleanup();
      mock.reset();
    });

    afterAll(async () => {
      await target?.teardown();
    });

    // A billingGates target without the unfunded lane is a target bug, not a
    // skippable condition — fail loudly rather than false-green.
    async function provisionUnfunded(): Promise<TenancyContext> {
      if (target.provisionUnfundedTenancy === undefined) {
        throw new Error(
          `target ${target.name} declares billingGates but provides no provisionUnfundedTenancy()`,
        );
      }
      const context = await target.provisionUnfundedTenancy();
      fixtures.defer(() => target.cleanupTenancy(context));
      return context;
    }

    async function provisionAgent(org: string): Promise<string> {
      const agent = await clients.agentCommand.create(
        makeAgent({ org, name: uniqueName("agent") }),
      );
      fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
      return agent.metadata!.id;
    }

    it("a zero-credit org's execution lands the ruled denial for this edition", async () => {
      const { org } = await provisionUnfunded();
      const agentId = await provisionAgent(org);
      const contract = resolveDenialContract();

      if (contract === "sync") {
        // The composition's create-time reserve gate: the RPC itself refuses,
        // no execution resource exists, the denial reason is the engine's
        // vocabulary verbatim.
        const err = await expectGrpcCode(
          () =>
            clients.agentExecutionCommand.create(
              makeAgentExecution({ org, name: uniqueName("aex"), agentId }),
            ),
          Code.FailedPrecondition,
          "zero-credit create (sync contract)",
        );
        expect(err.rawMessage, "the engine's denial vocabulary passes through verbatim").toBe(
          ENGINE_DENIAL_REASON,
        );
      } else {
        // The Java baseline: create accepted, the workflow authorizes before
        // dispatch and fails the execution with the pinned error bytes. No
        // mock turn is queued — the run must never reach the LLM.
        const created = await clients.agentExecutionCommand.create(
          makeAgentExecution({ org, name: uniqueName("aex"), agentId }),
        );
        fixtures.defer(() =>
          clients.agentExecutionCommand.delete({ value: created.metadata!.id }),
        );

        const final = await awaitTerminal(clients, created.metadata!.id);
        expect(final.status?.phase, "billing denial fails the execution").toBe(
          ExecutionPhase.EXECUTION_FAILED,
        );
        expect(final.status?.error, "the workflow's denial framing, byte-pinned").toBe(
          ASYNC_FAILURE_ERROR,
        );
        expect(
          final.status?.messages?.some((m) => m.content === ASYNC_FAILURE_MESSAGE),
          `a system message carries "${ASYNC_FAILURE_MESSAGE}"`,
        ).toBe(true);
      }
    });

    it("funding the same org clears the denial — the negative control", async () => {
      const { org } = await provisionUnfunded();
      const agentId = await provisionAgent(org);
      if (target.fundTenancy === undefined) {
        throw new Error(
          `target ${target.name} declares billingGates but provides no fundTenancy()`,
        );
      }
      await target.fundTenancy(org);

      mock.enqueue(anthropicText("Done."));
      const created = await clients.agentExecutionCommand.create(
        makeAgentExecution({ org, name: uniqueName("aex"), agentId }),
      );
      fixtures.defer(() =>
        clients.agentExecutionCommand.delete({ value: created.metadata!.id }),
      );

      const final = await awaitTerminal(clients, created.metadata!.id);
      expect(
        final.status?.phase,
        "the funded org's run completes — the denial was credit-driven",
      ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    });
  },
);
