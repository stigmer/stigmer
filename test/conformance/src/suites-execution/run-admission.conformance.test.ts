// Conformance suite for run admission on the organization's own provider keys
// (billingGates targets).
// Domain: billing — the provider-key gate an agent-execution create runs
// through on the hosted edition, on the create chain's
// `agent-execution-create:pre-side-effect-gate` slot, after the request's own
// validation.
//
// The hosted edition serves every model call on a key the organization
// owns and never on one of its own, so a run is admitted on a key and on
// nothing else:
//   - an organization with no key for the run's model's provider is refused
//     synchronously at create, FAILED_PRECONDITION with ErrorInfo reason
//     PROVIDER_KEY_REQUIRED naming the provider and the model, and nothing
//     reaches a model;
//   - a Cursor run is refused the same way when the organization holds no
//     Cursor key: the engine names the provider, and a run on Auto names no
//     model, so the copy names none;
//   - a Claude run is refused the same way when the organization holds no
//     Anthropic key: the engine runs Claude models only, so it names the
//     provider, and the copy names the run's model or the engine's default;
//   - the same organization, once it saves its keys, runs to completion: the
//     provider bills the organization directly.
//
// The keyed half is native only: a Cursor key is checked with Cursor itself
// at save, so no fixture can stand in for one, and a keyed Cursor run would
// reach Cursor.
//
// Skipped on the local OSS targets: no provider-key gate exists there (a
// self-hosted runner calls its providers with the operator's own keys).
import { Code } from "@connectrpc/connect";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { type AgentRefInit, agentRefOf, makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/runs";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile, type TenancyContext } from "../targets";

// Collection-time capability read (the routine-firing/forwarder pattern).
const billingEnabled = createTarget().capabilities.billingGates;

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

describe.skipIf(!billingEnabled)(
  "Run admission — a native run runs on the organization's own provider key (billingGates targets)",
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

    // A billingGates target without these lanes is a target bug, not a
    // skippable condition — fail loudly rather than false-green.
    async function provisionBare(): Promise<TenancyContext> {
      if (target.provisionKeylessTenancy === undefined || target.keyTenancy === undefined) {
        throw new Error(
          `target ${target.name} declares billingGates but provides no provisionKeylessTenancy() or keyTenancy()`,
        );
      }
      const context = await target.provisionKeylessTenancy();
      fixtures.defer(() => target.cleanupTenancy(context));
      return context;
    }

    async function provisionAgent(org: string): Promise<AgentRefInit> {
      const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
      fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
      return agentRefOf(agent);
    }

    it("[billing.gate.provider-key.keyless-run-refused] an organization with no provider key is refused at create with PROVIDER_KEY_REQUIRED, and nothing reaches a model", async () => {
      const { org } = await provisionBare();
      const agentRef = await provisionAgent(org);

      // No mock turn is queued: nothing may reach the model.
      const err = await expectGrpcCode(
        () => clients.agentExecutionCommand.create(makeAgentExecution({ org, name: uniqueName("aex"), agentRef })),
        Code.FailedPrecondition,
        "keyless create",
      );
      const [info] = err.findDetails(ErrorInfoSchema);
      expect(info?.reason).toBe("PROVIDER_KEY_REQUIRED");
      expect(info?.metadata["org"]).toBe(org);
      expect(["anthropic", "openai"]).toContain(info?.metadata["provider"]);
      expect(info?.metadata["model"], "the refusal names the model the run would have used").not.toBe("");
      expect(err.rawMessage).toMatch(/^This organization has no (Anthropic|OpenAI) key for model '.+', so the run was not started\./);
      expect(err.rawMessage).toContain("An admin can add one in Settings → Provider keys.");
      expect(mock.remaining()).toBe(0);
    });

    it("[billing.gate.provider-key.keyless-cursor-run-refused] a Cursor run of an organization with no Cursor key is refused at create with PROVIDER_KEY_REQUIRED naming Cursor, and nothing reaches a model", async () => {
      const { org } = await provisionBare();
      const agentRef = await provisionAgent(org);

      const err = await expectGrpcCode(
        () =>
          clients.agentExecutionCommand.create(
            makeAgentExecution({ org, name: uniqueName("aex-cursor"), agentRef, sessionSpec: { harness: Harness.CURSOR } }),
          ),
        Code.FailedPrecondition,
        "keyless Cursor create",
      );
      const [info] = err.findDetails(ErrorInfoSchema);
      expect(info?.reason).toBe("PROVIDER_KEY_REQUIRED");
      expect(info?.metadata["org"]).toBe(org);
      expect(info?.metadata["provider"]).toBe("cursor");
      expect(err.rawMessage).toBe(
        "This organization has no Cursor key, so the run was not started. An admin can add one in Settings → Provider keys.",
      );
      expect(mock.remaining()).toBe(0);
    });

    it("[billing.gate.provider-key.keyless-claude-run-refused] a Claude run of an organization with no Anthropic key is refused at create with PROVIDER_KEY_REQUIRED naming Anthropic, and nothing reaches a model", async () => {
      const { org } = await provisionBare();
      const agentRef = await provisionAgent(org);

      const err = await expectGrpcCode(
        () =>
          clients.agentExecutionCommand.create(
            makeAgentExecution({ org, name: uniqueName("aex-claude"), agentRef, sessionSpec: { harness: Harness.CLAUDE } }),
          ),
        Code.FailedPrecondition,
        "keyless Claude create",
      );
      const [info] = err.findDetails(ErrorInfoSchema);
      expect(info?.reason).toBe("PROVIDER_KEY_REQUIRED");
      expect(info?.metadata["org"]).toBe(org);
      expect(info?.metadata["provider"]).toBe("anthropic");
      expect(err.rawMessage).toMatch(/^This organization has no Anthropic key( for model '.+')?, so the run was not started\./);
      expect(err.rawMessage).toContain("An admin can add one in Settings → Provider keys.");
      expect(mock.remaining()).toBe(0);
    });

    it("[billing.gate.provider-key.keyed-run-completes] the same organization, once keyed, runs to completion", async () => {
      const { org } = await provisionBare();
      const agentRef = await provisionAgent(org);
      await target.keyTenancy!(org);

      mock.enqueue(anthropicText("Done."));
      const created = await clients.agentExecutionCommand.create(
        makeAgentExecution({ org, name: uniqueName("aex"), agentRef }),
      );
      fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));

      const final = await awaitTerminal(clients, created.metadata!.id);
      expect(final.status?.phase, "the keyed org's run completes").toBe(RunPhase.RUN_COMPLETED);
    });
  },
);
