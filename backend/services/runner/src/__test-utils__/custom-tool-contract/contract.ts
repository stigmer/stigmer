/**
 * The host app's own tools (a session's `custom_tools`): the one statement
 * of how every engine treats them, run against each engine's real activity
 * by its hermetic driver ({@link CustomToolSubject}). A behaviour added to
 * one engine and not the other fails here, naming the engine.
 *
 * The invariants (`shared/custom-tools.ts` says why each holds):
 *  1. A declared tool is offered to the main agent under its name.
 *  2. A call whose input matches its schema parks the turn waiting, as an
 *     approval does: one WAITING row marked as the host's, one
 *     `agent.custom_tool_use` in the log under the declared name with the
 *     call's input, no approval asked, and no result of the runner's.
 *  3. The host's answer reaches the model exactly once, as the call's
 *     result: its text, and as an error when the host said the tool failed.
 *     The runner writes no result for it: the host's is the log's.
 *  4. A call whose input does not match is refused to the model with the
 *     shared sentence before anything waits, and nothing reaches the log as
 *     a custom call.
 *  5. Two calls in one step are both answered, each once.
 *  6. An unattended turn (nobody can answer) offers none.
 *  7. The agent's tool lists do not hide it.
 *  8. A helper the main agent delegates to cannot make the host wait.
 *
 * Cases 6 and 8 also make the call where an engine's model can reach a tool
 * it was not offered: the Claude engine keeps one pool of tools for the
 * whole session, a helper's included, so its gate refuses the call. A
 * Stigmer graph binds only what it offers, so there the cases prove the
 * tool is not offered.
 *  9. Every resume runs in a fresh activity and engine process: nothing is
 *     held between the pause and the answer but the log and the engine's
 *     own store.
 */

import type { JsonObject } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { customToolInputProblem } from "@stigmer/tool-vocabulary";

import type { ExecutionRecord } from "../hermetic-activity.js";

/** The tool every case declares. */
export const FORM_TOOL = {
  name: "show_registration_form",
  description: "Open the service registration form beside the chat, prefilled, and return what the person registered.",
  inputSchema: {
    type: "object",
    properties: { service: { type: "string" }, repo: { type: "string" } },
    required: ["service"],
    additionalProperties: false,
  },
} as const;

/** {@link FORM_TOOL} as a session declares it (`SessionSpec.custom_tools`). */
export const FORM_TOOL_DECLARATION: { readonly name: string; readonly description: string; readonly inputSchema: JsonObject } = {
  name: FORM_TOOL.name,
  description: FORM_TOOL.description,
  inputSchema: JSON.parse(JSON.stringify(FORM_TOOL.inputSchema)) as JsonObject,
};

/** One call a script's model makes: of the declared tool, or a delegation to the helper. */
export type ContractCall =
  | { readonly kind: "custom"; readonly id: string; readonly input: Record<string, unknown> }
  | { readonly kind: "delegate"; readonly id: string };

/** What a case runs: the model's steps (each one message of calls), then its closing text. */
export interface ContractScenario {
  readonly message: string;
  readonly steps: readonly (readonly ContractCall[])[];
  readonly closing: string;
  /** The turn's lane has no approver (`status.approval_mode` UNATTENDED). */
  readonly unattended?: boolean;
  /** The agent's own allow-list (`AgentSpec.tools`). */
  readonly agentTools?: readonly string[];
  /** The helper's script, when a step delegates: its calls of the declared tool, then its closing. */
  readonly helper?: { readonly calls: readonly ContractCall[]; readonly closing: string };
}

/** What the model read as one call's result. */
export interface ModelRead {
  readonly text: string;
  readonly isError: boolean;
}

/** One session's run under a subject: the first invocation done, resumable. */
export interface ContractRun {
  readonly record: ExecutionRecord;
  /** The last invocation's settled phase (`RUN_COMPLETED`, `RUN_WAITING_FOR_APPROVAL`, ...). */
  phase(): string;
  /** The tool names the main agent's model was offered on its first request. */
  offeredToMain(): readonly string[];
  /** The tool names the helper's model was offered on its first request; empty when no helper ran. */
  offeredToHelper(): readonly string[];
  /** The last result the model read for a call; undefined when it read none. */
  modelRead(callId: string): ModelRead | undefined;
  /** The session's next invocation of the same run, in a fresh activity and engine process. */
  resume(): Promise<void>;
}

