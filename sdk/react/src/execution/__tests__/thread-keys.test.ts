import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  TodoItemSchema,
  type TodoItem,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import {
  ExecutionPhase,
  MessageType,
  TodoStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { buildThreadItems } from "../MessageThread";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  type: MessageType,
  content: string,
  opts?: { toolCalls?: ReturnType<typeof makeToolCall>[]; isStreaming?: boolean },
) {
  const msg = create(AgentMessageSchema);
  msg.type = type;
  msg.content = content;
  if (opts?.toolCalls) {
    msg.toolCalls = opts.toolCalls;
  }
  if (opts?.isStreaming) {
    msg.isStreaming = true;
  }
  return msg;
}

function makeToolCall(name: string, id: string) {
  const tc = create(ToolCallSchema);
  tc.id = id;
  tc.name = name;
  tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
  return tc;
}

function makeSubAgent(id: string) {
  const sa = create(SubAgentExecutionSchema);
  sa.id = id;
  sa.name = "test-agent";
  return sa;
}

function makeTodo(id: string, content: string, status: TodoStatus): TodoItem {
  return create(TodoItemSchema, { id, content, status });
}

/** Build the `status.todos` proto map from a list of items, keyed by id. */
function todoMap(items: TodoItem[]): { [id: string]: TodoItem } {
  const map: { [id: string]: TodoItem } = {};
  for (const t of items) map[t.id] = t;
  return map;
}

function makeExecution(opts: {
  id: string;
  specMessage?: string;
  phase?: ExecutionPhase;
  messages?: ReturnType<typeof makeMessage>[];
  subAgents?: ReturnType<typeof makeSubAgent>[];
  todos?: { [id: string]: TodoItem };
}): AgentExecution {
  const exec = create(AgentExecutionSchema);

  const meta = create(ApiResourceMetadataSchema);
  meta.id = opts.id;
  exec.metadata = meta;

  if (opts.specMessage) {
    const spec = create(AgentExecutionSpecSchema);
    spec.message = opts.specMessage;
    exec.spec = spec;
  }

  const status = create(AgentExecutionStatusSchema);
  status.phase = opts.phase ?? ExecutionPhase.EXECUTION_COMPLETED;
  if (opts.messages) {
    status.messages = opts.messages;
  }
  if (opts.subAgents) {
    status.subAgentExecutions = opts.subAgents;
  }
  if (opts.todos) {
    status.todos = opts.todos;
  }
  exec.status = status;

  return exec;
}

