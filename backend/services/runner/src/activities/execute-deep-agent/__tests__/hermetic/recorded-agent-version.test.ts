/**
 * Hermetic pin: a turn runs the AGENT VERSION IT RECORDED, through the whole
 * `ExecuteDeepAgent` activity. The control plane stamps the agent and its
 * version on the execution at create (`status.agent_id`,
 * `agent_version_hash`); the runner reads that version's spec through
 * `getAgentVersion` (`shared/blueprint-resolver.ts`), never the agent's
 * live head.
 *
 * Invariants pinned:
 *   - an author saving a new version after the turn was created changes
 *     nothing about it: the model meets the recorded version's
 *     instructions, and the head is never read;
 *   - a recorded version that no longer resolves fails the turn before any
 *     model is built, with the version named in `status.error`: running the
 *     head instead would run, and record, something nobody asked for.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { AgentVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type ExecutionRecord,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";

const RECORDED_HASH = "3f2a".padEnd(64, "0");
const RECORDED_INSTRUCTIONS = "You review pull requests. Version the turn recorded.";
const HEAD_INSTRUCTIONS = "You review pull requests. A version saved after the turn was created.";
const ANSWER = "Reviewed.";

/** Stamps the agent and version on the record's execution, as ResolveRunAgent does at create. */
function recordVersion(record: ExecutionRecord, versionHash: string): string {
  const agentId = record.agent!.metadata!.id;
  record.execution.status ??= create(AgentExecutionStatusSchema);
  record.execution.status.agentId = agentId;
  record.execution.status.agentVersionHash = versionHash;
  return agentId;
}

describe("ExecuteDeepAgent hermetic — the recorded agent version", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("runs the recorded version's instructions after the head moved, never reading the head", async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Review this.", instructions: HEAD_INSTRUCTIONS });
    const agentId = recordVersion(record, RECORDED_HASH);
    const systemPrompts: string[] = [];
    const versionRead = vi.fn(async () =>
      create(AgentVersionEntrySchema, {
        versionHash: RECORDED_HASH,
        specSnapshot: { instructions: RECORDED_INSTRUCTIONS },
      }),
    );
    const headRead = vi.fn(async () => {
      throw new Error("the head must not be read");
    });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      clientOverrides: { getAgentVersion: versionRead, getAgent: headRead },
      script: (_tools, context) => {
        systemPrompts.push(context.systemPrompt);
        return { turns: [{ text: ANSWER, usage: { inputTokens: 900, outputTokens: 20 } }] };
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_COMPLETED]);
    expect(versionRead).toHaveBeenCalledWith(agentId, RECORDED_HASH);
    expect(headRead).not.toHaveBeenCalled();
    expect(systemPrompts).toHaveLength(1);
    expect(systemPrompts[0]).toContain(RECORDED_INSTRUCTIONS);
    expect(systemPrompts[0]).not.toContain(HEAD_INSTRUCTIONS);
  });

  it("fails before any model is built, naming the version, when the recorded version no longer resolves", async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Review this.", instructions: HEAD_INSTRUCTIONS });
    const agentId = recordVersion(record, RECORDED_HASH);
    const headRead = vi.fn(async () => {
      throw new Error("the head must not be read");
    });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      clientOverrides: {
        getAgentVersion: vi.fn(async () => {
          throw new ConnectError("agent version not found", Code.NotFound);
        }),
        getAgent: headRead,
      },
      script: () => {
        throw new Error("the model must never be asked when the recorded version is gone");
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind, "a deterministic failure RETURNS").toBe("returned");
    expect(record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_FAILED]);
    const final = record.lastFullStatus!;
    expect(final.error).toContain(`agent ${agentId}, version ${RECORDED_HASH}`);
    expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM)).toHaveLength(2);
    expect(headRead).not.toHaveBeenCalled();
    expect(recordedModelBuilds(), "no model was built").toHaveLength(0);
    expect(record.setupProgress).toEqual(["Fetching execution", "Resolving agent blueprint"]);
  });
});
