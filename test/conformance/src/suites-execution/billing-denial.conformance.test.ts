// Conformance suite for the zero-credit execution denial (billingGates targets).
// Domain: billing — the execution-credit gate an agent-execution create runs
// through: the ReserveExecutionCredits gate on the create chain's
// `agent-execution-create:pre-side-effect-gate` slot.
//
// The contract is SYNCHRONOUS: a zero-credit org's create RPC itself is
// refused FAILED_PRECONDITION with the engine's denial_reason verbatim, and no
// execution resource exists afterwards. That shape was ruled at the C5 billing
// facade's plan gate (20260830.02.sp.billing-facade, Q5: "strictly earlier
// than the Java refusal" — the retired Java service accepted the create and
// failed the execution asynchronously; that arm retired with it, stigmer#1023).
// Enforced strictly: a composition regressing to an asynchronous failure, or
// changing the denial bytes, turns this suite red.
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

// The engine's one denial vocabulary (the billing engine's preview predicate),
// passed through the refusal verbatim — byte-pinned.
const ENGINE_DENIAL_REASON = "Insufficient credits to start execution";

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

    it("[billing.gate.reserve.unfunded-execution-denied] a zero-credit org's create is refused synchronously with the engine's denial vocabulary", async () => {
      const { org } = await provisionUnfunded();
      const agentId = await provisionAgent(org);

      // The create-time reserve gate: the RPC itself refuses, no execution
      // resource exists, the denial reason is the engine's vocabulary
      // verbatim. No mock turn is queued — nothing must reach the LLM.
      const err = await expectGrpcCode(
        () =>
          clients.agentExecutionCommand.create(
            makeAgentExecution({ org, name: uniqueName("aex"), agentId }),
          ),
        Code.FailedPrecondition,
        "zero-credit create",
      );
      expect(err.rawMessage, "the engine's denial vocabulary passes through verbatim").toBe(
        ENGINE_DENIAL_REASON,
      );
    });

    it("[billing.gate.reserve.funding-clears-denial] funding the same org clears the denial — the negative control", async () => {
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
