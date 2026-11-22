/**
 * The Claude engine as a subject of the custom-tool contract
 * (`__test-utils__/custom-tool-contract/contract.ts`): the real
 * `ExecuteClaude` activity and the real engine against the wire-level mock
 * (`hermetic-claude.ts`), one scenario file's stack shared by every case.
 * The model's script is the case's steps, by the agent asking: the main
 * agent's, or the helper's, told apart by the helper's instructions in the
 * system prompt.
 */

import { ApprovalMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { savedAgentFixture } from "../../../__test-utils__/execution-record-fixture.js";
import type { ContractCall, ContractRun, ContractScenario, CustomToolSubject, ModelRead } from "../../../__test-utils__/custom-tool-contract/contract.js";
import { FORM_TOOL, FORM_TOOL_DECLARATION } from "../../../__test-utils__/custom-tool-contract/contract.js";
import { customToolEngineName } from "../../../shared/custom-tools.js";
import { anthropicText, anthropicToolUses, type WireConversation, type WireScript } from "./claude-wire.js";
import { FIXTURE, claudeExecutionRecord, type ClaudeScenarioFile } from "./hermetic-claude.js";

/** The helper's instructions, which tell its requests apart. */
const HELPER_INSTRUCTIONS = "You are the registration helper.";

/** One call as the engine's model makes it. */
function engineCall(call: ContractCall): { toolCallId: string; toolName: string; toolInput: Record<string, unknown> } {
  return call.kind === "custom"
    ? { toolCallId: call.id, toolName: customToolEngineName(FORM_TOOL.name), toolInput: call.input }
    : { toolCallId: call.id, toolName: "Agent", toolInput: { description: "Register the service.", prompt: "Register the service.", subagent_type: "helper" } };
}

/** Each step once, in order (a step is done once the conversation issued all its calls), then the closing. */
function steps(list: readonly (readonly ContractCall[])[], closing: string): WireScript {
  return (c: WireConversation) => {
    const next = list.find((step) => step.every((call) => !c.issued.has(call.id)));
    return next === undefined ? anthropicText(closing) : anthropicToolUses(next.map(engineCall));
  };
}

/** The subject over a started scenario file. */
export function claudeCustomToolSubject(file: () => ClaudeScenarioFile): CustomToolSubject {
  return {
    engine: "claude",
    oneDeferralPerInvocation: true,
    reachesUnofferedTools: true,
    modelName: (tool) => customToolEngineName(tool),
    async begin(scenario: ContractScenario): Promise<ContractRun> {
      const helper = scenario.helper;
      const record = claudeExecutionRecord({
        message: scenario.message,
        customTools: [FORM_TOOL_DECLARATION],
        ...(scenario.unattended === true ? { approvalMode: ApprovalMode.UNATTENDED } : {}),
        ...(scenario.agentTools !== undefined ? { tools: [...scenario.agentTools] } : {}),
        ...(helper !== undefined
          ? { subagents: [savedAgentFixture("helper", { description: "Registers services.", instructions: HELPER_INSTRUCTIONS }, FIXTURE.org)] }
          : {}),
      });
      const main = steps(scenario.steps, scenario.closing);
      const helperScript = helper === undefined ? undefined : steps([helper.calls], helper.closing);
      const script: WireScript = (c) => (helperScript !== undefined && c.system.includes(HELPER_INSTRUCTIONS) ? helperScript(c) : main(c));
      // A run starts the wire's record of conversations afresh, and each resume adds to it.
      let outcome = await file().run(record, script);
      let turnSeq = 0;
      const conversations = (): WireConversation[] => file().wire().conversations;
      return {
        record,
        phase: () => String((outcome.outcome as { value?: Record<string, unknown> }).value?.phase),
        offeredToMain: () => conversations().find((c) => !c.system.includes(HELPER_INSTRUCTIONS))?.toolNames ?? [],
        offeredToHelper: () => conversations().find((c) => c.system.includes(HELPER_INSTRUCTIONS))?.toolNames ?? [],
        modelRead: (callId): ModelRead | undefined => {
          const read = [...conversations()].reverse().find((c) => c.toolResults.has(callId))?.toolResults.get(callId);
          return read === undefined ? undefined : { text: read.text.replace(/\n*<system-reminder>[\s\S]*<\/system-reminder>\s*$/, ""), isError: read.isError };
        },
        async resume() {
          turnSeq += 1;
          outcome = await file().resume(record, script, { turnSeq });
        },
      };
    },
  };
}