/** One engine under the contract. */
export interface CustomToolSubject {
  readonly engine: string;
  /** The engine pauses one call per invocation (Claude): a second call in a step is refused, and the model asks for it again alone. */
  readonly oneDeferralPerInvocation: boolean;
  /** The engine's model can call a tool it was not offered (the header, cases 6 and 8). */
  readonly reachesUnofferedTools: boolean;
  /** The name the model calls the declared tool by. */
  modelName(tool: string): string;
  /** A fresh session running the scenario's first invocation. */
  begin(scenario: ContractScenario): Promise<ContractRun>;
}

/** The `agent.custom_tool_use` events of the record's log. */
function customUses(record: ExecutionRecord): { readonly id: string; readonly name: string; readonly input: unknown }[] {
  return record.sessionEvents.flatMap((event) =>
    event.event.case === "agentCustomToolUse" ? [{ id: event.event.value.id, name: event.event.value.name, input: event.event.value.input }] : [],
  );
}

/** Whether the log holds a result or an ask the runner wrote for the call's tool use. */
function runnerWroteResultOrAsk(record: ExecutionRecord, useId: string): boolean {
  return record.sessionEvents.some(
    (event) =>
      (event.event.case === "agentToolResult" && event.event.value.toolUseId === useId) ||
      (event.event.case === "agentMcpToolResult" && event.event.value.mcpToolUseId === useId) ||
      (event.event.case === "stigmerPermissionAsked" && event.event.value.toolUseId === useId),
  );
}

/** The record's custom tool use id for a call: its run and the call's id. */
function useIdOf(record: ExecutionRecord, callId: string): string {
  return `${record.executionId}.${callId}`;
}