function extractKeys(items: { key: string }[]): string[] {
  return items.map((i) => i.key);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildThreadItems key generation", () => {
  it("uses execution ID in message keys, not array index", () => {
    const exec = makeExecution({
      id: "exec-abc",
      specMessage: "Hello",
      messages: [
        makeMessage(MessageType.MESSAGE_HUMAN, "Hello"),
        makeMessage(MessageType.MESSAGE_AI, "Hi there"),
      ],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const keys = extractKeys(items);

    expect(keys).toContain("exec-abc-spec");
    expect(keys).toContain("exec-abc-m0");
    expect(keys).toContain("exec-abc-m1");
    for (const k of keys) {
      expect(k).not.toMatch(/^e\d+-/);
    }
  });

  it("uses execution ID for tool group keys", () => {
    const tc = makeToolCall("shell", "tc-001");
    const aiMsg = makeMessage(MessageType.MESSAGE_AI, "Running tool", {
      toolCalls: [tc],
    });

    const exec = makeExecution({
      id: "exec-xyz",
      messages: [aiMsg],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const keys = extractKeys(items);

    expect(keys).toContain("exec-xyz-m0");
    expect(keys).toContain("exec-xyz-m0-tc");
  });

  it("uses SubAgentExecution.id for sub-agent keys", () => {
    const taskTc = makeToolCall("task", "sa-id-42");
    const aiMsg = makeMessage(MessageType.MESSAGE_AI, "Delegating", {
      toolCalls: [taskTc],
    });
    const subAgent = makeSubAgent("sa-id-42");

    const exec = makeExecution({
      id: "exec-parent",
      messages: [aiMsg],
      subAgents: [subAgent],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const keys = extractKeys(items);

    expect(keys).toContain("sa-sa-id-42");
  });

  it("keys are stable when execution moves from active to completed", () => {
    const messages = [
      makeMessage(MessageType.MESSAGE_HUMAN, "Hello"),
      makeMessage(MessageType.MESSAGE_AI, "Response"),
    ];

    const exec = makeExecution({
      id: "exec-stable",
      specMessage: "Hello",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages,
    });

    // Phase A: execution is the active stream
    const itemsActive = buildThreadItems([], exec, null, false, undefined);

    // Phase B: same execution is now completed (in the list, no active stream)
    const completedExec = makeExecution({
      id: "exec-stable",
      specMessage: "Hello",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      messages,
    });
    const itemsCompleted = buildThreadItems(
      [completedExec],
      null,
      null,
      false,
      undefined,
    );

    const keysActive = extractKeys(itemsActive);
    const keysCompleted = extractKeys(itemsCompleted);

    // Spec message key and all message keys should be identical
    expect(keysActive).toContain("exec-stable-spec");
    expect(keysCompleted).toContain("exec-stable-spec");
    expect(keysActive).toContain("exec-stable-m0");
    expect(keysCompleted).toContain("exec-stable-m0");
    expect(keysActive).toContain("exec-stable-m1");
    expect(keysCompleted).toContain("exec-stable-m1");
  });

  describe("pending → confirmed message bridging", () => {
    it("pending message gets 'pending-user-turn' key", () => {
      const items = buildThreadItems([], null, "Hello world", false, undefined);
      const last = items[items.length - 1];

      expect(last.key).toBe("pending-user-turn");
      expect(last.kind).toBe("message");
      if (last.kind === "message") {
        expect(last.isPending).toBe(true);
        expect(last.message.content).toBe("Hello world");
        expect(last.message.type).toBe(MessageType.MESSAGE_HUMAN);
      }
    });

    it("active stream spec message uses bridging key when matching pending", () => {
      const activeExec = makeExecution({
        id: "exec-new",
        specMessage: "Hello world",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      });

      const items = buildThreadItems(
        [],
        activeExec,
        "Hello world",
        false,
        undefined,
      );
      const keys = extractKeys(items);

      expect(keys).toContain("pending-user-turn");
      expect(keys).not.toContain("exec-new-spec");
    });

    it("spec message gets permanent key when no pending user message", () => {
      const exec = makeExecution({
        id: "exec-done",
        specMessage: "Hello world",
      });

      const items = buildThreadItems([exec], null, null, false, undefined);
      const keys = extractKeys(items);

      expect(keys).toContain("exec-done-spec");
      expect(keys).not.toContain("pending-user-turn");
    });

    it("spec message gets permanent key when pending does not match", () => {
      const activeExec = makeExecution({
        id: "exec-mismatch",
        specMessage: "Original message",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      });

      const items = buildThreadItems(
        [],
        activeExec,
        "Different message",
        false,
        undefined,
      );
      const keys = extractKeys(items);

      expect(keys).toContain("exec-mismatch-spec");
      // Pending message is also present because alreadySynthesized is false
      expect(keys).toContain("pending-user-turn");
    });

    it("pending message is suppressed when alreadySynthesized", () => {
      const activeExec = makeExecution({
        id: "exec-synth",
        specMessage: "Hello",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      });

      const items = buildThreadItems(
        [],
        activeExec,
        "Hello",
        false,
        undefined,
      );

      const pendingItems = items.filter(
        (i) => i.kind === "message" && "isPending" in i && i.isPending,
      );
      expect(pendingItems).toHaveLength(0);
    });

    it("completed execution spec message uses permanent key even with pending", () => {
      const completedExec = makeExecution({
        id: "exec-old",
        specMessage: "Old message",
      });
      const activeExec = makeExecution({
        id: "exec-current",
        specMessage: "New message",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      });

      const items = buildThreadItems(
        [completedExec],
        activeExec,
        "New message",
        false,
        undefined,
      );
      const keys = extractKeys(items);

      expect(keys).toContain("exec-old-spec");
      expect(keys).toContain("pending-user-turn");
    });
  });

  it("produces no duplicate keys in a realistic multi-execution scenario", () => {
    const tc1 = makeToolCall("shell", "tc-1");
    const tc2 = makeToolCall("task", "tc-2");
    const sa = makeSubAgent("tc-2");

    const exec1 = makeExecution({
      id: "exec-1",
      specMessage: "First turn",
      messages: [
        makeMessage(MessageType.MESSAGE_HUMAN, "First turn"),
        makeMessage(MessageType.MESSAGE_AI, "Working on it", {
          toolCalls: [tc1, tc2],
        }),
        makeMessage(MessageType.MESSAGE_TOOL, "shell output"),
        makeMessage(MessageType.MESSAGE_AI, "Done"),
      ],
      subAgents: [sa],
    });

    const exec2 = makeExecution({
      id: "exec-2",
      specMessage: "Second turn",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        makeMessage(MessageType.MESSAGE_THINKING, "Let me think..."),
        makeMessage(MessageType.MESSAGE_AI, "Here's my answer", {
          isStreaming: true,
        }),
      ],
    });

    const items = buildThreadItems(
      [exec1],
      exec2,
      "Second turn",
      false,
      undefined,
    );

    const keys = extractKeys(items);
    const uniqueKeys = new Set(keys);

    expect(keys.length).toBe(uniqueKeys.size);
    expect(keys.length).toBeGreaterThan(0);
  });

  it("skips MESSAGE_TOOL messages", () => {
    const exec = makeExecution({
      id: "exec-skip",
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "Using tool"),
        makeMessage(MessageType.MESSAGE_TOOL, "tool output"),
        makeMessage(MessageType.MESSAGE_AI, "Got result"),
      ],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const messageItems = items.filter((i) => i.kind === "message");

    expect(messageItems).toHaveLength(2);
    expect(messageItems[0].key).toBe("exec-skip-m0");
    // m1 is the TOOL message (skipped), m2 is the next AI message
    expect(messageItems[1].key).toBe("exec-skip-m2");
  });

  it("skips empty AI messages but still emits tool groups", () => {
    const tc = makeToolCall("read_file", "tc-empty");
    const exec = makeExecution({
      id: "exec-empty-ai",
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "  ", { toolCalls: [tc] }),
      ],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const kinds = items.map((i) => i.kind);

    expect(kinds).not.toContain("message");
    expect(kinds).toContain("tool-group");
    expect(items.find((i) => i.kind === "tool-group")!.key).toBe(
      "exec-empty-ai-m0-tc",
    );
  });

  it("falls back to index-based prefix when metadata.id is missing", () => {
    const exec = create(AgentExecutionSchema);
    const status = create(AgentExecutionStatusSchema);
    status.phase = ExecutionPhase.EXECUTION_COMPLETED;
    status.messages = [makeMessage(MessageType.MESSAGE_AI, "No metadata")];
    exec.status = status;

    const items = buildThreadItems([exec], null, null, false, undefined);

    expect(items[0].key).toBe("_e0-m0");
  });

  describe("setup-progress indicator lifecycle", () => {
    it("shows setup-progress during PENDING with no AI messages", () => {
      const exec = makeExecution({
        id: "exec-pending",
        specMessage: "Hello",
        phase: ExecutionPhase.EXECUTION_PENDING,
      });

      const items = buildThreadItems([], exec, null, false, undefined);
      const setupItem = items.find((i) => i.kind === "setup-progress");

      expect(setupItem).toBeDefined();
      expect(setupItem!.key).toBe("setup-progress");
      if (setupItem?.kind === "setup-progress") {
        expect(setupItem.isAwaitingResponse).toBeFalsy();
      }
    });

    it("shows setup-progress with isAwaitingResponse during IN_PROGRESS with no AI messages", () => {
      const exec = makeExecution({
        id: "exec-in-progress",
        specMessage: "Hello",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      });

      const items = buildThreadItems([], exec, null, false, undefined);
      const setupItem = items.find((i) => i.kind === "setup-progress");

      expect(setupItem).toBeDefined();
      expect(setupItem!.key).toBe("setup-progress");
      if (setupItem?.kind === "setup-progress") {
        expect(setupItem.isAwaitingResponse).toBe(true);
      }
    });

    it("hides setup-progress once AI messages arrive during IN_PROGRESS", () => {
      const exec = makeExecution({
        id: "exec-streaming",
        specMessage: "Hello",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        messages: [
          makeMessage(MessageType.MESSAGE_AI, "Here's my response"),
        ],
      });

      const items = buildThreadItems([], exec, null, false, undefined);
      const setupItem = items.find((i) => i.kind === "setup-progress");

      expect(setupItem).toBeUndefined();
    });

    it("hides setup-progress for terminal phases even without AI messages", () => {
      const exec = makeExecution({
        id: "exec-failed",
        specMessage: "Hello",
        phase: ExecutionPhase.EXECUTION_FAILED,
      });

      const items = buildThreadItems([], exec, null, false, undefined);
      const setupItem = items.find((i) => i.kind === "setup-progress");

      expect(setupItem).toBeUndefined();
    });

    it("does not show setup-progress for completed executions (not active stream)", () => {
      const exec = makeExecution({
        id: "exec-done",
        specMessage: "Hello",
        phase: ExecutionPhase.EXECUTION_PENDING,
      });

      const items = buildThreadItems([exec], null, null, false, undefined);
      const setupItem = items.find((i) => i.kind === "setup-progress");

      expect(setupItem).toBeUndefined();
    });

    it("preserves stable key across PENDING → IN_PROGRESS transition", () => {
      const pendingExec = makeExecution({
        id: "exec-transition",
        specMessage: "Hello",
        phase: ExecutionPhase.EXECUTION_PENDING,
      });
      const itemsPending = buildThreadItems([], pendingExec, null, false, undefined);

      const inProgressExec = makeExecution({
        id: "exec-transition",
        specMessage: "Hello",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      });
      const itemsInProgress = buildThreadItems([], inProgressExec, null, false, undefined);

      const pendingSetup = itemsPending.find((i) => i.kind === "setup-progress");
      const inProgressSetup = itemsInProgress.find((i) => i.kind === "setup-progress");

      expect(pendingSetup).toBeDefined();
      expect(inProgressSetup).toBeDefined();
      expect(pendingSetup!.key).toBe(inProgressSetup!.key);
    });
  });

  describe("internal tool filtering", () => {
    it("filters updateTodos tool calls from tool groups", () => {
      const tc = makeToolCall("updateTodos", "tc-todo");
      const exec = makeExecution({
        id: "exec-todo",
        messages: [
          makeMessage(MessageType.MESSAGE_AI, "Planning...", { toolCalls: [tc] }),
        ],
      });

      const items = buildThreadItems([exec], null, null, false, undefined);
      const toolGroups = items.filter((i) => i.kind === "tool-group");
      expect(toolGroups).toHaveLength(0);
    });

    it("filters TodoWrite tool calls from tool groups", () => {
      const tc = makeToolCall("TodoWrite", "tc-tw");
      const exec = makeExecution({
        id: "exec-tw",
        messages: [
          makeMessage(MessageType.MESSAGE_AI, "Planning...", { toolCalls: [tc] }),
        ],
      });

      const items = buildThreadItems([exec], null, null, false, undefined);
      const toolGroups = items.filter((i) => i.kind === "tool-group");
      expect(toolGroups).toHaveLength(0);
    });

    it("filters write_todos tool calls from tool groups", () => {
      const tc = makeToolCall("write_todos", "tc-wt");
      const exec = makeExecution({
        id: "exec-wt",
        messages: [
          makeMessage(MessageType.MESSAGE_AI, "Planning...", { toolCalls: [tc] }),
        ],
      });

      const items = buildThreadItems([exec], null, null, false, undefined);
      const toolGroups = items.filter((i) => i.kind === "tool-group");
      expect(toolGroups).toHaveLength(0);
    });

    it("preserves non-internal tools alongside filtered internal tools", () => {
      const shellTc = makeToolCall("Shell", "tc-shell");
      const todoTc = makeToolCall("updateTodos", "tc-todo");
      const exec = makeExecution({
        id: "exec-mixed",
        messages: [
          makeMessage(MessageType.MESSAGE_AI, "Working...", {
            toolCalls: [shellTc, todoTc],
          }),
        ],
      });

      const items = buildThreadItems([exec], null, null, false, undefined);
      const toolGroups = items.filter((i) => i.kind === "tool-group");
      expect(toolGroups).toHaveLength(1);
      expect(toolGroups[0].kind === "tool-group" && toolGroups[0].toolCalls).toHaveLength(1);
      expect(toolGroups[0].kind === "tool-group" && toolGroups[0].toolCalls[0].name).toBe("Shell");
    });

    it("empty AI message with only internal tools produces no items", () => {
      const todoTc = makeToolCall("updateTodos", "tc-todo");
      const exec = makeExecution({
        id: "exec-empty",
        messages: [
          makeMessage(MessageType.MESSAGE_AI, "  ", { toolCalls: [todoTc] }),
        ],
      });

      const items = buildThreadItems([exec], null, null, false, undefined);
      const messageItems = items.filter((i) => i.kind === "message");
      const toolGroups = items.filter((i) => i.kind === "tool-group");
      expect(messageItems).toHaveLength(0);
      expect(toolGroups).toHaveLength(0);
    });

    it("filters internal tools alongside task tool splitting", () => {
      const taskTc = makeToolCall("task", "tc-task");
      const todoTc = makeToolCall("updateTodos", "tc-todo");
      const shellTc = makeToolCall("Shell", "tc-shell");
      const sa = makeSubAgent("tc-task");
      const exec = makeExecution({
        id: "exec-mixed-task",
        messages: [
          makeMessage(MessageType.MESSAGE_AI, "Delegating...", {
            toolCalls: [taskTc, todoTc, shellTc],
          }),
        ],
        subAgents: [sa],
      });

      const items = buildThreadItems([exec], null, null, false, undefined);
      const toolGroups = items.filter((i) => i.kind === "tool-group");
      const subAgentItems = items.filter((i) => i.kind === "sub-agent");

      expect(subAgentItems).toHaveLength(1);
      expect(toolGroups).toHaveLength(1);
      expect(toolGroups[0].kind === "tool-group" && toolGroups[0].toolCalls).toHaveLength(1);
      expect(toolGroups[0].kind === "tool-group" && toolGroups[0].toolCalls[0].name).toBe("Shell");
    });
  });
});

// ---------------------------------------------------------------------------
// Inline todos card
// ---------------------------------------------------------------------------

describe("buildThreadItems todos card", () => {
  it("emits no todos card when status.todos is empty", () => {
    const exec = makeExecution({
      id: "exec-no-todos",
      messages: [makeMessage(MessageType.MESSAGE_AI, "Done")],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    expect(items.filter((i) => i.kind === "todos")).toHaveLength(0);
  });

  it("anchors the card immediately after the opening AI message (anchor 1)", () => {
    const exec = makeExecution({
      id: "exec-a1",
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "Here is my plan"),
        makeMessage(MessageType.MESSAGE_AI, "Working on it"),
      ],
      todos: todoMap([makeTodo("t1", "Step 1", TodoStatus.TODO_IN_PROGRESS)]),
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const keys = extractKeys(items);
    // ...-m0 (opening AI) -> todos -> ...-m1
    expect(keys).toEqual(["exec-a1-m0", "exec-a1-todos", "exec-a1-m1"]);
  });

  it("anchors the card after the opening thinking message", () => {
    const exec = makeExecution({
      id: "exec-think",
      messages: [
        makeMessage(MessageType.MESSAGE_THINKING, "Let me think"),
        makeMessage(MessageType.MESSAGE_AI, "Answer"),
      ],
      todos: todoMap([makeTodo("t1", "Step 1", TodoStatus.TODO_PENDING)]),
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const keys = extractKeys(items);
    expect(keys).toEqual(["exec-think-m0", "exec-think-todos", "exec-think-m1"]);
  });

  it("anchors before the first tool-group when work precedes any narration (anchor 2)", () => {
    // An empty-content AI message that only carries a Shell tool call: no
    // rendered narration, so the plan must lead the work.
    const shellTc = makeToolCall("Shell", "tc-shell");
    const exec = makeExecution({
      id: "exec-a2",
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "  ", { toolCalls: [shellTc] }),
      ],
      todos: todoMap([makeTodo("t1", "Step 1", TodoStatus.TODO_IN_PROGRESS)]),
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const keys = extractKeys(items);
    expect(keys).toEqual(["exec-a2-todos", "exec-a2-m0-tc"]);
  });

  it("falls back to the turn tail when there is no narration or work (anchor 3)", () => {
    // Only a suppressed/internal todo tool call, empty content: nothing renders
    // except the plan itself, which must still surface.
    const todoTc = makeToolCall("updateTodos", "tc-todo");
    const exec = makeExecution({
      id: "exec-a3",
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "  ", { toolCalls: [todoTc] }),
      ],
      todos: todoMap([makeTodo("t1", "Step 1", TodoStatus.TODO_COMPLETED)]),
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const todoItems = items.filter((i) => i.kind === "todos");
    expect(todoItems).toHaveLength(1);
    expect(todoItems[0].key).toBe("exec-a3-todos");
  });

  it("emits exactly one card per execution even with multiple AI messages", () => {
    const exec = makeExecution({
      id: "exec-one",
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "First"),
        makeMessage(MessageType.MESSAGE_AI, "Second"),
        makeMessage(MessageType.MESSAGE_AI, "Third"),
      ],
      todos: todoMap([makeTodo("t1", "Step 1", TodoStatus.TODO_PENDING)]),
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    expect(items.filter((i) => i.kind === "todos")).toHaveLength(1);
  });

  it("emits one card per turn across a multi-turn session", () => {
    const turn1 = makeExecution({
      id: "exec-1",
      messages: [makeMessage(MessageType.MESSAGE_AI, "Plan A")],
      todos: todoMap([makeTodo("t1", "A", TodoStatus.TODO_COMPLETED)]),
    });
    // A follow-up turn that did not write todos shows no card.
    const turn2 = makeExecution({
      id: "exec-2",
      messages: [makeMessage(MessageType.MESSAGE_AI, "No plan here")],
    });
    const turn3 = makeExecution({
      id: "exec-3",
      messages: [makeMessage(MessageType.MESSAGE_AI, "Plan C")],
      todos: todoMap([makeTodo("t1", "C", TodoStatus.TODO_IN_PROGRESS)]),
    });

    const items = buildThreadItems([turn1, turn2, turn3], null, null, false, undefined);
    const todoKeys = items.filter((i) => i.kind === "todos").map((i) => i.key);
    expect(todoKeys).toEqual(["exec-1-todos", "exec-3-todos"]);
  });

  it("carries the live status.todos reference (no clone) for memoization", () => {
    const todos = todoMap([makeTodo("t1", "Step 1", TodoStatus.TODO_PENDING)]);
    const exec = makeExecution({
      id: "exec-ref",
      messages: [makeMessage(MessageType.MESSAGE_AI, "Plan")],
      todos,
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const todoItem = items.find((i) => i.kind === "todos");
    expect(todoItem?.kind === "todos" && todoItem.todos).toBe(exec.status!.todos);
  });

  it("native-harness shape: filters the write_todos tool call but still shows the card", () => {
    // Native keeps write_todos as a (filtered) tool call AND populates status.todos.
    const writeTodosTc = makeToolCall("write_todos", "tc-wt");
    const exec = makeExecution({
      id: "exec-native",
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "Planning", {
          toolCalls: [writeTodosTc],
        }),
      ],
      todos: todoMap([makeTodo("t1", "Step 1", TodoStatus.TODO_IN_PROGRESS)]),
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    expect(items.filter((i) => i.kind === "tool-group")).toHaveLength(0);
    expect(items.filter((i) => i.kind === "todos")).toHaveLength(1);
  });

  it("keeps a stable key as todos update (no remount)", () => {
    const before = makeExecution({
      id: "exec-stable",
      messages: [makeMessage(MessageType.MESSAGE_AI, "Plan")],
      todos: todoMap([makeTodo("t1", "Step 1", TodoStatus.TODO_PENDING)]),
    });
    const after = makeExecution({
      id: "exec-stable",
      messages: [makeMessage(MessageType.MESSAGE_AI, "Plan")],
      todos: todoMap([
        makeTodo("t1", "Step 1", TodoStatus.TODO_COMPLETED),
        makeTodo("t2", "Step 2", TodoStatus.TODO_IN_PROGRESS),
      ]),
    });

    const k1 = buildThreadItems([before], null, null, false, undefined).find(
      (i) => i.kind === "todos",
    )?.key;
    const k2 = buildThreadItems([after], null, null, false, undefined).find(
      (i) => i.kind === "todos",
    )?.key;
    expect(k1).toBe("exec-stable-todos");
    expect(k2).toBe("exec-stable-todos");
  });
});
