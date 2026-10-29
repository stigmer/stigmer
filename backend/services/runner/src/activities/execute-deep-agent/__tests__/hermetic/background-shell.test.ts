/**
 * Hermetic: a command the agent runs in the background, through the whole
 * `ExecuteDeepAgent` activity (the turn runtime over the Stigmer harness's adapter).
 *
 * Invariants pinned:
 *  - One turn: the agent starts `sleep 2; echo done` in the background, the
 *    start answers at once, the agent ends its reply, is reminded once,
 *    ends it again, and the turn waits; the command's end reaches the agent
 *    as a notice and the agent answers it. The turn completes, the start's
 *    row holds the start's answer, and the session's log carries the
 *    command's own life after that answer: its running status, then its
 *    ended status (exited 0, with what it printed), and no SYSTEM row.
 *  - A person's stop of the command while the turn waits, a stop request in
 *    the log as the server writes it, is read by the runtime's pump and
 *    stops that command alone: its ended status says a person stopped it,
 *    the agent is told so, and the turn completes long before the command's
 *    own end.
 *  - A platform STOP that arrives while the turn waits ends the wait at once:
 *    the command is stopped, its ended status says the turn stopped it, the
 *    agent's thread is told so, and the run completes with the
 *    platform-stop row, long before the command's own end.
 *  - With the operator's setting off (`STIGMER_SHELL_BACKGROUND_ENABLED`),
 *    carried from the runner to the agent host, the model sees `execute`
 *    without `background` and no stop tool, and a call that asks for the
 *    background anyway runs in the foreground: today's engine, as before
 *    background commands existed.
 *  - An approval pause stops the command, and the stop is awaited before
 *    the adapter returns: a command that writes a file when it is stopped
 *    has written it by the time the activity returns, which is when the
 *    runtime captures the tree, and its ended status, saying the approval
 *    pause stopped it, is in the log by then too. The invocation that
 *    resumes the person's decision tells the agent the command was stopped
 *    at that pause.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunControlSignal } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { isHumanMessage, isToolMessage, type BaseMessage } from "@langchain/core/messages";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn, sessionWorkspaceDir } from "../../__test-utils__/hermetic-deep-agent.js";
import type { ScriptedTurn } from "../../__test-utils__/scripted-model.js";
import { ApprovalAction, MessageType, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { create } from "@bufbuild/protobuf";
import { SessionEventSchema, type SessionEvent, type StigmerBackgroundCommandStatusEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

function textOf(message: BaseMessage | undefined): string {
  if (message === undefined) return "";
  return typeof message.content === "string" ? message.content : message.text;
}

/** The log's background statuses of the command `callId` started, in log order. */
function statusesOf(events: readonly SessionEvent[], callId: string): StigmerBackgroundCommandStatusEvent[] {
  return events.flatMap((e) =>
    e.event.case === "stigmerBackgroundCommandStatus" && e.event.value.toolUseId.endsWith(`.${callId}`) ? [e.event.value] : [],
  );
}

/** Where an event sits in the log, by id. */
function indexOf(events: readonly SessionEvent[], id: string): number {
  return events.findIndex((e) => e.event.case !== undefined && e.event.value.id === id);
}

function phaseOf(outcome: unknown): unknown {
  return (outcome as { value: Record<string, unknown> }).value.phase;
}

