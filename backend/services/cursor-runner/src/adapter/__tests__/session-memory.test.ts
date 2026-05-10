import { describe, it, expect, vi, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { TodoItemSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { SessionMemorySchema, ConversationTurnSchema, ToolObservationSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";
import { MessageType, ToolCallStatus, TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import type { ConversationTurn } from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";
import {
  estimateTokens,
  truncateToTokenBudget,
  extractChangedFiles,
  extractToolObservations,
  extractRecentTurns,
  extractDecisions,
  extractFailedAttempts,
  extractOpenTasks,
  buildDurableSummary,
  buildSessionMemory,
  persistSessionMemory,
} from "../session-memory.js";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function aiMessage(content: string, toolCalls: ReturnType<typeof toolCall>[] = []): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content,
    timestamp: "2026-05-09T15:30:00.000Z",
    toolCalls,
  });
}

function toolCall(
  name: string,
  status: ToolCallStatus,
  opts: { argsPreview?: string; result?: string; error?: string } = {},
) {
  return create(ToolCallSchema, {
    id: `tc-${Math.random().toString(36).slice(2, 8)}`,
    name,
    status,
    argsPreview: opts.argsPreview ?? "",
    result: opts.result ?? "",
    error: opts.error ?? "",
  });
}

function todoItem(
  content: string,
  status: TodoStatus,
): TodoItem {
  return create(TodoItemSchema, {
    id: `todo-${Math.random().toString(36).slice(2, 8)}`,
    content,
    status,
  });
}

function turn(role: string, content: string): ConversationTurn {
  return create(ConversationTurnSchema, {
    role,
    content,
    timestamp: "2026-05-09T15:00:00.000Z",
  });
}

// ---------------------------------------------------------------------------
// estimateTokens / truncateToTokenBudget
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("returns ceil(length / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("truncateToTokenBudget", () => {
  it("returns text unchanged when within budget", () => {
    const text = "short text";
    expect(truncateToTokenBudget(text, 100)).toBe(text);
  });

  it("truncates to last N chars with [truncated] prefix", () => {
    const text = "a".repeat(100);
    const result = truncateToTokenBudget(text, 5); // 5 tokens = 20 chars
    expect(result).toMatch(/^\[truncated\] /);
    expect(result).toBe("[truncated] " + "a".repeat(20));
  });

  it("keeps the tail of the string when truncating", () => {
    const text = "START" + "x".repeat(100) + "END";
    const result = truncateToTokenBudget(text, 5);
    expect(result).toContain("END");
    expect(result).not.toContain("START");
  });
});

// ---------------------------------------------------------------------------
// extractChangedFiles
// ---------------------------------------------------------------------------

