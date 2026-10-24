// Pins the terminal conversation components on folded session events: a
// message's speaker and text, the phase badge, a tool row's glyph per state
// and its label or intent, a subagent block and a to-do list, the approval
// prompt's three answers (approve, approve all of the class, deny with an
// optional reason) and why-gated line, and the thread's keyboard arbitration
// between waiting tool uses, its ordering of a turn's items, and how a turn
// ended.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { ThreadMessage } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { MessageEntry } from "../components/MessageEntry.js";
import { RunProgress } from "../components/RunProgress.js";
import { ToolCallItem } from "../components/ToolCallItem.js";
import { ToolCallGroup } from "../components/ToolCallGroup.js";
import { ApprovalPrompt } from "../components/ApprovalPrompt.js";
import { DROPPED_MESSAGE_LABEL, MessageThread, QUEUED_MESSAGE_LABEL } from "../components/MessageThread.js";
import { SubagentBlock } from "../components/SubagentBlock.js";
import { TodoList } from "../components/TodoList.js";
import { RUN_ID, askEvents, event, threadEvents, toolUseOf, turnOf, waitingToolUse } from "./session-events.js";

/** Lets Ink flush a re-render after stdin input. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe("MessageEntry", () => {
  it("renders a person's message with 'You' prefix", () => {
    const message: ThreadMessage = { kind: "user", id: "u", text: "Hello agent" };
    const output = render(<MessageEntry message={message} />).lastFrame() ?? "";
    expect(output).toContain("You");
    expect(output).toContain("Hello agent");
  });

  it("renders an agent message with 'Agent' prefix", () => {
    const message: ThreadMessage = { kind: "message", id: "m", text: "Here is the answer", live: false, processedAt: "" };
    const output = render(<MessageEntry message={message} />).lastFrame() ?? "";
    expect(output).toContain("Agent");
    expect(output).toContain("answer");
  });

  it("renders a platform note in dim style", () => {
    const message: ThreadMessage = { kind: "note", id: "n", text: "System notice", processedAt: "" };
    expect(render(<MessageEntry message={message} />).lastFrame()).toContain("System notice");
  });

  it("renders nothing for a thinking", () => {
    const message: ThreadMessage = { kind: "thinking", id: "t", text: "weighing", live: false, processedAt: "" };
    expect(render(<MessageEntry message={message} />).lastFrame()).toBe("");
  });

  it("shows 'Thinking...' for a live agent message with no text yet", () => {
    const message: ThreadMessage = { kind: "message", id: "m", text: "", live: true, processedAt: "" };
    expect(render(<MessageEntry message={message} />).lastFrame()).toContain("Thinking...");
  });
});

describe("RunProgress", () => {
  it("shows 'Running' for in-progress phase", () => {
    expect(render(<RunProgress phase={RunPhase.RUN_IN_PROGRESS} />).lastFrame()).toContain("Running");
  });

  it("shows 'Completed' with check for completed phase", () => {
    const output = render(<RunProgress phase={RunPhase.RUN_COMPLETED} />).lastFrame() ?? "";
    expect(output).toContain("Completed");
    expect(output).toContain("✓");
  });

  it("shows 'Failed' for failed phase", () => {
    expect(render(<RunProgress phase={RunPhase.RUN_FAILED} />).lastFrame()).toContain("Failed");
  });

  it("shows 'Waiting for approval' for approval phase", () => {
    expect(render(<RunProgress phase={RunPhase.RUN_WAITING_FOR_APPROVAL} />).lastFrame()).toContain(
      "Waiting for approval",
    );
  });

  it("renders nothing for unspecified phase", () => {
    expect(render(<RunProgress phase={RunPhase.RUN_PHASE_UNSPECIFIED} />).lastFrame()).toBe("");
  });
});

describe("ToolCallItem", () => {
  it("renders tool name with status indicator", () => {
    const output = render(<ToolCallItem toolUse={samples.toolUse("read_file", "contents")} />).lastFrame() ?? "";
    expect(output).toContain("Read");
    expect(output).toContain("✓");
  });

  it("shows running indicator for running tools", () => {
    const output = render(<ToolCallItem toolUse={samples.toolUse("write_file")} />).lastFrame() ?? "";
    expect(output).toContain("Write");
    expect(output).toContain("running");
  });

  it("shows error for failed tools when expanded", () => {
    const tool = samples.toolUse("execute_command", "Permission denied", { isError: true });
    const output = render(<ToolCallItem toolUse={tool} expanded />).lastFrame() ?? "";
    expect(output).toContain("✗");
    expect(output).toContain("Permission denied");
  });

  it("renders a call its turn stopped with the neutral cut-short glyph (issue #207)", () => {
    const tool = toolUseOf([
      samples.toolUseEvent("execute_command"),
      samples.runStatusEvent("cancelled"),
    ]);
    expect(tool.state).toBe("stopped");
    const output = render(<ToolCallItem toolUse={tool} />).lastFrame() ?? "";
    expect(output).toContain("⊘");
    // Settled: no live "running" hint, no success checkmark.
    expect(output).not.toContain("running");
    expect(output).not.toContain("✓");
  });

  it("marks a waiting call with the open glyph and a denied one with the refused glyph", () => {
    expect(render(<ToolCallItem toolUse={waitingToolUse("write_file")} />).lastFrame()).toContain("○");
    const denied = toolUseOf([
      ...askEvents("write_file"),
      event({
        case: "userToolConfirmation",
        value: { id: "conf", toolUseId: `${RUN_ID}.tc-write_file`, result: "deny" },
      }),
    ]);
    expect(denied.state).toBe("denied");
    expect(render(<ToolCallItem toolUse={denied} />).lastFrame()).toContain("⊘");
  });

  it("titles a shell row with the model-authored intent, command as dim secondary (stigmer#276)", () => {
    const tool = samples.toolUse("execute", "ok", {
      input: { command: "npx vitest run src/parser", description: "Run unit tests for the parser" },
    });
    const output = render(<ToolCallItem toolUse={tool} />).lastFrame() ?? "";
    expect(output).toContain("Run unit tests for the parser");
    expect(output).toContain("npx vitest run src/parser");
    expect(output).not.toContain("Shell");
  });

  it("falls back to the category label when no intent is present", () => {
    const tool = samples.toolUse("execute", "ok", { input: { command: "ls" } });
    expect(render(<ToolCallItem toolUse={tool} />).lastFrame()).toContain("Shell");
  });

  it("never titles a non-shell row from its description arg", () => {
    const tool = samples.toolUse("task", "done", {
      input: { description: "general-purpose research", prompt: "Find the docs" },
    });
    // A task tool's description is the subagent subject, never a row title.
    expect(render(<ToolCallItem toolUse={tool} />).lastFrame()).toContain("Subagent");
  });

  it("says a background command's state on a line beneath its row, from its own status", () => {
    const id = `${RUN_ID}.bg1`;
    const start = [
      samples.toolUseEvent("execute", { command: "npm test", background: true }, { id }),
      event({ case: "agentToolResult", value: { id: `${id}.r`, toolUseId: id, content: [{ type: "text", text: "Started in the background (id bg1)." }] } }),
      event({ case: "stigmerBackgroundCommandStatus", value: { id: `${id}.bg`, toolUseId: id, phase: "running", timeoutSeconds: 300 } }),
    ];
    expect(render(<ToolCallItem toolUse={toolUseOf(start)} />).lastFrame()).toContain("Background command `npm test` is running");
    const ended = [
      ...start,
      event({ case: "stigmerBackgroundCommandStatus", value: { id: `${id}.bg.end`, toolUseId: id, phase: "ended", ending: "exited", exitCode: 1, output: "1 failed\n" } }),
    ];
    expect(render(<ToolCallItem toolUse={toolUseOf(ended)} />).lastFrame()).toContain("Background command `npm test` exited with code 1");
  });

  it("labels the agent's stop of a background command", () => {
    const tool = samples.toolUse("stop_background_command", "stopped", { input: { id: "bg1" } });
    expect(render(<ToolCallItem toolUse={tool} />).lastFrame()).toContain("Stop command");
  });

  it("shows MCP server prefix", () => {
    const tool = samples.toolUse("list_resources", "[]", { mcpServerName: "github" });
    expect(render(<ToolCallItem toolUse={tool} />).lastFrame()).toContain("github/list_resources");
  });
});

describe("ToolCallGroup", () => {
  it("summarizes a lone call by name and expands to its row", () => {
    const output = render(
      <ToolCallGroup toolUses={[samples.toolUse("read_file", "x")]} defaultExpanded />,
    ).lastFrame() ?? "";
    expect(output).toContain("read_file");
    expect(output).toContain("Read");
  });

  it("reads running, then failed, then waiting as pending, then completed", () => {
    const running = samples.toolUse("write_file");
    const failed = samples.toolUse("execute", "boom", { id: "f", isError: true });
    const done = samples.toolUse("read_file", "x", { id: "d" });
    expect(render(<ToolCallGroup toolUses={[done, running]} />).lastFrame()).toContain("⠋");
    expect(render(<ToolCallGroup toolUses={[done, failed]} />).lastFrame()).toContain("✗");
    expect(render(<ToolCallGroup toolUses={[done, waitingToolUse("write_file")]} />).lastFrame()).toContain("○");
    const settled = render(<ToolCallGroup toolUses={[done, done]} />).lastFrame() ?? "";
    expect(settled).toContain("✓");
    expect(settled).toContain("2 tool calls");
  });

  it("toggles expansion with Enter while focused", async () => {
    const { stdin, lastFrame } = render(
      <ToolCallGroup toolUses={[samples.toolUse("read_file", "x")]} isFocused />,
    );
    expect(lastFrame()).toContain("▶");
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("▼");
  });
});

describe("SubagentBlock", () => {
  const taskId = `${RUN_ID}.tc-task`;
  function threadOf(state: "running" | "completed" | "failed", reply = "") {
    const turn = turnOf([
      samples.userMessageEvent("research"),
      samples.toolUseEvent("task", { description: "find docs" }),
      ...threadEvents(taskId, {
        input: "Find the docs for the parser",
        reply,
        state,
        items: [
          samples.agentMessageEvent("Looking now.", { threadId: taskId, id: `${taskId}.m0` }),
          samples.toolUseEvent("read_file", { path: "README.md" }, { threadId: taskId, id: `${taskId}.read` }),
          samples.toolUseEvent("write_todos", {}, { threadId: taskId, id: `${taskId}.todo` }),
          event({ case: "stigmerHarnessNote", value: { id: `${taskId}.note`, text: "tools are off" } }, taskId),
        ],
      }),
    ]);
    const task = turn.items.find((item) => item.kind === "tool_use")!;
    return task.kind === "tool_use" ? task.thread! : undefined;
  }

  it("shows the subject, and expanded its task, items and result", () => {
    const thread = threadOf("completed", "Found three pages.")!;
    const output = render(
      <SubagentBlock
        thread={thread}
        subject="find docs"
        startedAt={samples.toolUse("x").processedAt}
        completedAt="2026-07-20T11:01:05.000Z"
        defaultExpanded
      />,
    ).lastFrame() ?? "";
    expect(output).toContain("✓");
    expect(output).toContain("find docs");
    expect(output).toContain("(1m 5s)");
    expect(output).toContain("Task: Find the docs for the parser");
    expect(output).toContain("Looking now.");
    expect(output).toContain("read_file");
    expect(output).toContain("tools are off");
    expect(output).toContain("Result:");
    expect(output).toContain("Found three pages.");
  });

  it("shows a failed subagent's reply as its error, and the agent's name without a subject", () => {
    const output = render(<SubagentBlock thread={threadOf("failed", "out of retries")!} defaultExpanded />).lastFrame() ?? "";
    expect(output).toContain("researcher");
    expect(output).toContain("Error: out of retries");
  });

  it("toggles with Enter while focused and times a short or running run", async () => {
    const thread = threadOf("running")!;
    const { stdin, lastFrame } = render(
      <SubagentBlock thread={thread} startedAt="2026-07-20T11:00:00.000Z" completedAt="2026-07-20T11:00:00.500Z" isFocused />,
    );
    expect(lastFrame()).toContain("⟳");
    expect(lastFrame()).toContain("(500ms)");
    stdin.write(" ");
    await tick();
    expect(lastFrame()).toContain("Looking now.");
    const live = render(<SubagentBlock thread={thread} startedAt="2026-07-20T11:00:00.000Z" />).lastFrame() ?? "";
    expect(live).toMatch(/\(\d+m \d+s\)/);
    const brief = render(
      <SubagentBlock thread={thread} startedAt="2026-07-20T11:00:00.000Z" completedAt="2026-07-20T11:00:12.000Z" />,
    ).lastFrame() ?? "";
    expect(brief).toContain("(12s)");
  });
});

describe("TodoList", () => {
  it("sorts by activity and counts the completed", () => {
    const todos = [
      { id: "a", content: "write docs", status: "completed" as const, createdAt: "", updatedAt: "" },
      { id: "b", content: "fix bug", status: "in_progress" as const, createdAt: "", updatedAt: "" },
      { id: "c", content: "old idea", status: "cancelled" as const, createdAt: "", updatedAt: "" },
      { id: "d", content: "ship", status: "pending" as const, createdAt: "", updatedAt: "" },
    ];
    const output = render(<TodoList todos={todos} />).lastFrame() ?? "";
    expect(output).toContain("Tasks");
    expect(output).toContain("(1/4)");
    expect(output.indexOf("fix bug")).toBeLessThan(output.indexOf("ship"));
    expect(output.indexOf("ship")).toBeLessThan(output.indexOf("write docs"));
    expect(output.indexOf("write docs")).toBeLessThan(output.indexOf("old idea"));
  });

  it("renders nothing for an empty list", () => {
    expect(render(<TodoList todos={[]} />).lastFrame()).toBe("");
  });
});

describe("ApprovalPrompt", () => {
  it("offers Approve, scope-truthful approve-all, and Deny", () => {
    const output = render(
      <ApprovalPrompt toolUse={waitingToolUse("write_file")} onAnswer={() => {}} />,
    ).lastFrame() ?? "";
    expect(output).toContain("[y] Approve");
    // write_file is granted as the "file edits" class — the label names it.
    expect(output).toContain("[a] Approve all file edits");
    expect(output).toContain("[n] Deny");
  });

  it.each([
    { name: "execute", mcp: undefined, label: "Approve all shell commands" },
    { name: "delete_file", mcp: undefined, label: "Approve all file deletions" },
    { name: "create_issue", mcp: "github", label: "Approve all github tools" },
    { name: "web_fetch", mcp: undefined, label: "Approve all of this kind" },
  ])("labels the grant on $name by its class", ({ name, mcp, label }) => {
    const tool = waitingToolUse(name, mcp === undefined ? {} : { mcpServerName: mcp });
    const words = (render(<ApprovalPrompt toolUse={tool} onAnswer={() => {}} />).lastFrame() ?? "")
      .replace(/[│╭╮╰╯─▸]/g, " ")
      .replace(/\s+/g, " ");
    expect(words).toContain(label);
  });

  it("names the asking hook on a hook's card: its grant and its reason", () => {
    const tool = waitingToolUse("execute", { policySource: "hook", policyHook: "safety" });
    const output = render(<ApprovalPrompt toolUse={tool} onAnswer={() => {}} />).lastFrame() ?? "";
    expect(output).toContain("[a] Approve all shell commands the safety plugin asks");
    expect(output).toContain("decided by the safety plugin's hook");
  });

  it.each([
    { name: "write_file", mcp: undefined, subject: "file writes" },
    { name: "edit_file", mcp: undefined, subject: "file edits" },
    { name: "delete_file", mcp: undefined, subject: "file deletions" },
    { name: "create_issue", mcp: "github", subject: "create_issue calls" },
    { name: "web_fetch", mcp: undefined, subject: "web_fetch calls" },
  ])("names a hook grant on $name by that one tool's calls", ({ name, mcp, subject }) => {
    const tool = waitingToolUse(name, {
      policySource: "hook",
      ...(mcp === undefined ? {} : { mcpServerName: mcp }),
    });
    const words = (render(<ApprovalPrompt toolUse={tool} onAnswer={() => {}} />).lastFrame() ?? "")
      .replace(/[│╭╮╰╯─▸]/g, " ")
      .replace(/\s+/g, " ");
    expect(words).toContain(`Approve all ${subject}`);
  });

  it("renders the shell intent as supplementary context, args foregrounded (stigmer#276)", () => {
    const tool = waitingToolUse("execute", {
      argsPreview: JSON.stringify({ command: "make deploy", description: "Deploy the staging build" }),
    });
    const output = render(<ApprovalPrompt toolUse={tool} onAnswer={() => {}} />).lastFrame() ?? "";
    expect(output).toContain("Intent:");
    expect(output).toContain("Deploy the staging build");
    expect(output).toContain("make deploy");
  });

  it("renders no intent line when the shell call carries none", () => {
    const tool = waitingToolUse("execute", { argsPreview: JSON.stringify({ command: "ls" }) });
    expect(render(<ApprovalPrompt toolUse={tool} onAnswer={() => {}} />).lastFrame()).not.toContain("Intent:");
  });

  it("renders the why-gated line from the ask's policy source, and the MCP tool's label", () => {
    const tool = waitingToolUse("delete_issue", {
      mcpServerName: "github",
      policySource: "annotation_destructive_tighten",
    });
    const output = render(<ApprovalPrompt toolUse={tool} onAnswer={() => {}} />).lastFrame() ?? "";
    expect(output).toContain("github/delete_issue");
    expect(output).toContain("Why:");
    expect(output).toContain("required: marked destructive by the server");
  });

  it("answers grant on 'a' and allow on 'y'", () => {
    const onAnswer = vi.fn();
    const { stdin } = render(<ApprovalPrompt toolUse={waitingToolUse("write_file")} onAnswer={onAnswer} />);
    stdin.write("a");
    expect(onAnswer).toHaveBeenLastCalledWith("grant");
    stdin.write("y");
    expect(onAnswer).toHaveBeenLastCalledWith("allow");
  });

  it("moves the selection with the arrows and confirms it with Enter", async () => {
    const onAnswer = vi.fn();
    const { stdin } = render(<ApprovalPrompt toolUse={waitingToolUse("write_file")} onAnswer={onAnswer} />);
    stdin.write("\u001B[C"); // right → approve all
    await tick();
    stdin.write("\r");
    expect(onAnswer).toHaveBeenLastCalledWith("grant");
    stdin.write("\u001B[D"); // left → approve
    await tick();
    stdin.write("\u001B[D"); // left wraps → deny
    await tick();
    stdin.write("\u001B[B"); // down wraps → approve
    await tick();
    stdin.write("\r");
    expect(onAnswer).toHaveBeenLastCalledWith("allow");
  });

  it("denies with the typed reason, or none, and Esc backs out", async () => {
    const onAnswer = vi.fn();
    const { stdin, lastFrame } = render(
      <ApprovalPrompt toolUse={waitingToolUse("write_file")} onAnswer={onAnswer} />,
    );
    stdin.write("n");
    await tick();
    expect(lastFrame()).toContain("Deny — reason (optional):");
    stdin.write("\u001B"); // Esc → back to the options
    await tick();
    expect(lastFrame()).toContain("[y] Approve");
    expect(onAnswer).not.toHaveBeenCalled();

    stdin.write("n");
    await tick();
    stdin.write("use staging");
    await tick();
    stdin.write("\r");
    expect(onAnswer).toHaveBeenLastCalledWith("deny", "use staging");

    const silent = vi.fn();
    const second = render(<ApprovalPrompt toolUse={waitingToolUse("write_file")} onAnswer={silent} />);
    second.stdin.write("n");
    await tick();
    second.stdin.write("\r");
    expect(silent).toHaveBeenLastCalledWith("deny", undefined);
  });

  it("shows submitting and ignores keyboard input when inactive", () => {
    const onAnswer = vi.fn();
    const { stdin, lastFrame } = render(
      <ApprovalPrompt toolUse={waitingToolUse("write_file")} onAnswer={onAnswer} isActive={false} isSubmitting />,
    );
    expect(lastFrame()).toContain("Submitting...");
    stdin.write("y");
    stdin.write("a");
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe("MessageThread — multi-approval keyboard arbitration", () => {
  function turnWithAsks(...names: string[]) {
    return turnOf([
      samples.userMessageEvent("go"),
      samples.runStatusEvent("waiting"),
      ...names.flatMap((name) => askEvents(name)),
    ]);
  }

  it("routes a single keystroke to only the FIRST of multiple waiting tool uses", () => {
    // The regression lock for the keyboard-sharing bug: two live prompts each
    // had an unconditional useInput, so one keystroke settled both.
    const onAnswerToolUse = vi.fn();
    const { stdin } = render(
      <MessageThread turns={[turnWithAsks("write_file", "execute")]} onAnswerToolUse={onAnswerToolUse} />,
    );
    stdin.write("y");
    expect(onAnswerToolUse).toHaveBeenCalledTimes(1);
    expect(onAnswerToolUse).toHaveBeenCalledWith(`${RUN_ID}.tc-write_file`, "allow", undefined);
  });

  it("shows the in-flight state of an answer and renders no prompt without a handler", () => {
    const turn = turnWithAsks("write_file");
    const busy = render(
      <MessageThread
        turns={[turn]}
        onAnswerToolUse={() => {}}
        answeringToolUseIds={new Set([`${RUN_ID}.tc-write_file`])}
      />,
    ).lastFrame() ?? "";
    expect(busy).toContain("Submitting...");
    expect(render(<MessageThread turns={[turn]} />).lastFrame()).not.toContain("Approval required");
  });
});

describe("MessageThread — a turn's items", () => {
  it("renders the message, tools and reply in order, leaving to-dos and subagents to their surfaces", () => {
    const taskId = `${RUN_ID}.tc-task`;
    const turn = turnOf([
      ...samples.turnEvents({
        message: "Summarize the repo",
        tools: [{ name: "read_file", input: { path: "README.md" }, result: "x" }],
        reply: "",
        phase: "running",
      }),
      samples.toolUseEvent("write_todos", {}),
      samples.agentMessageEvent("", { id: `${RUN_ID}.root.m9` }),
      samples.toolUseEvent("task", { description: "dig deeper" }),
      ...threadEvents(taskId, { reply: "done" }),
      event({ case: "stigmerHarnessNote", value: { id: `${RUN_ID}.note`, text: "platform note" } }),
      samples.agentMessageEvent("It is a parser."),
    ]);
    const output = render(<MessageThread turns={[turn]} />).lastFrame() ?? "";
    expect(output.indexOf("Summarize the repo")).toBeLessThan(output.indexOf("read_file"));
    expect(output.indexOf("read_file")).toBeLessThan(output.indexOf("dig deeper"));
    expect(output.indexOf("dig deeper")).toBeLessThan(output.indexOf("platform note"));
    expect(output.indexOf("platform note")).toBeLessThan(output.indexOf("It is a parser."));
    expect(output).not.toContain("write_todos");
  });

  it("titles a turn with its run's message, and leaves out a reconcile turn", () => {
    const turns = samples.fold([
      ...samples.turnEvents({ message: "the event's text", reply: "ok" }),
      samples.runStatusEvent("completed", { runId: "run_reconcile" }),
    ]).turns;
    const runs = [
      samples.run({ message: "the run's text" }),
      samples.run({ id: "run_reconcile", message: "" }),
    ];
    runs[1]!.spec!.reconcileFileReview = true;
    const output = render(<MessageThread turns={turns} runs={runs} />).lastFrame() ?? "";
    expect(output).toContain("the run's text");
    expect(output).not.toContain("the event's text");
    expect(turns).toHaveLength(2);
  });

  it("shows the optimistic message until the turn carries it", () => {
    const turn = samples.turn({ message: "hello", phase: "running" });
    expect(render(<MessageThread turns={[]} pendingUserMessage="hello" />).lastFrame()).toContain("hello");
    const carried = render(<MessageThread turns={[turn]} pendingUserMessage="hello" />).lastFrame() ?? "";
    expect(carried.match(/hello/g)).toHaveLength(1);
  });
});

describe("MessageThread — how a turn ended", () => {
  function turnIn(phase: "failed" | "cancelled" | "completed") {
    return samples.turn({ reply: "partial answer", phase });
  }

  it("ends a failed turn with the Failed badge", () => {
    const output = render(<MessageThread turns={[turnIn("failed")]} />).lastFrame() ?? "";
    expect(output).toContain("partial answer");
    expect(output).toContain("● Failed");
  });

  it("ends a cancelled turn with the Cancelled badge", () => {
    expect(render(<MessageThread turns={[turnIn("cancelled")]} />).lastFrame()).toContain("● Cancelled");
  });

  it("shows no badge after a completed turn", () => {
    const output = render(<MessageThread turns={[turnIn("completed")]} />).lastFrame() ?? "";
    expect(output).toContain("partial answer");
    expect(output).not.toContain("Completed");
  });
});

describe("MessageThread — messages sent while a turn works", () => {
  it("shows a message the turn read mid-turn where it read it, and each unread one after the thread", () => {
    const turn = turnOf([
      samples.userMessageEvent("Build it.", { runId: RUN_ID }),
      samples.agentMessageEvent("Building.", { runId: RUN_ID, id: `${RUN_ID}.root.m0` }),
      event({ case: "userMessage", value: { id: "sevt_q", content: [{ type: "text", text: "Also the README." }], processedAt: "t" } }),
      samples.agentMessageEvent("README too.", { runId: RUN_ID, id: `${RUN_ID}.root.m1` }),
    ]);
    const frame =
      render(
        <MessageThread
          turns={[turn]}
          queued={[
            { id: "q1", text: "Not now.", state: "dropped" },
            { id: "q2", text: "Then lint.", state: "waiting" },
          ]}
          pendingUserMessage="Then lint."
        />,
      ).lastFrame() ?? "";
    const order = ["Build it.", "Building.", "Also the README.", "README too.", "Not now.", DROPPED_MESSAGE_LABEL, "Then lint.", QUEUED_MESSAGE_LABEL];
    const positions = order.map((text) => frame.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(frame.split("Then lint.").length - 1, "no second bubble for the pending message").toBe(1);
  });
});
