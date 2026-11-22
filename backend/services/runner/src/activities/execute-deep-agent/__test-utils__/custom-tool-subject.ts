/**
 * The Stigmer engine as a subject of the custom-tool contract
 * (`__test-utils__/custom-tool-contract/contract.ts`): the whole
 * `ExecuteDeepAgent` activity over the scripted model, on the durable
 * (sqlite) checkpointer, so a resume reads the graph's own save as a
 * runner on another machine would. Each invocation builds its activity
 * afresh (`hermetic-deep-agent.ts` `runDeepAgentTurn`). The model's script
 * is the case's steps, by the agent asking: the main agent's, or the
 * helper's, told apart by the helper's instructions in the system prompt.
 * What the model read for each call is taken from the tool messages each
 * request carries.
 */

import { mkdirSync } from "node:fs";
import type { BaseMessage } from "@langchain/core/messages";
import { ApprovalMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { savedAgentFixture } from "../../../__test-utils__/execution-record-fixture.js";
import type { ScriptedClock, HermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { FORM_TOOL, FORM_TOOL_DECLARATION, type ContractCall, type ContractRun, type ContractScenario, type CustomToolSubject, type ModelRead } from "../../../__test-utils__/custom-tool-contract/contract.js";
import { HOST_ERROR_PREFIX } from "../custom-tools.js";
import { beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn, sessionWorkspaceDir } from "./hermetic-deep-agent.js";
import type { ScriptedToolCall, ScriptedTurn } from "./scripted-model.js";

/** The helper's instructions, which tell its requests apart. */
const HELPER_INSTRUCTIONS = "You are the registration helper.";

function scriptedCall(call: ContractCall, toolName: string): ScriptedToolCall {
  return call.kind === "custom"
    ? { id: call.id, name: toolName, args: call.input }
    : { id: call.id, name: "task", args: { description: "Register the service.", subagent_type: "helper" } };
}

/** A player over a transcript: the next step whose calls the transcript has not issued, then the closing. */
function player(steps: readonly (readonly ContractCall[])[], closing: string, read: Map<string, ModelRead>, toolName: string = FORM_TOOL.name): (transcript: readonly BaseMessage[]) => ScriptedTurn {
  return (transcript) => {
    const issued = new Set<string>();
    for (const message of transcript) {
      if (message.getType() === "ai") for (const call of (message as unknown as { tool_calls?: { id?: string }[] }).tool_calls ?? []) issued.add(call.id ?? "");
      if (message.getType() === "tool") {
        const tool = message as unknown as { tool_call_id: string; content: unknown; status?: string };
        read.set(tool.tool_call_id, { text: String(tool.content), isError: tool.status === "error" });
      }
    }
    const next = steps.find((step) => step.every((call) => !issued.has(call.id)));
    return next === undefined ? { text: closing } : { toolCalls: next.map((call) => scriptedCall(call, toolName)) };
  };
}

/** The subject, with or without a computer for the conversation. */
export function stigmerCustomToolSubject(env: HermeticEnvironment, clock: ScriptedClock, computer: Computer | undefined, label: string): CustomToolSubject {
  return {
    engine: label,
    oneDeferralPerInvocation: false,
    reachesUnofferedTools: false,
    modelName: (tool) => tool,
    hostErrorRead: (text) => ({ text: `${HOST_ERROR_PREFIX}${text}`, isError: true }),
    async begin(scenario: ContractScenario): Promise<ContractRun> {
      clock.reset();
      const helper = scenario.helper;
      const record = deepAgentExecutionRecord({
        message: scenario.message,
        customTools: [{ ...FORM_TOOL_DECLARATION, name: scenario.toolName ?? FORM_TOOL.name }],
        ...(computer !== undefined ? { computer } : {}),
        ...(scenario.unattended === true ? { approvalMode: ApprovalMode.UNATTENDED } : {}),
        ...(scenario.agentTools !== undefined ? { tools: [...scenario.agentTools] } : {}),
        // A conversation without a computer lists only subagents without one.
        ...(helper !== undefined
          ? { subagents: [savedAgentFixture("helper", { description: "Registers services.", instructions: HELPER_INSTRUCTIONS, ...(computer === Computer.NONE ? { computer } : {}) })] }
          : {}),
      });
      const read = new Map<string, ModelRead>();
      let mainTools: readonly string[] = [];
      let helperTools: readonly string[] = [];
      const scenarioRun = beginDeepAgentScenario({
        env,
        clock,
        record,
        checkpointer: "sqlite",
        script: (tools, context) => {
          if (helper !== undefined && context.systemPrompt.includes(HELPER_INSTRUCTIONS)) {
            if (helperTools.length === 0) helperTools = [...tools];
            return player(helper.calls.length === 0 ? [] : [helper.calls], helper.closing, read);
          }
          if (mainTools.length === 0) mainTools = [...tools];
          return player(scenario.steps, scenario.closing, read, scenario.toolName);
        },
      });
      mkdirSync(sessionWorkspaceDir(env), { recursive: true });
      let outcome = await runDeepAgentTurn(scenarioRun, { turnSeq: 0 });
      let turnSeq = 0;
      return {
        record,
        phase: () => String((outcome.outcome as { value?: Record<string, unknown> }).value?.phase),
        offeredToMain: () => mainTools,
        offeredToHelper: () => helperTools,
        modelRead: (callId) => read.get(callId),
        async resume() {
          turnSeq += 1;
          outcome = await runDeepAgentTurn(scenarioRun, { turnSeq });
        },
      };
    },
  };
}