describe("extractChangedFiles", () => {
  it("extracts paths from Write tool calls", () => {
    const messages = [
      aiMessage("writing file", [
        toolCall("Write", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ path: "/workspace/src/index.ts", contents: "..." }),
        }),
      ]),
    ];
    expect(extractChangedFiles(messages)).toEqual(["/workspace/src/index.ts"]);
  });

  it("extracts paths from StrReplace tool calls", () => {
    const messages = [
      aiMessage("editing", [
        toolCall("StrReplace", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ path: "/workspace/config.json", old_string: "a", new_string: "b" }),
        }),
      ]),
    ];
    expect(extractChangedFiles(messages)).toEqual(["/workspace/config.json"]);
  });

  it("extracts paths from Delete tool calls", () => {
    const messages = [
      aiMessage("deleting", [
        toolCall("Delete", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ path: "/workspace/old.txt" }),
        }),
      ]),
    ];
    expect(extractChangedFiles(messages)).toEqual(["/workspace/old.txt"]);
  });

  it("extracts paths from EditNotebook using target_notebook", () => {
    const messages = [
      aiMessage("editing notebook", [
        toolCall("EditNotebook", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ target_notebook: "/workspace/notebook.ipynb", cell_idx: 0 }),
        }),
      ]),
    ];
    expect(extractChangedFiles(messages)).toEqual(["/workspace/notebook.ipynb"]);
  });

  it("deduplicates paths", () => {
    const messages = [
      aiMessage("first edit", [
        toolCall("Write", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ path: "/workspace/a.ts" }),
        }),
      ]),
      aiMessage("second edit", [
        toolCall("StrReplace", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ path: "/workspace/a.ts" }),
        }),
      ]),
    ];
    expect(extractChangedFiles(messages)).toEqual(["/workspace/a.ts"]);
  });

  it("returns sorted paths", () => {
    const messages = [
      aiMessage("edits", [
        toolCall("Write", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ path: "/workspace/z.ts" }),
        }),
        toolCall("Write", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ path: "/workspace/a.ts" }),
        }),
      ]),
    ];
    expect(extractChangedFiles(messages)).toEqual(["/workspace/a.ts", "/workspace/z.ts"]);
  });

  it("ignores non-file-mutation tools", () => {
    const messages = [
      aiMessage("reading", [
        toolCall("Read", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ path: "/workspace/read.ts" }),
        }),
        toolCall("Shell", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ command: "ls" }),
        }),
        toolCall("Grep", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ pattern: "foo" }),
        }),
      ]),
    ];
    expect(extractChangedFiles(messages)).toEqual([]);
  });

  it("ignores failed file tool calls", () => {
    const messages = [
      aiMessage("failed write", [
        toolCall("Write", ToolCallStatus.TOOL_CALL_FAILED, {
          argsPreview: JSON.stringify({ path: "/workspace/fail.ts" }),
          error: "Permission denied",
        }),
      ]),
    ];
    expect(extractChangedFiles(messages)).toEqual([]);
  });

  it("handles malformed argsPreview gracefully", () => {
    const messages = [
      aiMessage("bad args", [
        toolCall("Write", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: "not json",
        }),
        toolCall("Write", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: "",
        }),
        toolCall("Write", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ contents: "no path field" }),
        }),
      ]),
    ];
    expect(extractChangedFiles(messages)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractToolObservations
// ---------------------------------------------------------------------------

describe("extractToolObservations", () => {
  it("extracts completed Shell tool calls", () => {
    const messages = [
      aiMessage("running commands", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ command: "npm install", working_directory: "/workspace" }),
          result: "added 42 packages",
        }),
      ]),
    ];
    const obs = extractToolObservations(messages);
    expect(obs).toHaveLength(1);
    expect(obs[0].command).toBe("npm install");
    expect(obs[0].cwd).toBe("/workspace");
    expect(obs[0].exitCode).toBe(0);
    expect(obs[0].summary).toBe("added 42 packages");
  });

  it("extracts failed Shell tool calls with exit code 1", () => {
    const messages = [
      aiMessage("failing", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_FAILED, {
          argsPreview: JSON.stringify({ command: "make build" }),
          error: "compilation error",
        }),
      ]),
    ];
    const obs = extractToolObservations(messages);
    expect(obs).toHaveLength(1);
    expect(obs[0].exitCode).toBe(1);
    expect(obs[0].summary).toBe("compilation error");
  });

  it("uses cwd field as fallback for working_directory", () => {
    const messages = [
      aiMessage("cmd", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ command: "ls", cwd: "/home" }),
          result: "file.txt",
        }),
      ]),
    ];
    expect(extractToolObservations(messages)[0].cwd).toBe("/home");
  });

  it("ignores non-Shell tool calls", () => {
    const messages = [
      aiMessage("reading", [
        toolCall("Read", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ path: "/file" }),
          result: "file contents",
        }),
      ]),
    ];
    expect(extractToolObservations(messages)).toEqual([]);
  });

  it("ignores Shell calls with RUNNING status", () => {
    const messages = [
      aiMessage("in progress", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_RUNNING, {
          argsPreview: JSON.stringify({ command: "npm test" }),
        }),
      ]),
    ];
    expect(extractToolObservations(messages)).toEqual([]);
  });

  it("FIFO-prunes to most recent 10 entries", () => {
    const calls = Array.from({ length: 15 }, (_, i) =>
      toolCall("Shell", ToolCallStatus.TOOL_CALL_COMPLETED, {
        argsPreview: JSON.stringify({ command: `cmd-${i}` }),
        result: `result-${i}`,
      }),
    );
    const messages = [aiMessage("many commands", calls)];
    const obs = extractToolObservations(messages);
    expect(obs).toHaveLength(10);
    expect(obs[0].command).toBe("cmd-5");
    expect(obs[9].command).toBe("cmd-14");
  });

  it("truncates summary to 200 chars", () => {
    const longResult = "x".repeat(500);
    const messages = [
      aiMessage("long output", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ command: "cat bigfile" }),
          result: longResult,
        }),
      ]),
    ];
    const obs = extractToolObservations(messages);
    expect(obs[0].summary.length).toBeLessThanOrEqual(200);
  });

  it("skips Shell calls with empty command", () => {
    const messages = [
      aiMessage("empty", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({}),
          result: "output",
        }),
      ]),
    ];
    expect(extractToolObservations(messages)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractRecentTurns
// ---------------------------------------------------------------------------

describe("extractRecentTurns", () => {
  it("appends user and assistant turns from current execution", () => {
    const messages = [aiMessage("I completed the task.")];
    const turns = extractRecentTurns("Fix the bug", messages, []);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toBe("Fix the bug");
    expect(turns[1].role).toBe("assistant");
    expect(turns[1].content).toBe("I completed the task.");
  });

  it("carries forward previous turns", () => {
    const prev = [turn("user", "hello"), turn("assistant", "hi there")];
    const messages = [aiMessage("done")];
    const turns = extractRecentTurns("next task", messages, prev);
    expect(turns).toHaveLength(4);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toBe("hello");
  });

  it("FIFO-prunes to last 6 turns", () => {
    const prev = Array.from({ length: 8 }, (_, i) =>
      turn(i % 2 === 0 ? "user" : "assistant", `turn-${i}`),
    );
    const messages = [aiMessage("final")];
    const turns = extractRecentTurns("latest", messages, prev);
    expect(turns.length).toBeLessThanOrEqual(6);
  });

  it("truncates individual turns exceeding 1k tokens", () => {
    const longContent = "x".repeat(8000); // 2k tokens, over 1k limit
    const messages = [aiMessage(longContent)];
    const turns = extractRecentTurns("short", messages, []);
    const assistantTurn = turns.find((t) => t.role === "assistant")!;
    expect(assistantTurn.content).toMatch(/^\[truncated\]/);
    expect(assistantTurn.content.length).toBeLessThanOrEqual(4000 + "[truncated] ".length);
  });

  it("concatenates multiple AI messages into one assistant turn", () => {
    const messages = [
      aiMessage("Part one."),
      aiMessage("Part two."),
    ];
    const turns = extractRecentTurns("query", messages, []);
    const assistantTurns = turns.filter((t) => t.role === "assistant");
    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0].content).toContain("Part one.");
    expect(assistantTurns[0].content).toContain("Part two.");
  });

  it("handles empty user message", () => {
    const messages = [aiMessage("response")];
    const turns = extractRecentTurns("", messages, []);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe("assistant");
  });

  it("handles empty messages array", () => {
    const turns = extractRecentTurns("hello", [], []);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe("user");
  });
});

