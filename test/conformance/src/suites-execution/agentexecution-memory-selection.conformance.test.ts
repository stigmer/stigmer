// Conformance suite for the semantic memory retriever WITH an embedder present
// (stigmer/stigmer#293 Phase 3a, DD-008) — the selection-active posture.
// Domain: agentic / agentexecution — the runner-side selection of recalled
// memories, observed through the RecalledMemoriesReport on execution status
// and through the one embeddings call the retriever makes.
//
// agentexecution-memory-retrieval.conformance.test.ts pins the NO-embedder
// posture (the mock fences the OpenAI path, the retriever degrades to wholesale
// with an honest report). This file flips the mock's embeddings posture on
// (MockLlmProxy.serveEmbeddings, computed vectors — header of mock-llm.ts) and
// pins the other half of DD-008: at the activation threshold the retriever
// injects wholesale and never calls the embedder; above it, it makes exactly
// ONE batched embeddings call (the query first, then every candidate in
// snapshot order), ranks by cosine, and injects the top k — which under the
// mock's deterministic vectors is exactly the first k facts of the snapshot,
// in order. Both editions run the same runner, so the property is
// edition-neutral; the capability gate is on SEEDING memories, which only the
// first-party capture lane can do (targets/target.ts firstPartyMemoryCapture).
//
// DD-001 of entry 20260910.02; replaces the two embedder-posture subtests of
// the Go offline suite's memory_retrieval_offline_test.go (rows 65–66). The
// opted-out-member subtest is cloud IAM vocabulary and is covered there
// (ruling 5).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { provisionOrgWithConfirmedFacts } from "../support/memories";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

// Lockstep pins for the runner's retriever (shared/memory-retrieval.ts):
// RETRIEVAL_K is the activation threshold AND the injection count; the model
// is the one embeddings model the retriever asks the proxy for.
const RETRIEVAL_ACTIVATION_THRESHOLD = 20;
const RETRIEVAL_EMBEDDING_MODEL = "text-embedding-3-small";

// Collection-time gate (the billing-gates idiom): capabilities are static per
// target, so the describe can be skipped before any target is booted.
const canSeedMemories = createTarget().capabilities.firstPartyMemoryCapture;

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  // The embedder posture for this whole file (never reset per test).
  mock.serveEmbeddings(true);
});

afterEach(async () => {
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

const QUERY = "What do you remember about me?";

// One completed execution in `org` asking the retriever's query, one scripted turn.
async function runExecution(org: string): Promise<AgentExecution> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  mock.enqueue(anthropicText("Done."));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("aex"), agentId: agent.metadata!.id, message: QUERY }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));

  const settled = await awaitTerminal(clients, execution.metadata!.id);
  expect(settled.status?.phase, `status.error: ${JSON.stringify(settled.status?.error ?? "")}`).toBe(
    ExecutionPhase.EXECUTION_COMPLETED,
  );
  return settled;
}

describe.skipIf(!canSeedMemories)(
  "AgentExecution memory retrieval (embedder posture)",
  () => {
    it("at the threshold with an embedder present: wholesale, no embeddings call, selection_active false", async () => {
      const { org } = await provisionOrgWithConfirmedFacts(clients, fixtures, RETRIEVAL_ACTIVATION_THRESHOLD);
      const settled = await runExecution(org);

      expect(settled.spec?.recalledMemories?.enabled).toBe(true);
      expect(settled.spec?.recalledMemories?.facts).toHaveLength(RETRIEVAL_ACTIVATION_THRESHOLD);
      const report = settled.status?.recalledMemoriesReport;
      expect(report, "a recall-enabled execution writes a report").toBeDefined();
      expect(report?.selectionActive, "at or below k, top-k degenerates to wholesale").toBe(false);
      expect(report?.injectedMemoryIds ?? []).toHaveLength(0);
      expect(report?.embeddingModel ?? "").toBe("");
      expect(mock.embeddingsRequests(), "the retriever never called the embedder").toHaveLength(0);
    });

    it("above the threshold: exactly one batched embeddings call, and the first k facts injected in snapshot order", async () => {
      const { org } = await provisionOrgWithConfirmedFacts(clients, fixtures, RETRIEVAL_ACTIVATION_THRESHOLD + 1);
      const settled = await runExecution(org);

      const snapshot = settled.spec?.recalledMemories?.facts ?? [];
      expect(snapshot, "the candidate set is intact on the spec — selection never rewrites the audit snapshot").toHaveLength(
        RETRIEVAL_ACTIVATION_THRESHOLD + 1,
      );

      const report = settled.status?.recalledMemoriesReport;
      expect(report, "selection-active executions write a report").toBeDefined();
      expect(report?.selectionActive).toBe(true);
      expect(report?.embeddingModel).toBe(RETRIEVAL_EMBEDDING_MODEL);
      // The mock's vectors make similarity to the query strictly decrease with
      // position, so top-k is exactly the snapshot's first k, in order.
      expect(report?.injectedMemoryIds).toEqual(
        snapshot.slice(0, RETRIEVAL_ACTIVATION_THRESHOLD).map((fact) => fact.memoryId),
      );

      const calls = mock.embeddingsRequests();
      expect(calls, "exactly one batched embeddings call per selection-active execution").toHaveLength(1);
      expect(calls[0]!.model).toBe(RETRIEVAL_EMBEDDING_MODEL);
      expect(calls[0]!.input, "the query first, then every candidate").toHaveLength(RETRIEVAL_ACTIVATION_THRESHOLD + 2);
      expect(calls[0]!.input[0]).toBe(QUERY);
    });
  },
);