/** The contract (the header), as one describe block per subject. */
export function describeCustomToolContract(subject: CustomToolSubject): void {
  describe(`custom tools on the ${subject.engine} engine`, () => {
    it("1-3, 9: offered by name; a call parks the turn as the host's, and the answer reaches the model once, in a fresh process", async () => {
      const run = await subject.begin({
        message: "Register the payments service.",
        steps: [[{ kind: "custom", id: "toolu_form", input: { service: "payments", repo: "acme/payments" } }]],
        closing: "Registered.",
      });
      expect(run.offeredToMain(), "offered to the main agent").toContain(subject.modelName(FORM_TOOL.name));

      expect(run.phase()).toBe("RUN_WAITING_FOR_APPROVAL");
      expect(run.record.waitingCustomToolCalls().map((row) => row.id)).toEqual(["toolu_form"]);
      expect(run.record.waitingToolCalls().filter((row) => !row.customTool), "no approval waits").toEqual([]);
      expect(customUses(run.record)).toEqual([expect.objectContaining({ id: useIdOf(run.record, "toolu_form"), name: FORM_TOOL.name, input: { service: "payments", repo: "acme/payments" } })]);
      expect(runnerWroteResultOrAsk(run.record, useIdOf(run.record, "toolu_form")), "no ask, no result of the runner's").toBe(false);
      expect(run.modelRead("toolu_form"), "nothing read before the answer").toBeUndefined();

      run.record.answerCustomToolUse("toolu_form", "registered as svc_payments");
      await run.resume();

      expect(run.phase()).toBe("RUN_COMPLETED");
      expect(run.modelRead("toolu_form")).toEqual({ text: "registered as svc_payments", isError: false });
      expect(customUses(run.record), "the call is written once").toHaveLength(1);
      expect(runnerWroteResultOrAsk(run.record, useIdOf(run.record, "toolu_form")), "the host's answer is the result").toBe(false);
      expect(run.record.waitingToolCalls()).toEqual([]);
    });

    it("3: an answer the host marks failed reaches the model as an error", async () => {
      const run = await subject.begin({
        message: "Register billing.",
        steps: [[{ kind: "custom", id: "toolu_err", input: { service: "billing" } }]],
        closing: "It failed.",
      });
      expect(run.phase()).toBe("RUN_WAITING_FOR_APPROVAL");
      run.record.answerCustomToolUse("toolu_err", "The person closed the form.", true);
      await run.resume();
      expect(run.phase()).toBe("RUN_COMPLETED");
      expect(run.modelRead("toolu_err")).toEqual({ text: "The person closed the form.", isError: true });
    });

    it("4: input that does not match the schema is refused to the model, and nothing waits", async () => {
      const input = { repo: "acme/x", port: 8080 };
      const run = await subject.begin({
        message: "Register it.",
        steps: [[{ kind: "custom", id: "toolu_bad", input }]],
        closing: "I will fix that.",
      });
      expect(run.phase()).toBe("RUN_COMPLETED");
      expect(run.modelRead("toolu_bad")).toEqual({ text: customToolInputProblem(FORM_TOOL, input), isError: true });
      expect(customUses(run.record)).toEqual([]);
      expect(run.record.waitingToolCalls()).toEqual([]);
    });

    it("5: two calls in one step are both answered, each once", async () => {
      const second: ContractCall = { kind: "custom", id: "toolu_b", input: { service: "billing" } };
      const again: ContractCall = { kind: "custom", id: "toolu_b_alone", input: { service: "billing" } };
      const run = await subject.begin({
        message: "Register payments and billing.",
        steps: subject.oneDeferralPerInvocation
          ? [[{ kind: "custom", id: "toolu_a", input: { service: "payments" } }, second], [again]]
          : [[{ kind: "custom", id: "toolu_a", input: { service: "payments" } }, second]],
        closing: "Both registered.",
      });
      const answered: string[] = [];
      for (let round = 0; round < 3 && run.phase() === "RUN_WAITING_FOR_APPROVAL"; round += 1) {
        for (const row of run.record.waitingCustomToolCalls()) {
          run.record.answerCustomToolUse(row.id, `registered ${row.id}`);
          answered.push(row.id);
        }
        await run.resume();
      }
      expect(run.phase()).toBe("RUN_COMPLETED");
      const expected = subject.oneDeferralPerInvocation ? ["toolu_a", "toolu_b_alone"] : ["toolu_a", "toolu_b"];
      expect([...answered].sort()).toEqual(expected);
      for (const id of expected) expect(run.modelRead(id), id).toEqual({ text: `registered ${id}`, isError: false });
      expect(customUses(run.record).map((use) => use.id).sort()).toEqual(expected.map((id) => useIdOf(run.record, id)).sort());
    });

    it("6: an unattended turn offers none, and a call never waits", async () => {
      const call: ContractCall = { kind: "custom", id: "toolu_guest", input: { service: "payments" } };
      const run = await subject.begin({
        message: "Register it.",
        unattended: true,
        steps: subject.reachesUnofferedTools ? [[call]] : [],
        closing: "I cannot register it here.",
      });
      expect(run.offeredToMain().length, "the main agent was asked").toBeGreaterThan(0);
      expect(run.offeredToMain()).not.toContain(subject.modelName(FORM_TOOL.name));
      expect(run.phase()).toBe("RUN_COMPLETED");
      if (subject.reachesUnofferedTools) expect(run.modelRead("toolu_guest")?.isError, "the call came back refused").toBe(true);
      expect(customUses(run.record)).toEqual([]);
    });

    it("7: the agent's tool lists do not hide it", async () => {
      const run = await subject.begin({
        message: "Register it.",
        agentTools: ["Read"],
        steps: [[{ kind: "custom", id: "toolu_listed", input: { service: "payments" } }]],
        closing: "Registered.",
      });
      expect(run.offeredToMain()).toContain(subject.modelName(FORM_TOOL.name));
      expect(run.phase()).toBe("RUN_WAITING_FOR_APPROVAL");
      expect(run.record.waitingCustomToolCalls().map((row) => row.id)).toEqual(["toolu_listed"]);
    });

    it("8: a helper cannot make the host wait", async () => {
      const run = await subject.begin({
        message: "Have the helper register it.",
        steps: [[{ kind: "delegate", id: "toolu_task" }]],
        closing: "The helper could not.",
        helper: { calls: subject.reachesUnofferedTools ? [{ kind: "custom", id: "toolu_helper_form", input: { service: "payments" } }] : [], closing: "I cannot open the form." },
      });
      expect(run.phase()).toBe("RUN_COMPLETED");
      expect(run.offeredToHelper().length, "the helper was asked").toBeGreaterThan(0);
      if (subject.reachesUnofferedTools) expect(run.modelRead("toolu_helper_form")?.isError, "the helper's call came back refused").toBe(true);
      else expect(run.offeredToHelper()).not.toContain(subject.modelName(FORM_TOOL.name));
      expect(run.record.waitingToolCalls()).toEqual([]);
      expect(customUses(run.record)).toEqual([]);
    });
  });
}
