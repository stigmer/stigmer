/**
 * Proves the scenario catalogue (../scenarios.ts): every scenario is the
 * state its name claims, read from its fold and from the conversation the
 * adapter builds (one ask while an approval waits, an undecided review set,
 * a running and a finished subagent, a failed turn with its error, a usage
 * report only where usage is claimed, a long turn's to-dos and what it has
 * open, a finished session's Files and origin); that the adapter's live turn, phase
 * and composer state follow the hook's rules; that its actions are inert;
 * and that no scenario carries a timestamp other than the frozen instant's.
 * Beside the states: the scripted turn the docs play, its parts in the order
 * a reader's acts choose between; the ledger turn of the first agent job,
 * read, written and answered with no ask; and `upTo`, which draws any
 * scenario part of the way through.
 */
import { describe, it, expect } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { ToolUse } from "@stigmer/client";
import {
  SCENARIO_CLOCK,
  SCENARIO_NAMES,
  LEDGER_MESSAGE,
  SCRIPTED_MESSAGE,
  conversationOf,
  ledgerStory,
  ledgerTurn,
  scenarios,
  scriptedStory,
  scriptedTurn,
  upTo,
  usageOf,
  type ScenarioName,
} from "../scenarios";
import { SAMPLE_INSTANT, samples } from "@stigmer/react-core/test";

function onlyTurn(name: ScenarioName) {
  const turns = scenarios[name].fold.turns;
  expect(turns, `${name} has one turn`).toHaveLength(1);
  return turns[0]!;
}

function taskOf(name: ScenarioName): ToolUse {
  const task = onlyTurn(name).items.find((item): item is ToolUse => item.kind === "tool_use" && item.name === "task");
  expect(task, `${name} has a task call`).toBeDefined();
  return task!;
}

