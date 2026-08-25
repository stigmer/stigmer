// Conformance suite for the semantic memory retriever's deployment posture
// (stigmer/stigmer#293 Phase 3a, DD-008).
// Domain: agentic / agentexecution — the runner-side selection of recalled
// memories, observed through the RecalledMemoriesReport on execution status.
//
// The conformance environment runs with NO embeddings-capable provider (the
// mock proxy speaks only Anthropic and fences every other provider path with
// a 500), which is exactly the deployment posture DD-008 D4 names for
// Anthropic-only and Cursor-only OSS operators. The cross-edition property
// pinned here is therefore CREDENTIAL PRESENCE, not edition: both editions
// run the same runner code, and without an embedder every execution injects
// the full candidate set (Phase 2 behavior, unchanged) with an honest
// selection_active=false report — never a failed or degraded execution.
//
// Capability split: seeding memories requires the first-party capture gate
// (firstPartyMemoryCapture, targets/target.ts) — the cloud conformance user
// is a PlatformClient-minted token that structurally cannot capture, so the
// scenario is buildable only on local-execution. The capture-gate
// refusal itself is pinned in the CRUD-level memory suite.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
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
import { makeMemory } from "../support/memories";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

// Lockstep pin for the runner's activation threshold (RETRIEVAL_K in
// backend/services/runner/src/shared/memory-retrieval.ts): selection
// attempts (and here, degrades) only ABOVE this many confirmed facts.
const RETRIEVAL_ACTIVATION_THRESHOLD = 20;

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

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

// An org with the memory switch ON (org flag alone gates OSS recall — the
// single-user subject sentinel), plus `count` facts run through the REAL
// consent lifecycle: captured via create, confirmed via the consent RPC.
async function provisionOrgWithConfirmedFacts(count: number): Promise<string> {
  const org = await clients.organizationCommand.create({
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: uniqueName("retrorg") },
    spec: { preferences: { memoryEnabled: true } },
  });
  fixtures.defer(() => clients.organizationCommand.delete({ value: org.metadata!.id }));
  const slug = org.metadata!.slug;

  for (let i = 0; i < count; i += 1) {
    const memory = await clients.memoryCommand.create(
      makeMemory(slug, { content: `Durable fact number ${i} about this user.` }),
    );
    fixtures.defer(async () => {
      try {
        await clients.memoryCommand.delete({ value: memory.metadata!.id });
      } catch {
        // Removed with the org.
      }
    });
    await clients.memoryCommand.confirm({ value: memory.metadata!.id });
  }
  return slug;
}

// One completed execution in `org`, with a single scripted agent turn.
async function runExecution(org: string) {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  mock.enqueue(anthropicText("Done."));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("aex"), agentId: agent.metadata!.id }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));

  const settled = await awaitTerminal(clients, execution.metadata!.id);
  expect(settled.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  return settled;
}

describe("AgentExecution memory retrieval (no-embedder posture)", () => {
  it("injects wholesale below the threshold with an honest report and no embeddings attempt", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await provisionOrgWithConfirmedFacts(1);
    const settled = await runExecution(org);

    const snapshot = settled.spec?.recalledMemories;
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

  it("degrades to wholesale above the threshold when no embedder is reachable — never a failed execution", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await provisionOrgWithConfirmedFacts(RETRIEVAL_ACTIVATION_THRESHOLD + 1);
    const settled = await runExecution(org);

    // The candidate set is intact on the spec — selection never rewrites
    // the audit snapshot, and here it could not select at all.
    expect(settled.spec?.recalledMemories?.facts).toHaveLength(
      RETRIEVAL_ACTIVATION_THRESHOLD + 1,
    );

    // The embeddings attempt hit the (embedder-less) proxy and was refused;
    // the execution completed anyway on the full snapshot, honestly
    // reported. This is DD-008's no-embedder deployment posture: OSS
    // operators without an OpenAI credential run Phase 2 behavior forever.
    const embedAttempts = mock.requests().filter((r) => r.path.includes("/embeddings"));
    expect(embedAttempts).toHaveLength(1);

    const report = settled.status?.recalledMemoriesReport;
    expect(report).toBeDefined();
    expect(report?.selectionActive).toBe(false);
    expect(report?.injectedMemoryIds ?? []).toHaveLength(0);
    expect(report?.embeddingModel ?? "").toBe("");
  });

  it("writes no report when recall is disabled — absent report = wholesale by construction", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

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

    const settled = await runExecution(org.metadata!.slug);

    expect(settled.spec?.recalledMemories?.enabled ?? false).toBe(false);
    expect(settled.status?.recalledMemoriesReport).toBeUndefined();
  });
});
