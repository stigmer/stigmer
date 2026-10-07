// Conformance suite for the semantic memory retriever's deployment posture
// (stigmer/stigmer#293 Phase 3).
// Domain: agentic / agentexecution — the runner-side selection of recalled
// memories, observed through the RecalledMemoriesReport on execution status.
//
// The conformance environment runs with NO embeddings-capable provider (the
// mock proxy speaks only Anthropic and fences every other provider path with
// a 500), which is exactly the deployment posture of Anthropic-only and
// Cursor-only OSS operators. The cross-edition property pinned here is
// therefore CREDENTIAL PRESENCE, not edition: both editions
// run the same runner code, and without an embedder every execution injects
// the full candidate set (Phase 2 behavior, unchanged) with an honest
// selection_active=false report — never a failed or degraded execution.
//
// Capability split: seeding memories requires the first-party capture gate
// (firstPartyMemoryCapture, targets/target.ts): the scenario runs on every
// target whose conformance user passes it. The capture-gate refusal is
// pinned in the CRUD-level memory suite.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { agentRefOf, makeAgent } from "../support/agents";
import {
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
} from "../support/runs";
import { provisionOrgWithConfirmedFacts } from "../support/memories";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

// Lockstep pin for the runner's activation threshold (RETRIEVAL_K in
// backend/services/runner/src/shared/memory-retrieval.ts): selection
// attempts (and here, degrades) only ABOVE this many confirmed facts.
const RETRIEVAL_ACTIVATION_THRESHOLD = 20;

let target: TargetProfile;
// Read at collection time so an edition without a capability reports its cases
// SKIPPED (the conformance guide's rule), never as passes that returned early.
const capabilities = createTarget().capabilities;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

// Funds an org this file creates where the target gates executions on
// credits (fundTenancy, targets/target.ts); elsewhere an org needs none.
async function fund(org: string): Promise<void> {
  await target.fundTenancy?.(org);
}

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// One completed execution in `org`, with a single scripted agent turn.
async function runExecution(org: string) {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  mock.enqueue(anthropicText("Done."));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("aex"), agentRef: agentRefOf(agent) }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));

  const settled = await awaitTerminal(clients, execution.metadata!.id);
  expect(settled.status?.phase).toBe(RunPhase.RUN_COMPLETED);
  return settled;
}

describe("Run memory retrieval (no-embedder posture)", () => {
  it.skipIf(!capabilities.firstPartyMemoryCapture)("injects wholesale below the threshold with an honest report and no embeddings attempt", async () => {
    const { org } = await provisionOrgWithConfirmedFacts(clients, fixtures, 1, fund);
    const settled = await runExecution(org);

    const snapshot = settled.status?.recalledMemories;
    expect(snapshot?.enabled).toBe(true);
    expect(snapshot?.facts).toHaveLength(1);

    const report = settled.status?.recalledMemoriesReport;
    expect(report).toBeDefined();
    expect(report?.selectionActive).toBe(false);
    expect(report?.injectedMemoryIds ?? []).toHaveLength(0);
    expect(report?.embeddingModel ?? "").toBe("");

    // Below the threshold the runner must not even TRY to embed.
    const embedAttempts = mock.requests().filter((r) => r.path.includes("/embeddings"));
    expect(embedAttempts).toHaveLength(0);
  });

  it.skipIf(!capabilities.firstPartyMemoryCapture)("degrades to wholesale above the threshold when no embedder is reachable — never a failed execution", async () => {
    const { org } = await provisionOrgWithConfirmedFacts(clients, fixtures, RETRIEVAL_ACTIVATION_THRESHOLD + 1, fund);
    const settled = await runExecution(org);

    // The candidate set is intact on the status snapshot — selection never rewrites
    // the audit snapshot, and here it could not select at all.
    expect(settled.status?.recalledMemories?.facts).toHaveLength(
      RETRIEVAL_ACTIVATION_THRESHOLD + 1,
    );

    // The embeddings attempt hit the (embedder-less) proxy and was refused;
    // the execution completed anyway on the full snapshot, honestly
    // reported. This is the no-embedder deployment posture: OSS
    // operators without an OpenAI credential run Phase 2 behavior forever.
    const embedAttempts = mock.requests().filter((r) => r.path.includes("/embeddings"));
    expect(embedAttempts).toHaveLength(1);

    const report = settled.status?.recalledMemoriesReport;
    expect(report).toBeDefined();
    expect(report?.selectionActive).toBe(false);
    expect(report?.injectedMemoryIds ?? []).toHaveLength(0);
    expect(report?.embeddingModel ?? "").toBe("");
  });

  it.skipIf(!capabilities.firstPartyMemoryCapture)("writes no report when recall is disabled — absent report = wholesale by construction", async () => {
    // Memory switched OFF: the compose step stamps a disabled snapshot,
    // the runner injects nothing, and the report field must stay ABSENT so
    // pre-3a executions and no-injection executions read identically.
    const org = await clients.organizationCommand.create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: uniqueName("retrorg") },
      spec: { preferences: { memoryEnabled: false } },
    });
    fixtures.defer(() => clients.organizationCommand.delete({ value: org.metadata!.id }));
    await fund(org.metadata!.slug);

    const settled = await runExecution(org.metadata!.slug);

    expect(settled.status?.recalledMemories?.enabled ?? false).toBe(false);
    expect(settled.status?.recalledMemoriesReport).toBeUndefined();
  });
});