describe("the scenario catalogue", () => {
  it("names every scenario once, under its own name", () => {
    expect(new Set(SCENARIO_NAMES).size).toBe(SCENARIO_NAMES.length);
    expect(Object.keys(scenarios).sort()).toEqual([...SCENARIO_NAMES].sort());
    for (const name of SCENARIO_NAMES) expect(scenarios[name].name).toBe(name);
  });

  it("loads only where it claims: loading has no session, load-failed carries the refused connection", () => {
    expect(scenarios.loading).toMatchObject({ loading: true, loadError: null, session: null });
    expect(scenarios["load-failed"].loading).toBe(false);
    expect(scenarios["load-failed"].loadError?.message).toContain("ECONNREFUSED");
    for (const name of SCENARIO_NAMES.filter((n) => n !== "loading" && n !== "load-failed")) {
      expect(scenarios[name].loading, name).toBe(false);
      expect(scenarios[name].loadError, name).toBeNull();
      expect(scenarios[name].session, name).not.toBeNull();
    }
  });

  it("starts empty with no turns and an open composer", () => {
    expect(scenarios.empty.fold.turns).toHaveLength(0);
    const conversation = conversationOf(scenarios.empty);
    expect(conversation).toMatchObject({ activeTurn: null, activePhase: null, canSendFollowUp: true, isStoppable: false });
  });

  it("streams a reply on a running turn", () => {
    const turn = onlyTurn("streaming");
    expect(turn.status?.phase).toBe("running");
    expect(turn.items.some((item) => item.kind === "message" && item.text !== "")).toBe(true);
    const conversation = conversationOf(scenarios.streaming);
    expect(conversation.activeTurn).toBe(turn);
    expect(conversation).toMatchObject({ activePhase: "running", isStreaming: true, isStoppable: true, canSendFollowUp: true });
  });

  it("holds one returned and one running tool call", () => {
    const tools = onlyTurn("tools").items.filter((item): item is ToolUse => item.kind === "tool_use");
    expect(tools.map((tool) => [tool.name, tool.result === undefined])).toEqual([
      ["read_file", false],
      ["execute", true],
    ]);
  });

  it("waits on exactly one ask while an approval waits, and closes the composer", () => {
    const conversation = conversationOf(scenarios.approval);
    expect(conversation.activePhase).toBe("waiting");
    expect(conversation.asks.map((ask) => ask.name)).toEqual(["write_file"]);
    expect(conversation.canSendFollowUp).toBe(false);
    expect(conversation.activeRun?.status?.phase).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
  });

  it("offers one undecided review set of two files after its turn ends", () => {
    const conversation = conversationOf(scenarios["file-review"]);
    expect(conversation.activeTurn).toBeNull();
    expect(conversation.fileReviewSets).toHaveLength(1);
    expect(conversation.fileReviewSets[0]!.files.map((file) => file.path)).toEqual([
      "src/billing/invoice.ts",
      "src/billing/rounding.ts",
    ]);
  });

  it("runs a subagent, then finishes one with no end time on its task call", () => {
    expect(taskOf("subagent-running").thread?.state).toBe("running");
    const finished = taskOf("subagent-finished");
    expect(finished.thread?.state).toBe("completed");
    expect(finished.result).toBeUndefined();
  });

  it("fails a turn with the error its status carries", () => {
    const turn = onlyTurn("failed");
    expect(turn.status?.phase).toBe("failed");
    expect(turn.status?.error).toContain("API key is invalid");
    expect(scenarios.failed.runs[0]!.status?.phase).toBe(RunPhase.RUN_FAILED);
  });

  it("reports usage only on the completed and finished turns, and empty usage elsewhere", () => {
    expect(onlyTurn("completed").status?.phase).toBe("completed");
    expect(usageOf(scenarios.completed)).toMatchObject({ hasUsage: true, totalTokens: 18_432, llmCallCount: 3, primaryModel: "claude-sonnet-4-5" });
    expect(usageOf(scenarios.finished)).toMatchObject({ hasUsage: true, totalTokens: 41_210, llmCallCount: 7, workingSeconds: 74 });
    for (const name of SCENARIO_NAMES.filter((n) => n !== "completed" && n !== "finished")) {
      expect(scenarios[name].usage, name).toBeUndefined();
      expect(usageOf(scenarios[name]).hasUsage, name).toBe(false);
    }
  });

  it("replies in markdown with a heading, a list, code and a table", () => {
    const reply = onlyTurn("markdown").items.find((item) => item.kind === "message");
    const text = reply?.kind === "message" ? reply.text : "";
    expect(text).toContain("## What changed");
    expect(text).toContain("1. `lineTotal`");
    expect(text).toContain("```ts");
    expect(text).toContain("| Case | Before | After |");
  });

  it("keeps a long turn at work: two of five to-dos done, settled calls, and a subagent and the suite open", () => {
    const turn = onlyTurn("busy");
    expect(turn.ended).toBe(false);
    expect(turn.status?.phase).toBe("running");
    expect(turn.todos.map((todo) => todo.status)).toEqual(["completed", "completed", "in_progress", "pending", "pending"]);
    const tools = turn.items.filter((item): item is ToolUse => item.kind === "tool_use");
    expect(tools.map((tool) => [tool.name, tool.result === undefined])).toEqual([
      ["write_todos", false],
      ["grep", false],
      ["read_file", false],
      ["edit_file", false],
      ["execute", false],
      ["task", true],
      ["execute", true],
    ]);
    expect(taskOf("busy").thread?.state).toBe("running");
    expect(turn.liveness?.operations.map((operation) => [operation.name, operation.elapsedMs])).toEqual([
      ["task", 38_000],
      ["execute", 30_000],
    ]);
    expect(conversationOf(scenarios.busy)).toMatchObject({ activePhase: "running", isStoppable: true });
  });

  it("holds a liveness preview only where a turn works, and Files only where a turn returned them", () => {
    for (const name of SCENARIO_NAMES.filter((n) => n !== "busy")) expect(scenarios[name].liveness, name).toBeUndefined();
    for (const name of SCENARIO_NAMES.filter((n) => n !== "finished")) expect(scenarios[name].files, name).toEqual([]);
  });

  it("finishes a session a routine started, with an edit and two Files from its one turn", () => {
    const turn = onlyTurn("finished");
    expect(turn.status?.phase).toBe("completed");
    expect(turn.answer).toContain("rounds once, at the total");
    expect(turn.items.some((item) => item.kind === "tool_use" && item.name === "edit_file")).toBe(true);
    const { files, session } = scenarios.finished;
    expect(files.map((file) => [file.spec?.filename, file.status?.runId])).toEqual([
      ["invoice-audit.md", turn.runId],
      ["rounding-cases.csv", turn.runId],
    ]);
    expect(session?.status?.routineId).not.toBe("");
    expect(conversationOf(scenarios.finished)).toMatchObject({ activeTurn: null, isStoppable: false });
  });

  it("numbers each scenario's events from 1 and files one run per turn", () => {
    for (const name of SCENARIO_NAMES) {
      const { events, fold, runs } = scenarios[name];
      expect(events.map((e) => e.seq), name).toEqual(events.map((_, index) => BigInt(index + 1)));
      expect(runs.map((run) => run.metadata?.id), name).toEqual(fold.turns.map((turn) => turn.runId));
    }
  });

  it("stamps every event at the frozen instant or after it, and draws its frames ninety seconds on", () => {
    const anchor = Date.parse(SAMPLE_INSTANT);
    for (const name of SCENARIO_NAMES) {
      for (const e of scenarios[name].events) {
        const stamp = (e.event.value as { processedAt?: string } | undefined)?.processedAt ?? "";
        if (stamp !== "") expect(Date.parse(stamp) - anchor, `${name} ${e.event.case}`).toBeGreaterThanOrEqual(0);
        if (stamp !== "") expect(Date.parse(stamp) - anchor, `${name} ${e.event.case}`).toBeLessThan(90_000);
      }
    }
    expect(Date.parse(SCENARIO_CLOCK) - anchor).toBe(90_000);
  });

  it("gives the conversation inert actions", async () => {
    const conversation = conversationOf(scenarios.approval);
    await expect(conversation.sendFollowUp("again")).resolves.toBeUndefined();
    await expect(conversation.answerToolUse("x", "allow")).resolves.toBeUndefined();
    await expect(conversation.reviewFileChanges("cs-1", "keep", { scope: "change_set", expectedDigest: "agg-1" })).resolves.toBeUndefined();
    await expect(conversation.stop()).resolves.toBeUndefined();
    await expect(conversation.stopBackgroundCommand("x")).resolves.toBeUndefined();
    await expect(conversation.moveToCurrentAgentVersion()).resolves.toBeUndefined();
    expect(() => {
      conversation.clearSendError();
      conversation.retryLastSend();
      conversation.clearAnswerError();
      conversation.clearFileDecisionError("k");
      conversation.clearFileReviewError();
      conversation.reconnectStream();
    }).not.toThrow();
  });
});