// ---------------------------------------------------------------------------
// extractDecisions
// ---------------------------------------------------------------------------

describe("extractDecisions", () => {
  it("captures Decision: markers", () => {
    const messages = [
      aiMessage("Analysis complete.\nDecision: Use PostgreSQL over MySQL for better JSON support."),
    ];
    const decisions = extractDecisions(messages, []);
    expect(decisions).toEqual(["Use PostgreSQL over MySQL for better JSON support."]);
  });

  it("captures Design choice: markers (case-insensitive)", () => {
    const messages = [
      aiMessage("design choice: Use React over Vue for consistency with existing stack."),
    ];
    const decisions = extractDecisions(messages, []);
    expect(decisions).toEqual(["Use React over Vue for consistency with existing stack."]);
  });

  it("merges with previous decisions", () => {
    const messages = [
      aiMessage("Decision: Use TypeScript."),
    ];
    const decisions = extractDecisions(messages, ["Use ESLint."]);
    expect(decisions).toEqual(["Use ESLint.", "Use TypeScript."]);
  });

  it("deduplicates exact matches", () => {
    const messages = [
      aiMessage("Decision: Use TypeScript.\nDecision: Use TypeScript."),
    ];
    const decisions = extractDecisions(messages, ["Use TypeScript."]);
    expect(decisions).toEqual(["Use TypeScript."]);
  });

  it("does not capture conversational language about decisions", () => {
    const messages = [
      aiMessage("I decided to use PostgreSQL. Let me read the config file."),
      aiMessage("The decision was made earlier."),
    ];
    const decisions = extractDecisions(messages, []);
    expect(decisions).toEqual([]);
  });

  it("caps at 20 entries with FIFO eviction", () => {
    const prev = Array.from({ length: 19 }, (_, i) => `Decision ${i}`);
    const messages = [
      aiMessage("Decision: New decision A.\nDecision: New decision B."),
    ];
    const decisions = extractDecisions(messages, prev);
    expect(decisions).toHaveLength(20);
    expect(decisions[0]).toBe("Decision 1");
    expect(decisions[19]).toBe("New decision B.");
  });

  it("ignores non-AI messages", () => {
    const messages = [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_HUMAN,
        content: "Decision: User typed this.",
        timestamp: "2026-05-09T15:30:00.000Z",
      }),
    ];
    const decisions = extractDecisions(messages, []);
    expect(decisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractFailedAttempts
// ---------------------------------------------------------------------------

describe("extractFailedAttempts", () => {
  it("captures failed tool calls", () => {
    const messages = [
      aiMessage("trying", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_FAILED, {
          argsPreview: JSON.stringify({ command: "make build" }),
          error: "exit code 2: missing dependency",
        }),
      ]),
    ];
    const attempts = extractFailedAttempts(messages, []);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toBe("Shell: exit code 2: missing dependency");
  });

  it("merges with previous attempts", () => {
    const messages = [
      aiMessage("retry", [
        toolCall("Write", ToolCallStatus.TOOL_CALL_FAILED, {
          error: "Permission denied",
        }),
      ]),
    ];
    const attempts = extractFailedAttempts(messages, ["Shell: network error"]);
    expect(attempts).toEqual(["Shell: network error", "Write: Permission denied"]);
  });

  it("deduplicates exact matches", () => {
    const messages = [
      aiMessage("same failure", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_FAILED, {
          error: "timeout",
        }),
      ]),
    ];
    const attempts = extractFailedAttempts(messages, ["Shell: timeout"]);
    expect(attempts).toEqual(["Shell: timeout"]);
  });

  it("truncates entries to 200 chars", () => {
    const messages = [
      aiMessage("long error", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_FAILED, {
          error: "e".repeat(300),
        }),
      ]),
    ];
    const attempts = extractFailedAttempts(messages, []);
    expect(attempts[0].length).toBeLessThanOrEqual(200);
  });

  it("caps at 20 entries", () => {
    const prev = Array.from({ length: 19 }, (_, i) => `Failure ${i}`);
    const messages = [
      aiMessage("failures", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_FAILED, { error: "err-a" }),
        toolCall("Shell", ToolCallStatus.TOOL_CALL_FAILED, { error: "err-b" }),
      ]),
    ];
    const attempts = extractFailedAttempts(messages, prev);
    expect(attempts).toHaveLength(20);
    expect(attempts[0]).toBe("Failure 1");
  });

  it("uses result as fallback when error is empty", () => {
    const messages = [
      aiMessage("no error field", [
        toolCall("Write", ToolCallStatus.TOOL_CALL_FAILED, {
          result: "Error: file not found",
        }),
      ]),
    ];
    const attempts = extractFailedAttempts(messages, []);
    expect(attempts[0]).toBe("Write: Error: file not found");
  });

  it("falls back to 'unknown error' when both are empty", () => {
    const messages = [
      aiMessage("empty error", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_FAILED, {}),
      ]),
    ];
    const attempts = extractFailedAttempts(messages, []);
    expect(attempts[0]).toBe("Shell: unknown error");
  });

  it("ignores completed tool calls", () => {
    const messages = [
      aiMessage("success", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_COMPLETED, {
          result: "ok",
        }),
      ]),
    ];
    expect(extractFailedAttempts(messages, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractOpenTasks
// ---------------------------------------------------------------------------

describe("extractOpenTasks", () => {
  it("extracts pending and in-progress todos", () => {
    const todos: { [key: string]: TodoItem } = {
      a: todoItem("Set up database", TodoStatus.TODO_PENDING),
      b: todoItem("Write tests", TodoStatus.TODO_IN_PROGRESS),
      c: todoItem("Deploy", TodoStatus.TODO_COMPLETED),
      d: todoItem("Old task", TodoStatus.TODO_CANCELLED),
    };
    const tasks = extractOpenTasks(todos);
    expect(tasks).toHaveLength(2);
    expect(tasks).toContain("Set up database");
    expect(tasks).toContain("Write tests");
  });

  it("returns empty for no pending/in-progress todos", () => {
    const todos: { [key: string]: TodoItem } = {
      a: todoItem("Done", TodoStatus.TODO_COMPLETED),
    };
    expect(extractOpenTasks(todos)).toEqual([]);
  });

  it("returns empty for empty todos map", () => {
    expect(extractOpenTasks({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildDurableSummary
// ---------------------------------------------------------------------------

describe("buildDurableSummary", () => {
  it("uses content of the last AI message", () => {
    const messages = [
      aiMessage("First response."),
      aiMessage("Final summary of work."),
    ];
    expect(buildDurableSummary(messages, "")).toBe("Final summary of work.");
  });

  it("carries forward previous summary when no AI messages", () => {
    expect(buildDurableSummary([], "Previous summary.")).toBe("Previous summary.");
  });

  it("carries forward previous summary when last AI content is empty", () => {
    const messages = [aiMessage("")];
    expect(buildDurableSummary(messages, "Previous summary.")).toBe("Previous summary.");
  });

  it("truncates to 2k token budget", () => {
    const longContent = "x".repeat(16000); // 4k tokens, over 2k limit
    const messages = [aiMessage(longContent)];
    const summary = buildDurableSummary(messages, "");
    expect(summary).toMatch(/^\[truncated\]/);
    expect(summary.length).toBeLessThanOrEqual(8000 + "[truncated] ".length);
  });

  it("does not truncate content within budget", () => {
    const content = "Completed all 5 tasks successfully.";
    const messages = [aiMessage(content)];
    expect(buildDurableSummary(messages, "")).toBe(content);
  });

  it("ignores non-AI messages for summary extraction", () => {
    const messages = [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_HUMAN,
        content: "User message.",
        timestamp: "2026-05-09T15:30:00.000Z",
      }),
    ];
    expect(buildDurableSummary(messages, "old")).toBe("old");
  });
});

// ---------------------------------------------------------------------------
// buildSessionMemory (orchestrator)
// ---------------------------------------------------------------------------

describe("buildSessionMemory", () => {
  it("builds memory from a realistic execution", () => {
    const messages: AgentMessage[] = [
      aiMessage("Decision: Use vitest for testing.\nI'll start by writing the config file.", [
        toolCall("Write", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ path: "/workspace/vitest.config.ts" }),
        }),
        toolCall("Shell", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ command: "npm install vitest", working_directory: "/workspace" }),
          result: "added 12 packages",
        }),
      ]),
      aiMessage("Tests are passing. All done!", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_COMPLETED, {
          argsPreview: JSON.stringify({ command: "npm test" }),
          result: "3 tests passed",
        }),
      ]),
    ];

    const todos: { [key: string]: TodoItem } = {
      t1: todoItem("Write integration tests", TodoStatus.TODO_PENDING),
      t2: todoItem("Configure CI", TodoStatus.TODO_COMPLETED),
    };

    const memory = buildSessionMemory({
      previousMemory: undefined,
      messages,
      todos,
      userMessage: "Set up the test framework",
    });

    expect(memory.durableSummary).toBe("Tests are passing. All done!");
    expect(memory.changedFiles).toEqual(["/workspace/vitest.config.ts"]);
    expect(memory.openTasks).toEqual(["Write integration tests"]);
    expect(memory.toolObservations).toHaveLength(2);
    expect(memory.recentTurns).toHaveLength(2);
    expect(memory.decisions).toEqual(["Use vitest for testing."]);
    expect(memory.failedAttempts).toEqual([]);
  });

  it("merges with previous memory", () => {
    const previousMemory = create(SessionMemorySchema, {
      durableSummary: "Old summary",
      decisions: ["Old decision"],
      failedAttempts: ["Old failure"],
      recentTurns: [turn("user", "old query"), turn("assistant", "old response")],
    });

    const messages: AgentMessage[] = [
      aiMessage("Decision: New approach.\nUpdated the module.", [
        toolCall("Shell", ToolCallStatus.TOOL_CALL_FAILED, {
          argsPreview: JSON.stringify({ command: "make build" }),
          error: "compilation error",
        }),
      ]),
    ];

    const memory = buildSessionMemory({
      previousMemory,
      messages,
      todos: {},
      userMessage: "Fix the build",
    });

    expect(memory.decisions).toEqual(["Old decision", "New approach."]);
    expect(memory.failedAttempts).toEqual(["Old failure", "Shell: compilation error"]);
    expect(memory.recentTurns.length).toBeGreaterThanOrEqual(3);
    expect(memory.durableSummary).toContain("Updated the module");
  });

  it("handles empty messages gracefully", () => {
    const memory = buildSessionMemory({
      previousMemory: create(SessionMemorySchema, {
        durableSummary: "Previous work",
      }),
      messages: [],
      todos: {},
      userMessage: "",
    });

    expect(memory.durableSummary).toBe("Previous work");
    expect(memory.changedFiles).toEqual([]);
    expect(memory.toolObservations).toEqual([]);
    expect(memory.recentTurns).toEqual([]);
    expect(memory.decisions).toEqual([]);
    expect(memory.failedAttempts).toEqual([]);
  });

  it("handles undefined previousMemory", () => {
    const memory = buildSessionMemory({
      previousMemory: undefined,
      messages: [aiMessage("Hello world")],
      todos: {},
      userMessage: "test",
    });

    expect(memory.durableSummary).toBe("Hello world");
    expect(memory.decisions).toEqual([]);
    expect(memory.failedAttempts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// persistSessionMemory
// ---------------------------------------------------------------------------

