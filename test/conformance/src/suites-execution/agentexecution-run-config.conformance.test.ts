// Conformance suite for the settings a turn runs with (Class B).
// Domain: agentic / agentexecution — status.run_config and status.approval_mode.
//
// The contract under test (RunConfig in agentexecution/v1/invocation.proto,
// AgentExecutionStatus.run_config and approval_mode in api.proto): the server
// resolves a turn's settings once, at create, from the message
// (spec.run_config), the defaults of the agent version the turn runs
// (AgentSpec.run_config, on the engine AgentSpec.harness names) and the lane's
// operator profile, and records them on the turn's status:
//
//   - a choice comes from the most specific layer that makes one: an agent's
//     default model runs when the message names none, and reaches the
//     provider; a message's model wins for that message alone;
//   - a message may set thinking alone, to turn the agent's thinking off for
//     its model;
//   - a bound is the tightest any layer sets: a message cannot raise the
//     agent's cap;
//   - on a conversation running the other engine, the agent's choices are
//     left out and its caps still apply;
//   - a conversation pinned to a version keeps that version's defaults after
//     the author saves another;
//   - a client-sent status run_config or approval mode never survives create;
//     an interactive turn records INTERACTIVE.
//
// The schedule lane (its profile and UNATTENDED) is pinned by the
// schedule-firing suite, and the resolution's full table beside its code
// (resolve-run-config.test.ts).
import { ApprovalMode, RunPhase, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { requireRegistryRow } from "../harness/model-registry";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { AGENT_API_VERSION, AGENT_KIND, agentRefOf, makeAgent, makeAgentSpec } from "../support/agents";
import {
  type AgentExecutionOptions,
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  sessionIdOf,
} from "../support/agentruns";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

// Two native registry ids whose provider ids differ from them and from each
// other, so the model a turn ran is read off the wire.
const AGENT_MODEL = "claude-haiku-4.5";
const MESSAGE_MODEL = "claude-sonnet-4.6";

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
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

async function providerIdOf(registryId: string): Promise<string> {
  if (target.modelRegistryDocument === undefined) {
    throw new Error(`target ${target.name} exposes no model registry document; execution targets must`);
  }
  const row = requireRegistryRow(await target.modelRegistryDocument(), registryId);
  return row.apiModelId ?? row.id;
}

async function agentWithDefaults(
  org: string,
  defaults: Pick<Parameters<typeof makeAgent>[0], "harness" | "runConfig">,
): Promise<Agent> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-defaults"), ...defaults }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

async function turn(options: Omit<AgentExecutionOptions, "name">): Promise<AgentRun> {
  mock.enqueue(anthropicText("Done."));
  const created = await clients.agentExecutionCommand.create(
    makeAgentExecution({ name: uniqueName("aex-settings"), autoApproveAll: true, ...options }),
  );
  const id = created.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: id }));
  const final = await awaitTerminal(clients, id);
  expect(
    final.status?.phase,
    `execution ${id} should complete; reached ${RunPhase[final.status?.phase ?? 0]} (error: ${final.status?.error ?? ""})`,
  ).toBe(RunPhase.RUN_COMPLETED);
  return final;
}

describe("AgentExecution — the settings a turn runs with", () => {
  it("[rpc:AgentExecutionCommandController.create] runs the agent's default model when the message names none, and records it", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentWithDefaults(org, {
      harness: Harness.NATIVE,
      runConfig: { modelName: AGENT_MODEL, maxCostUsd: 2 },
    });

    const final = await turn({ org, agentRef: agentRefOf(agent) });

    expect(final.status?.runConfig?.modelName).toBe(AGENT_MODEL);
    expect(final.status?.runConfig?.maxCostUsd).toBe(2);
    expect(final.status?.approvalMode).toBe(ApprovalMode.INTERACTIVE);
    expect(final.spec?.runConfig, "the request records only what the message asked for").toBeUndefined();
    expect(mock.requestModels()).toContain(await providerIdOf(AGENT_MODEL));
  });

  it("[rpc:AgentExecutionCommandController.create] a message's model wins for that message, and a message cannot raise the agent's cap", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentWithDefaults(org, {
      harness: Harness.NATIVE,
      runConfig: { modelName: AGENT_MODEL, maxCostUsd: 2 },
    });

    const final = await turn({
      org,
      agentRef: agentRefOf(agent),
      runConfig: { modelName: MESSAGE_MODEL, maxCostUsd: 10 },
    });

    expect(final.status?.runConfig?.modelName).toBe(MESSAGE_MODEL);
    expect(final.status?.runConfig?.maxCostUsd).toBe(2);
    expect(mock.requestModels()).toContain(await providerIdOf(MESSAGE_MODEL));
  });

  it("[rpc:AgentExecutionCommandController.create] a message turns the agent's thinking off for the agent's model", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentWithDefaults(org, {
      harness: Harness.NATIVE,
      runConfig: { modelName: AGENT_MODEL, thinkingMode: ThinkingMode.ENABLED },
    });

    const final = await turn({
      org,
      agentRef: agentRefOf(agent),
      runConfig: { thinkingMode: ThinkingMode.DISABLED },
    });

    expect(final.status?.runConfig?.modelName).toBe(AGENT_MODEL);
    expect(final.status?.runConfig?.thinkingMode).toBe(ThinkingMode.DISABLED);
  });

  it("[rpc:AgentExecutionCommandController.create] on the other engine the agent's model is left out and its cap applies", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentWithDefaults(org, {
      harness: Harness.CURSOR,
      runConfig: { modelName: "composer-2.5", maxCostUsd: 1 },
    });

    const final = await turn({ org, agentRef: agentRefOf(agent), sessionSpec: { harness: Harness.NATIVE } });

    expect(final.status?.runConfig?.modelName).toBe("");
    expect(final.status?.runConfig?.maxCostUsd).toBe(1);
  });

  it("[rpc:AgentExecutionCommandController.create] a conversation keeps its version's defaults after the author saves another", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentWithDefaults(org, {
      harness: Harness.NATIVE,
      runConfig: { modelName: AGENT_MODEL },
    });
    const first = await turn({ org, agentRef: agentRefOf(agent) });

    const { id, name, slug } = agent.metadata!;
    await clients.agentCommand.update({
      apiVersion: AGENT_API_VERSION,
      kind: AGENT_KIND,
      metadata: { id, name, slug, org },
      spec: makeAgentSpec({ harness: Harness.NATIVE, runConfig: { modelName: MESSAGE_MODEL } }),
    });
    const second = await turn({ org, sessionId: sessionIdOf(first) });

    expect(second.status?.runConfig?.modelName).toBe(AGENT_MODEL);
  });

  it("[rpc:AgentExecutionCommandController.create] a client-sent status run_config or approval mode never survives create", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentWithDefaults(org, { runConfig: { maxCostUsd: 2 } });
    mock.enqueue(anthropicText("Done."));
    const request = makeAgentExecution({ org, name: uniqueName("aex-forged"), agentRef: agentRefOf(agent), autoApproveAll: true });

    const created = await clients.agentExecutionCommand.create({
      ...request,
      status: {
        runConfig: { modelName: "forged", maxCostUsd: 999 },
        approvalMode: ApprovalMode.UNATTENDED,
      },
    });
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));

    expect(created.status?.runConfig?.modelName).toBe("");
    expect(created.status?.runConfig?.maxCostUsd).toBe(2);
    expect(created.status?.approvalMode).toBe(ApprovalMode.INTERACTIVE);
    await awaitTerminal(clients, created.metadata!.id);
  });
});