describe("the scripted turn and upTo", () => {
  it("waits at the ask, then ends with the answer when allowed, the reply without the command when denied, interrupted when stopped", () => {
    const turn = scriptedTurn("what changed?", "run_x");
    for (const [tail, phase, answer] of [
      [turn.approved, "completed", /^Two changes this week/],
      [turn.denied, "completed", /^I won't run it/],
    ] as const) {
      const events = [...turn.untilAsk, ...tail];
      const story = upTo({ ...scriptedStory(), events: events.map((e, i) => ({ ...e, seq: BigInt(i + 1) })) }, events.length);
      const last = story.fold.turns.at(-1)!;
      expect(last.userMessage?.text).toBe("what changed?");
      expect(last.status?.phase).toBe(phase);
      expect(last.answer).toMatch(answer);
    }
    expect(turn.stopped.map((e) => e.event.case === "stigmerRunStatus" && e.event.value.phase)).toEqual(["cancelled"]);
  });

  it("tells the story whole: two reads, the ask, the answer, every event stamped in order from the frozen instant", () => {
    const story = scriptedStory();
    const turn = story.fold.turns[0]!;
    expect(turn.userMessage?.text).toBe(SCRIPTED_MESSAGE);
    expect(turn.items.flatMap((item) => (item.kind === "tool_use" ? [item.name] : []))).toEqual(["read_file", "read_file", "execute"]);
    expect(turn.status?.phase).toBe("completed");
    expect(story.runs.map((run) => run.status?.phase)).toEqual([RunPhase.RUN_COMPLETED]);
    const stamps = story.events.map((e) => Date.parse((e.event.value as { processedAt?: string }).processedAt ?? ""));
    expect(stamps.every((stamp, i) => i === 0 || stamp >= stamps[i - 1]!)).toBe(true);
    expect(stamps[0]).toBe(Date.parse(SAMPLE_INSTANT));
  });

  it("draws a scenario part of the way: the turn waiting at its ask, the run in its phase, the session kept", () => {
    const story = scriptedStory();
    const atAsk = story.events.findIndex((e) => e.event.case === "stigmerRunStatus" && e.event.value.phase === "waiting") + 1;
    const waiting = upTo(story, atAsk);
    expect(waiting.events).toHaveLength(atAsk);
    expect(waiting.fold.turns[0]!.asks.map((ask) => ask.name)).toEqual(["execute"]);
    expect(waiting.runs.map((run) => run.status?.phase)).toEqual([RunPhase.RUN_WAITING_FOR_APPROVAL]);
    expect(waiting.session).toBe(story.session);
    expect(conversationOf(waiting).activePhase).toBe("waiting");
  });

  it("keeps what lives beside the events only when every event is drawn", () => {
    const busy = scenarios.busy;
    expect(upTo(busy, busy.events.length).liveness).toBe(busy.liveness);
    expect(upTo(busy, busy.events.length - 1).liveness).toBeUndefined();
    expect(upTo(scenarios.finished, scenarios.finished.events.length).files).toEqual(scenarios.finished.files);
    expect(upTo(scenarios.finished, 3).files).toEqual([]);
    expect(upTo(scenarios.finished, 3).usage).toBeUndefined();
  });

  it("refuses a count that is not one of the scenario's events", () => {
    expect(() => upTo(scenarios.completed, -1)).toThrow(RangeError);
    expect(() => upTo(scenarios.completed, scenarios.completed.events.length + 1)).toThrow(/has \d+ events/);
    expect(() => upTo(scenarios.completed, 1.5)).toThrow(RangeError);
  });
});

describe("the scripted turn the docs play", () => {
  it("waits at the ask, then ends with the answer when allowed, the reply without the command when denied, interrupted when stopped", () => {
    const turn = scriptedTurn("what changed?", "run_x");
    const waiting = samples.fold([...turn.untilAsk]).turns.at(-1)!;
    expect(waiting.userMessage?.text).toBe("what changed?");
    expect(waiting.status?.phase).toBe("waiting");
    expect(waiting.asks.map((ask) => ask.name)).toEqual(["execute"]);
    for (const [tail, answer] of [
      [turn.approved, /^Two changes this week/],
      [turn.denied, /^I won't run it/],
    ] as const) {
      const ended = samples.fold([...turn.untilAsk, ...tail]).turns.at(-1)!;
      expect(ended.status?.phase).toBe("completed");
      expect(ended.answer).toMatch(answer);
    }
    expect(samples.fold([...turn.untilAsk, ...turn.stopped]).turns.at(-1)!.status?.phase).toBe("cancelled");
  });

  it("files every event under the run it names, and offers its own message when given none", () => {
    const turn = scriptedTurn(undefined, "run_y");
    expect([...turn.untilAsk, ...turn.approved, ...turn.denied, ...turn.stopped].every((event) => event.runId === "run_y")).toBe(true);
    expect(samples.fold([...turn.untilAsk]).turns.at(-1)!.userMessage?.text).toBe(SCRIPTED_MESSAGE);
  });
});

describe("the ledger turn the docs' front page plays", () => {
  it("reads the ledger from its uploads, writes the report to its outputs, names the flagged accounts and completes at 38 s", () => {
    const story = ledgerStory();
    const turn = story.fold.turns[0]!;
    expect(turn.userMessage?.text).toBe(LEDGER_MESSAGE);
    const tools = turn.items.flatMap((item) => (item.kind === "tool_use" ? [[item.name, (item.input as { path?: string }).path] as const] : []));
    expect(tools).toEqual([
      ["read_file", "/.stigmer/uploads/ledger.csv"],
      ["write_file", "/.stigmer/outputs/variance-report.md"],
    ]);
    expect(turn.asks).toEqual([]);
    expect(turn.answer).toMatch(/Marketing.*cost of goods sold.*travel/s);
    expect(turn.status?.phase).toBe("completed");
    expect(Date.parse(turn.status!.processedAt) - Date.parse(SAMPLE_INSTANT)).toBe(38_000);
    expect(story.runs.map((run) => run.status?.phase)).toEqual([RunPhase.RUN_COMPLETED]);
  });

  it("returns the report as a File of the turn, at its place in the outputs folder", () => {
    const [report, ...rest] = ledgerStory().files;
    expect(rest).toEqual([]);
    expect(report!.status?.outputPath).toBe("variance-report.md");
    expect(report!.status?.sizeBytes).toBe(696n);
    expect(upTo(ledgerStory(), 3).files).toEqual([]);
  });

  it("stamps every event in order from the frozen instant, under the run it names", () => {
    const events = ledgerTurn("run_z");
    expect(events.every((event) => event.runId === "run_z")).toBe(true);
    const stamps = events.map((e) => Date.parse((e.event.value as { processedAt?: string }).processedAt ?? ""));
    expect(stamps.every((stamp, i) => i === 0 || stamp >= stamps[i - 1]!)).toBe(true);
    expect(stamps[0]).toBe(Date.parse(SAMPLE_INSTANT));
  });
});
