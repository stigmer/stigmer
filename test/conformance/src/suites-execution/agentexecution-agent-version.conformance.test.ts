// Conformance suite for the agent version a turn runs (Class B).
// Domain: agentic / agentexecution — status.agent_id and agent_version_hash,
// and the session pin they are taken from.
//
// A conversation pins its agent and the exact version of it on the session
// (SessionStatus.agent_id, agent_version_hash): the version its agent_ref
// names (a tag or a content hash), or the agent's head when it names none.
// Every turn records, at create, the session's pin, and every reader takes
// that record: the server's context build, on create and on recover, and the
// runner's blueprint hydration. So an author saving a new version of the agent
// never changes what an open conversation runs; the conversation moves to the
// new head only when a session update names `latest` (the console's "update
// to the current version" control).
//
// Asserted contract:
// - a created turn records its agent's id and current version; the fields are
//   the server's alone, so a value the client sends for either never survives;
// - a FAILED turn recovered after its agent's author saved a new version runs
//   the version it recorded: the model receives the recorded instructions, not
//   the new ones. Recover is the deterministic window — the turn was created,
//   the agent changed, and only then does the runner hydrate again — so it
//   proves the server and the runner read the record, not the agent's head;
// - a later turn in a conversation runs the version the conversation pinned,
//   though the author saved a new head in between;
// - a session update naming `latest` re-pins the conversation to the head,
//   and its next turn runs the new version;
// - a new conversation whose agent_ref names a tag runs the tagged version
//   (the share-shaped start: a session_spec carrying a versioned reference);
// - a session created on an agent_ref naming a content hash runs that
//   version on its turns (the channel-shaped start: session create, then a
//   turn in it).
// What the model received is the observable: each version's instructions
// are distinct, and the system prompt of the turn's request names one.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { agentRefOf, makeAgent } from "../support/agents";
import { awaitPhase, makeAgentExecution, requireLlmProxy, sessionIdOf } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
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
      ...makeAgentExecution({ org, name: uniqueName("aex-version"), agentRef: agentRefOf(agent) }),
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
      makeAgentExecution({ org, name: uniqueName("aex-version-recover"), agentRef: agentRefOf(v1) }),
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

// The system prompt of the model request the latest scripted turn sent.
function lastSystemPrompt(): string {
  return JSON.stringify((mock.scriptedRequests().at(-1)?.body as { system?: unknown } | undefined)?.system ?? "");
}

// One text turn `on` a conversation (a new one on an agent reference, or an
// existing session), run to completion.
async function completedTurn(
  org: string,
  label: string,
  on: Pick<Parameters<typeof makeAgentExecution>[0], "agentRef" | "sessionId">,
) {
  mock.enqueue(anthropicText("Done."));
  const created = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName(label), ...on }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));
  return awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_COMPLETED);
}

// An agent saved twice under one name: v1 (RECORDED) then v2 (SAVED_LATER).
async function agentSavedTwice(org: string) {
  const name = uniqueName("agent-pin");
  const v1 = await clients.agentCommand.apply(makeAgent({ org, name, instructions: RECORDED }));
  fixtures.defer(() => clients.agentCommand.delete({ value: v1.metadata!.id }));
  const v2 = await clients.agentCommand.apply(makeAgent({ org, name, instructions: SAVED_LATER }));
  expect(v2.status?.versionHash, "the author's save is a new version").not.toBe(v1.status?.versionHash);
  return { v1, v2 };
}

describe("AgentExecution — a conversation runs the version its session pinned", () => {
  it("[rpc:AgentExecutionCommandController.create] a later turn runs the version the conversation pinned, though the author saved a new head", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent-pin-kept");
    const v1 = await clients.agentCommand.apply(makeAgent({ org, name, instructions: RECORDED }));
    fixtures.defer(() => clients.agentCommand.delete({ value: v1.metadata!.id }));
    const first = await completedTurn(org, "aex-pin-first", { agentRef: agentRefOf(v1) });

    await clients.agentCommand.apply(makeAgent({ org, name, instructions: SAVED_LATER }));
    const second = await completedTurn(org, "aex-pin-second", { sessionId: sessionIdOf(first) });

    expect(second.status?.agentVersionHash, "the second turn runs the pinned version").toBe(v1.status?.versionHash);
    expect(lastSystemPrompt(), "the model met the pinned instructions").toContain(RECORDED);
  });

  it("[rpc:SessionCommandController.update] a session update naming latest re-pins the conversation to the head, and its next turn runs it", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent-pin-latest");
    const v1 = await clients.agentCommand.apply(makeAgent({ org, name, instructions: RECORDED }));
    fixtures.defer(() => clients.agentCommand.delete({ value: v1.metadata!.id }));
    const first = await completedTurn(org, "aex-latest-first", { agentRef: agentRefOf(v1) });
    const v2 = await clients.agentCommand.apply(makeAgent({ org, name, instructions: SAVED_LATER }));

    const sessionId = sessionIdOf(first);
    const session = await clients.sessionQuery.get({ value: sessionId });
    session.spec!.agentRef!.version = "latest";
    const updated = await clients.sessionCommand.update(session);
    expect(updated.status?.agentVersionHash, "latest pins the agent's head").toBe(v2.status?.versionHash);

    const next = await completedTurn(org, "aex-latest-next", { sessionId });
    expect(next.status?.agentVersionHash, "the next turn runs the new head").toBe(v2.status?.versionHash);
    expect(lastSystemPrompt(), "the model met the head's instructions").toContain(SAVED_LATER);
  });

  it("[rpc:AgentExecutionCommandController.create] a new conversation whose agent_ref names a tag runs the tagged version, not the head", async () => {
    const { org } = await target.provisionTenancy();
    const { v1 } = await agentSavedTwice(org);
    await clients.agentCommand.tagVersion({ agentId: v1.metadata!.id, versionHash: v1.status!.versionHash, tag: "stable" });

    const turn = await completedTurn(org, "aex-pin-tag", { agentRef: agentRefOf(v1, "stable") });

    expect(turn.status?.agentVersionHash, "the turn runs the tagged version").toBe(v1.status?.versionHash);
    expect(lastSystemPrompt(), "the model met the tagged version's instructions").toContain(RECORDED);
  });

  it("[rpc:SessionCommandController.create] a session created on an agent_ref naming a content hash runs that version on its turns", async () => {
    const { org } = await target.provisionTenancy();
    const { v1 } = await agentSavedTwice(org);
    const session = await clients.sessionCommand.create(
      makeSession({ org, name: uniqueName("session-pin-hash"), agentRef: agentRefOf(v1, v1.status!.versionHash) }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

    const turn = await completedTurn(org, "aex-pin-hash", { sessionId: session.metadata!.id });

    expect(turn.status?.agentVersionHash, "the turn runs the version the hash names").toBe(v1.status?.versionHash);
    expect(lastSystemPrompt(), "the model met that version's instructions").toContain(RECORDED);
  });
});
