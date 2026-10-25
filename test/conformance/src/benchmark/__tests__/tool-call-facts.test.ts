// Unit arms for the per-tool-call facts of a sample, over a hand-built
// session log folded (turn-events.ts) and turn timelines.
// Domain: conformance benchmark.
//
// Pinned: the primary thread's calls are read in the order the agent made
// them, a sub-agent's never; each takes the round of the first unmatched
// timeline span of its name, an MCP span matching by its bare name; a
// timeline with a sub-agent, or none, places no call; a placed call keeps its
// span's start; a shell call that asked for the background says so; the target is the
// first of `file_path`, `path`, `pattern`, else the command's head; a paged
// read keeps its window; a completed call whose result is the engine's
// returned edit failure is `not_found` or `not_unique` in both backends'
// words; a denied call is `skipped`; the final to-do list is counted by
// state.
import type { JsonObject } from "@bufbuild/protobuf";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { ToolUse } from "@stigmer/session-log";
import { describe, expect, it } from "vitest";
import type { TimingLine } from "../report";
import { COMMAND_TARGET_CHARS, outcomeOf, targetOf, todoCounts, toolCallFacts } from "../tool-call-facts";
import { denied, result, subAgentThread, turnFrom, use, userMessage } from "./turn-events";

type CallInit = { name: string; args?: JsonObject; result?: string };

// A turn whose primary thread made `calls` in order, each returning its result.
function turnWith(calls: CallInit[], extra: SessionEvent[] = []) {
  const events: SessionEvent[] = [userMessage("go")];
  calls.forEach((call, index) => {
    events.push(use(`c${index}`, call.name, call.args ?? {}), result(`c${index}`, call.result ?? "ok"));
  });
  return turnFrom([...events, ...extra]);
}

function timeline(names: string[]): TimingLine {
  return {
    event: "turn_phases",
    context: {},
    total_ms: names.length * 10,
    segments: names.map((name, index) => ({ name, start_ms: index * 10, duration_ms: 5 })),
  };
}

describe("toolCallFacts", () => {
  it("reads the calls in the order the agent made them and places each on its round", () => {
    const turn = turnWith([
      { name: "read_file", args: { file_path: "/duration/duration.go" } },
      { name: "read_file", args: { file_path: "/duration/duration_test.go" } },
      { name: "edit_file", args: { file_path: "/duration/duration.go" } },
      { name: "execute", args: { command: "go test ./..." } },
    ]);
    const facts = toolCallFacts(
      turn,
      timeline(["model_round", "tool:read_file", "tool:read_file", "model_round", "tool:edit_file", "model_round", "tool:execute", "model_round"]),
    );
    expect(facts.map(({ round, name, target, status, outcome }) => ({ round, name, target, status, outcome }))).toEqual([
      { round: 1, name: "read_file", target: "/duration/duration.go", status: "completed", outcome: "ok" },
      { round: 1, name: "read_file", target: "/duration/duration_test.go", status: "completed", outcome: "ok" },
      { round: 2, name: "edit_file", target: "/duration/duration.go", status: "completed", outcome: "ok" },
      { round: 3, name: "execute", target: "go test ./...", status: "completed", outcome: "ok" },
    ]);
  });

  it("never reads a sub-agent's calls", () => {
    const turn = turnWith([{ name: "read_file", args: { file_path: "/a.go" } }], [
      ...subAgentThread("task1", "looking"),
      use("sub1", "read_file", { file_path: "/sub.go" }, "run_1.task1"),
    ]);
    expect(toolCallFacts(turn, null).map((fact) => [fact.name, fact.target])).toEqual([
      ["read_file", "/a.go"],
      ["task", ""],
    ]);
  });

  it("matches an MCP tool's span by its bare name", () => {
    const turn = turnWith([{ name: "lookup_order", args: { order_id: "ORD-4821" } }]);
    const [fact] = toolCallFacts(turn, timeline(["model_round", "tool:orders-api/lookup_order", "model_round"]));
    expect(fact?.round).toBe(1);
    expect(fact?.target, "an argument that names no path, pattern or command is no target").toBe("");
  });

  it("places no call when the timeline carries a sub-agent or is absent", () => {
    const turn = turnWith([{ name: "read_file" }]);
    const withSubAgent = timeline(["model_round", "sub_agent:explore", "model_round", "tool:read_file", "model_round"]);
    expect(toolCallFacts(turn, withSubAgent)[0]?.round).toBeNull();
    expect(toolCallFacts(turn, null)[0]?.round).toBeNull();
    expect(toolCallFacts(undefined, null)).toEqual([]);
  });

  it("keeps the start of the span a call was placed on, null where it is unplaced, and marks a shell call that asked for the background", () => {
    const turn = turnWith([
      { name: "execute", args: { command: "go test ./integration", background: true } },
      { name: "execute", args: { command: "go test ./duration", background: false } },
      { name: "read_file", args: { file_path: "/a.go", background: true } },
    ]);
    const facts = toolCallFacts(turn, timeline(["model_round", "tool:execute", "tool:execute", "model_round"]));
    expect(facts.map((fact) => [fact.start_ms, fact.background])).toEqual([
      [10, true],
      [20, undefined],
      [null, undefined],
    ]);
    expect(facts[1], "only `true` is recorded").not.toHaveProperty("background");
    expect(toolCallFacts(turn, null).every((fact) => fact.start_ms === null)).toBe(true);
  });

  it("leaves a call the timeline never saw unplaced", () => {
    const turn = turnWith([{ name: "think" }]);
    expect(toolCallFacts(turn, timeline(["model_round"]))[0]?.round).toBeNull();
  });

  it("keeps a paged read's window and nothing when the call set none", () => {
    const turn = turnWith([
      { name: "read_file", args: { file_path: "/a.go", offset: 100, limit: 100 } },
      { name: "read_file", args: { file_path: "/b.go" } },
    ]);
    const [paged, whole] = toolCallFacts(turn, null);
    expect(paged).toMatchObject({ offset: 100, limit: 100 });
    expect(whole).not.toHaveProperty("offset");
    expect(whole).not.toHaveProperty("limit");
  });

  it("names each call's state as the log folds it", () => {
    const turn = turnFrom([userMessage("go"), use("c0", "execute", { command: "ls" })]);
    expect(toolCallFacts(turn, null)[0]).toMatchObject({ status: "running", outcome: "unsettled" });
  });
});

