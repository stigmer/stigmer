// Conformance suite for the agent version a turn runs (Class B).
// Domain: agentic / agentexecution — status.agent_id and agent_version_hash.
//
// Every turn records, at create, the agent it runs and the exact version of
// it (the agent's status.version_hash at that moment), and every reader takes
// that record: the server's context build, on create and on recover, and the
// runner's blueprint hydration. So an author saving a new version of the agent
// after the turn was created never changes what the turn runs.
//
// Asserted contract:
// - a created turn records its agent's id and current version; the fields are
//   the server's alone, so a value the client sends for either never survives;
// - a FAILED turn recovered after its agent's author saved a new version runs
//   the version it recorded: the model receives the recorded instructions, not
//   the new ones. Recover is the deterministic window — the turn was created,
//   the agent changed, and only then does the runner hydrate again — so it
//   proves the server and the runner read the record, not the agent's head.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitPhase, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

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

const RECORDED = "Recorded version: answer every question in the voice of a lighthouse keeper.";
const SAVED_LATER = "Saved later: answer every question in the voice of a ship's cook.";

describe("AgentExecution — the agent version a turn runs", () => {
  it("[rpc:AgentExecutionCommandController.create] a turn records its agent and the version it started on; a client-sent value never survives", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-version") }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    mock.enqueue(anthropicText("Done."));

    const created = await clients.agentExecutionCommand.create({
      ...makeAgentExecution({ org, name: uniqueName("aex-version"), agentId: agent.metadata!.id }),
      status: { agentId: "agt_forged", agentVersionHash: "f".repeat(64) },
    });
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));

    expect(created.status?.agentId).toBe(agent.metadata!.id);
    expect(created.status?.agentVersionHash).toBe(agent.status!.versionHash);
    const completed = await awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_COMPLETED);
    expect(completed.status?.agentId, "the runner's status writes leave the record as it was").toBe(agent.metadata!.id);
    expect(completed.status?.agentVersionHash).toBe(agent.status!.versionHash);
  });

  it("[rpc:AgentExecutionCommandController.recover] a turn recovered after its agent's author saved a new version runs the version it recorded", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent-version-recover");
    const v1 = await clients.agentCommand.apply(makeAgent({ org, name, instructions: RECORDED }));
    fixtures.defer(() => clients.agentCommand.delete({ value: v1.metadata!.id }));

    mock.enqueueError(400);
    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-version-recover"), agentId: v1.metadata!.id }),
    );
    const executionId = created.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
    await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_FAILED);

    const v2 = await clients.agentCommand.apply(makeAgent({ org, name, instructions: SAVED_LATER }));
    expect(v2.status?.versionHash, "the author's save is a new version").not.toBe(v1.status?.versionHash);

    mock.enqueue(anthropicText("Recovered."));
    await clients.agentExecutionCommand.recover({ id: executionId });
    const completed = await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_COMPLETED);

    expect(completed.status?.agentVersionHash).toBe(v1.status?.versionHash);
    const system = JSON.stringify((mock.scriptedRequests().at(-1)?.body as { system?: unknown } | undefined)?.system ?? "");
    expect(system, "the recovered turn's model met the recorded instructions").toContain(RECORDED);
    expect(system, "and never the ones saved after the turn was created").not.toContain(SAVED_LATER);
  });
});