describe("ExecuteDeepAgent hermetic — background commands", () => {
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

  it("starts a command in the background, waits for it at the reply's end, and answers its notice in the same turn", async () => {
    const START = "call-hermetic-bg-0001";
    const record = deepAgentExecutionRecord({ message: "Run the slow check in the background.", autoApproveAll: true });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => (transcript: readonly BaseMessage[]): ScriptedTurn => {
        const last = transcript.at(-1);
        if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-command ")) return { text: "The check printed done." };
        if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-commands-running>")) return { text: "I will wait for it." };
        if (isToolMessage(last)) return { text: "It runs in the background." };
        return { toolCalls: [{ id: START, name: "execute", args: { command: "sleep 2; echo done", background: true } }] };
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(phaseOf(invocation.outcome)).toBe("RUN_COMPLETED");
    const rows = record.rowsOf(record.lastFullStatus!);
    const start = rows.messages.flatMap((m) => m.toolCalls).find((row) => row.id === START);
    expect(start?.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(start?.result).toContain(`Started in the background (id ${START}).`);
    expect(rows.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM), "the person is told by the command's own status").toEqual([]);
    const statuses = statusesOf(record.sessionEvents, START);
    expect(statuses.map((st) => st.phase)).toEqual(["running", "ended"]);
    expect(statuses[1]).toMatchObject({ ending: "exited", exitCode: 0, stoppedBy: "" });
    expect(statuses[1]!.output).toContain("done");
    const useId = statuses[0]!.toolUseId;
    expect(indexOf(record.sessionEvents, `${useId}.bg`), "the running status follows the start's result").toBeGreaterThan(indexOf(record.sessionEvents, `${useId}.r`));
    const ai = rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
    expect(ai.at(-1)).toBe("The check printed done.");
    expect(
      ai.filter((text) => text.includes("<background-command")),
      "the turn's reminder and notices are the agent's input, never its words",
    ).toEqual([]);
  });

  it("with the operator's setting off, shows the model execute without background and no stop tool, and runs a call that asks for it in the foreground", async () => {
    const CALL = "call-hermetic-bg-off-0001";
    const record = deepAgentExecutionRecord({ message: "Run the slow check.", autoApproveAll: true });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      config: { shellBackgroundEnabled: false },
      script: () => (transcript: readonly BaseMessage[]): ScriptedTurn => {
        if (isToolMessage(transcript.at(-1))) return { text: "The check printed done." };
        return { toolCalls: [{ id: CALL, name: "execute", args: { command: "echo done", background: true } }] };
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(phaseOf(invocation.outcome)).toBe("RUN_COMPLETED");
    const named = (name: string) => scenario.model.boundTools.filter((tool) => (tool as { name?: unknown }).name === name) as Array<{ schema?: { properties?: Record<string, unknown> } }>;
    expect(named("execute")).toHaveLength(1);
    expect(Object.keys(named("execute")[0]!.schema?.properties ?? {})).toContain("timeout");
    expect(Object.keys(named("execute")[0]!.schema?.properties ?? {}), "the field is declared only while background commands are on").not.toContain("background");
    expect(named("stop_background_command"), "no stop tool is bound").toEqual([]);
    const rows = record.rowsOf(record.lastFullStatus!);
    const call = rows.messages.flatMap((m) => m.toolCalls).find((row) => row.id === CALL);
    expect(call?.result).toContain("done");
    expect(call?.result).not.toContain("Started in the background");
    expect(statusesOf(record.sessionEvents, CALL), "nothing ran in the background").toEqual([]);
  });

  it("stops the command a person stopped, read from the log while the turn waits, and the agent answers", async () => {
    const START = "call-hermetic-bg-0004";
    const WAITING = "I will wait for the server.";
    const record = deepAgentExecutionRecord({ message: "Start the server.", autoApproveAll: true });
    let toldStopped = "";
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => (transcript: readonly BaseMessage[]): ScriptedTurn => {
        const last = transcript.at(-1);
        if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-commands-running>")) {
          // The person presses Stop: the server writes the request into the log.
          const toolUseId = statusesOf(record.sessionEvents, START)[0]?.toolUseId ?? "";
          record.sessionEvents.push(
            create(SessionEventSchema, {
              runId: record.executionId,
              event: { case: "stigmerBackgroundCommandStopRequested", value: { id: "sevt_bs_hermetic", toolUseId } },
            }),
          );
          return { text: WAITING };
        }
        if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-command ")) {
          toldStopped = textOf(last);
          return { text: "You stopped the server." };
        }
        if (isToolMessage(last)) return { text: "It runs." };
        return { toolCalls: [{ id: START, name: "execute", args: { command: "sleep 120", background: true } }] };
      },
    });

    const startedAt = performance.timeOrigin + process.uptime() * 1000;
    const invocation = await runDeepAgentTurn(scenario);
    expect(performance.timeOrigin + process.uptime() * 1000 - startedAt, "the person's stop ended it, not its own 120 s").toBeLessThan(60_000);

    expect(phaseOf(invocation.outcome)).toBe("RUN_COMPLETED");
    expect(statusesOf(record.sessionEvents, START).at(-1)).toMatchObject({ phase: "ended", ending: "stopped", stoppedBy: "person" });
    expect(toldStopped).toContain('ended="stopped by the person"');
    const rows = record.rowsOf(record.lastFullStatus!);
    const ai = rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
    expect(ai.at(-1)).toBe("You stopped the server.");
  });

  it("ends the wait at a platform STOP, stopping the command, and completes with the platform-stop row", async () => {
    const START = "call-hermetic-bg-0003";
    const WAITING = "I will wait for the server.";
    const record = deepAgentExecutionRecord({
      message: "Start the server.",
      autoApproveAll: true,
      controlSignal: (_status, rows) =>
        rows.messages.some((m) => m.type === MessageType.MESSAGE_AI && m.content === WAITING) ? RunControlSignal.STOP : RunControlSignal.UNSPECIFIED,
    });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => (transcript: readonly BaseMessage[]): ScriptedTurn => {
        const last = transcript.at(-1);
        if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-commands-running>")) return { text: WAITING };
        if (isToolMessage(last)) return { text: "It runs." };
        if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-command ")) return { text: "never reached: the boundary refuses this call" };
        return { toolCalls: [{ id: START, name: "execute", args: { command: "sleep 30", background: true } }] };
      },
    });

    const startedAt = performance.timeOrigin + process.uptime() * 1000;
    const invocation = await runDeepAgentTurn(scenario);
    expect(performance.timeOrigin + process.uptime() * 1000 - startedAt, "the STOP ended the wait, not the command").toBeLessThan(20_000);

    expect(phaseOf(invocation.outcome)).toBe("RUN_COMPLETED");
    const rows = record.rowsOf(record.lastFullStatus!);
    const system = rows.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
    expect(system).toContain("Execution stopped by the platform.");
    expect(statusesOf(record.sessionEvents, START).at(-1), "stopped with the turn").toMatchObject({ phase: "ended", ending: "stopped", stoppedBy: "turn" });
    const ai = rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
    expect(ai).not.toContain("never reached: the boundary refuses this call");
  });

  it("stops the command at an approval pause before the adapter returns, and tells the resumed invocation", async () => {
    const START = "call-hermetic-bg-0002";
    const NEXT = "call-hermetic-fg-0001";
    const record = deepAgentExecutionRecord({ message: "Start the server, then run the check." });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      checkpointer: "sqlite",
      script: () => (transcript: readonly BaseMessage[]): ScriptedTurn => {
        const last = transcript.at(-1);
        if (last !== undefined && isHumanMessage(last) && textOf(last).startsWith("<background-command ")) return { text: "Noted: the server was stopped." };
        const results = transcript.filter((m) => isToolMessage(m)).length;
        if (results === 0) {
          return { toolCalls: [{ id: START, name: "execute", args: { command: "trap 'echo bye > stopped.txt; exit 0' TERM; sleep 30 & wait", background: true } }] };
        }
        if (results === 1) return { toolCalls: [{ id: NEXT, name: "execute", args: { command: "echo check" } }] };
        return { text: "done" };
      },
    });
    const workspace = sessionWorkspaceDir(env);

    const turn1 = await runDeepAgentTurn(scenario, { turnSeq: 0 });
    expect(phaseOf(turn1.outcome)).toBe("RUN_WAITING_FOR_APPROVAL");
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, "2026-01-01T00:00:30.000Z")).toBe(1);

    // The start runs; the next call asks; the invocation ends and stops the command first.
    const turn2 = await runDeepAgentTurn(scenario, { turnSeq: 1 });
    expect(phaseOf(turn2.outcome)).toBe("RUN_WAITING_FOR_APPROVAL");
    expect(record.waitingToolCalls().map((tc) => tc.id)).toEqual([NEXT]);
    expect(existsSync(join(workspace, "stopped.txt")), "the command's last write landed before the adapter returned").toBe(true);
    expect(statusesOf(record.sessionEvents, START).map((st) => [st.phase, st.ending, st.stoppedBy]), "its end is in the log when the invocation returns").toEqual([
      ["running", "", ""],
      ["ended", "stopped", "approval"],
    ]);
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, "2026-01-01T00:01:00.000Z")).toBe(1);

    const turn3 = await runDeepAgentTurn(scenario, { turnSeq: 2 });
    expect(phaseOf(turn3.outcome)).toBe("RUN_COMPLETED");
    const rows = record.rowsOf(record.lastFullStatus!);
    expect(statusesOf(record.sessionEvents, START), "a resumed invocation writes nothing more of an earlier one's command").toHaveLength(2);
    const ai = rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
    expect(ai.at(-1)).toBe("Noted: the server was stopped.");
  });
});