describe("outcomeOf", () => {
  const completed = (text: string): Pick<ToolUse, "state" | "result"> => ({
    state: "completed",
    result: { id: "r", text, isError: false, processedAt: "" },
  });

  it("reads the engine's returned edit failures in both backends' words", () => {
    expect(outcomeOf(completed("Error: String not found in file: 'return 0'"))).toBe("not_found");
    expect(outcomeOf(completed("String not found in file '/duration/duration.go'"))).toBe("not_found");
    expect(
      outcomeOf(completed("Error: String 'x' has multiple occurrences (appears 2 times) in file. Use replace_all=True ...")),
    ).toBe("not_unique");
    expect(outcomeOf(completed("Multiple occurrences found in '/a.go'. Use replaceAll=true to replace all."))).toBe("not_unique");
  });

  it("reads any other returned error as failed, and a plain result as ok", () => {
    expect(outcomeOf(completed("Error: File '/missing.go' not found"))).toBe("failed");
    expect(outcomeOf(completed("Successfully replaced 1 occurrence(s) in '/a.go'"))).toBe("ok");
  });

  it("maps the states that are not a completion", () => {
    const turn = turnFrom([
      userMessage("go"),
      use("c0", "execute", { command: "rm" }),
      result("c0", "boom", { isError: true }),
      use("c1", "execute", { command: "rm -rf" }),
      denied("c1"),
    ]);
    const [failed, refused] = turn.items.filter((item): item is ToolUse => item.kind === "tool_use");
    expect(outcomeOf(failed!)).toBe("failed");
    expect(outcomeOf(refused!)).toBe("skipped");
    expect(outcomeOf({ state: "stopped", result: undefined })).toBe("unsettled");
  });
});

describe("targetOf", () => {
  it("prefers file_path, then path, then pattern, then the command's head", () => {
    expect(targetOf({ file_path: "/a.go", path: "/", pattern: "x" })).toBe("/a.go");
    expect(targetOf({ path: "/src", pattern: "x" })).toBe("/src");
    expect(targetOf({ pattern: "**/*.go" })).toBe("**/*.go");
    const command = "x".repeat(COMMAND_TARGET_CHARS + 20);
    expect(targetOf({ command })).toBe("x".repeat(COMMAND_TARGET_CHARS));
    expect(targetOf({ thought: "a" })).toBe("");
  });
});

describe("todoCounts", () => {
  it("counts the final list by state", () => {
    const turn = turnFrom([
      userMessage("go"),
      use("t0", "write_todos", {
        todos: [
          { content: "one", status: "completed" },
          { content: "two", status: "in_progress" },
          { content: "three", status: "pending" },
          { content: "four", status: "pending" },
        ],
      }),
      result("t0", "ok"),
    ]);
    expect(todoCounts(turn)).toEqual({ pending: 2, in_progress: 1, completed: 1, cancelled: 0 });
  });

  it("reads a turn with no list as all zeros", () => {
    expect(todoCounts(turnWith([]))).toEqual({ pending: 0, in_progress: 0, completed: 0, cancelled: 0 });
    expect(todoCounts(undefined)).toEqual({ pending: 0, in_progress: 0, completed: 0, cancelled: 0 });
  });
});
