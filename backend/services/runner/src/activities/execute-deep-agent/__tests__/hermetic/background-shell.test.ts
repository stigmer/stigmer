/**
 * Hermetic: a command the agent runs in the background, through the whole
 * `ExecuteDeepAgent` activity (the turn runtime over the native adapter).
 *
 * Invariants pinned:
 *  - One turn: the agent starts `sleep 2; echo done` in the background, the
 *    start answers at once, the agent ends its reply, is reminded once,
 *    ends it again, and the turn waits; the command's end reaches the agent
 *    as a notice and the agent answers it. The turn completes, the start's
 *    row holds the start's answer, and the session's transcript carries the
 *    platform's line about the ending as a SYSTEM row.
 *  - A platform STOP that arrives while the turn waits ends the wait at once:
 *    the command is stopped, the agent's thread is told so, and the run
 *    completes with the platform-stop row, long before the command's own end.
 *  - An approval pause stops the command, and the stop is awaited before
 *    the adapter returns: a command that writes a file when it is stopped
 *    has written it by the time the activity returns, which is when the
 *    runtime captures the tree. The invocation that resumes the person's
 *    decision tells the agent the command was stopped at that pause, once.
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

function textOf(message: BaseMessage | undefined): string {
  if (message === undefined) return "";
  return typeof message.content === "string" ? message.content : message.text;
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
    const system = rows.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
    expect(system).toContain("Background command `sleep 2; echo done` exited with code 0.");
    const ai = rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
    expect(ai.at(-1)).toBe("The check printed done.");
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
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, "2026-01-01T00:01:00.000Z")).toBe(1);

    const turn3 = await runDeepAgentTurn(scenario, { turnSeq: 2 });
    expect(phaseOf(turn3.outcome)).toBe("RUN_COMPLETED");
    const rows = record.rowsOf(record.lastFullStatus!);
    const system = rows.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
    expect(system.filter((line) => line.includes("was stopped when the turn paused for approval")), "told once").toHaveLength(1);
    const ai = rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
    expect(ai.at(-1)).toBe("Noted: the server was stopped.");
  });
});
