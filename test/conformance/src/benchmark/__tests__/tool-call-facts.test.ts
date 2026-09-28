// Unit arms for the per-tool-call facts of a sample, over hand-built
// AgentExecution messages and turn timelines.
// Domain: conformance benchmark.
//
// Pinned: rows are read in start order across messages, whichever message
// the builder attached them to; each takes the round of the first unmatched
// timeline span of its name, an MCP span matching by its bare name; a
// timeline with a sub-agent, or none, places no call; the target is the
// first of `file_path`, `path`, `pattern`, else the command's head; a paged
// read keeps its window; a completed row whose result is the engine's
// returned edit failure is `not_found` or `not_unique` in both backends'
// words; the final to-do list is counted by state.
import { create } from "@bufbuild/protobuf";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { MessageType, TodoStatus, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { describe, expect, it } from "vitest";
import type { TimingLine } from "../report";
import { COMMAND_TARGET_CHARS, outcomeOf, targetOf, todoCounts, toolCallFacts } from "../tool-call-facts";

type RowInit = { name: string; startedAt: string; args?: Record<string, string | number>; result?: string; status?: ToolCallStatus };

function row({ name, startedAt, args = {}, result = "ok", status = ToolCallStatus.TOOL_CALL_COMPLETED }: RowInit) {
  return { id: `${name}-${startedAt}`, name, startedAt, args, result, status };
}

function execution(messages: RowInit[][]) {
  return create(AgentExecutionSchema, {
    status: {
      messages: messages.map((rows, index) => ({
        type: MessageType.MESSAGE_AI,
        content: `message ${index}`,
        toolCalls: rows.map(row),
      })),
    },
  });
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
  it("reads rows in start order and places each on its round, not on the message the builder attached it to", () => {
    // Round 1 wrote text and read two files; round 2 wrote no text, so the
    // builder attached its edit to the first message; round 3 ran the tests.
    const turn = execution([
      [
        { name: "read_file", startedAt: "2026-09-28T10:00:01Z", args: { file_path: "/duration/duration.go" } },
        { name: "read_file", startedAt: "2026-09-28T10:00:01.5Z", args: { file_path: "/duration/duration_test.go" } },
        { name: "edit_file", startedAt: "2026-09-28T10:00:03Z", args: { file_path: "/duration/duration.go" } },
      ],
      [{ name: "execute", startedAt: "2026-09-28T10:00:05Z", args: { command: "go test ./..." } }],
    ]);
    const facts = toolCallFacts(
      turn,
      timeline(["model_round", "tool:read_file", "tool:read_file", "model_round", "tool:edit_file", "model_round", "tool:execute", "model_round"]),
    );
    expect(facts.map(({ round, name, target }) => ({ round, name, target }))).toEqual([
      { round: 1, name: "read_file", target: "/duration/duration.go" },
      { round: 1, name: "read_file", target: "/duration/duration_test.go" },
      { round: 2, name: "edit_file", target: "/duration/duration.go" },
      { round: 3, name: "execute", target: "go test ./..." },
    ]);
  });

  it("matches an MCP tool's span by its bare name", () => {
    const turn = execution([[{ name: "lookup_order", startedAt: "2026-09-28T10:00:01Z", args: { order_id: "ORD-4821" } }]]);
    const [fact] = toolCallFacts(turn, timeline(["model_round", "tool:orders-api/lookup_order", "model_round"]));
    expect(fact?.round).toBe(1);
    expect(fact?.target, "an argument that names no path, pattern or command is no target").toBe("");
  });

  it("places no call when the timeline carries a sub-agent or is absent", () => {
    const turn = execution([[{ name: "read_file", startedAt: "2026-09-28T10:00:01Z" }]]);
    const withSubAgent = timeline(["model_round", "sub_agent:explore", "model_round", "tool:read_file", "model_round"]);
    expect(toolCallFacts(turn, withSubAgent)[0]?.round).toBeNull();
    expect(toolCallFacts(turn, null)[0]?.round).toBeNull();
  });

  it("leaves a call the timeline never saw unplaced", () => {
    const turn = execution([[{ name: "think", startedAt: "2026-09-28T10:00:01Z" }]]);
    expect(toolCallFacts(turn, timeline(["model_round"]))[0]?.round).toBeNull();
  });

  it("keeps a paged read's window and nothing when the call set none", () => {
    const turn = execution([
      [
        { name: "read_file", startedAt: "2026-09-28T10:00:01Z", args: { file_path: "/a.go", offset: 100, limit: 100 } },
        { name: "read_file", startedAt: "2026-09-28T10:00:02Z", args: { file_path: "/b.go" } },
      ],
    ]);
    const [paged, whole] = toolCallFacts(turn, null);
    expect(paged).toMatchObject({ offset: 100, limit: 100 });
    expect(whole).not.toHaveProperty("offset");
    expect(whole).not.toHaveProperty("limit");
  });

  it("names each row's status without the enum prefix", () => {
    const turn = execution([[{ name: "execute", startedAt: "2026-09-28T10:00:01Z", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL }]]);
    expect(toolCallFacts(turn, null)[0]).toMatchObject({ status: "waiting_approval", outcome: "unsettled" });
  });
});

describe("outcomeOf", () => {
  const completed = (result: string) => create(ToolCallSchema, { status: ToolCallStatus.TOOL_CALL_COMPLETED, result });

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

  it("maps the settled statuses that are not a completion", () => {
    expect(outcomeOf(create(ToolCallSchema, { status: ToolCallStatus.TOOL_CALL_FAILED, error: "boom" }))).toBe("failed");
    expect(outcomeOf(create(ToolCallSchema, { status: ToolCallStatus.TOOL_CALL_SKIPPED }))).toBe("skipped");
    expect(outcomeOf(create(ToolCallSchema, { status: ToolCallStatus.TOOL_CALL_INTERRUPTED }))).toBe("unsettled");
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
  it("counts the final list by state, an unset state as pending", () => {
    const turn = create(AgentExecutionSchema, {
      status: {
        todos: {
          a: { content: "one", status: TodoStatus.TODO_COMPLETED },
          b: { content: "two", status: TodoStatus.TODO_IN_PROGRESS },
          c: { content: "three", status: TodoStatus.TODO_PENDING },
          d: { content: "four" },
        },
      },
    });
    expect(todoCounts(turn)).toEqual({ pending: 2, in_progress: 1, completed: 1, cancelled: 0 });
  });

  it("reads an execution with no list as all zeros", () => {
    expect(todoCounts(create(AgentExecutionSchema, {}))).toEqual({ pending: 0, in_progress: 0, completed: 0, cancelled: 0 });
  });
});
