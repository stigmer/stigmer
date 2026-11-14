/**
 * MessageThread rendering from a session's folded turns and their runs:
 * no file-change record or decision surface for a turn's change set, live
 * or settled (a finished turn's files show in its "Changed" group); the
 * decision on a waiting tool use, inline on its row
 * or on the bottom backstop card, routed through `onAnswerToolUse` with the
 * tool use's id (allow, deny with a reason), its failure shown in-card, and
 * absent without the handler; the conversation's messages, version and
 * loaded-version markers, the plan card a to-do turn draws, subagents and
 * compactions (a finished turn's under its "How it got there" line); how a
 * turn ended (badge, reason and Retry, a quiet cancel); the pending bubble
 * and its Retry; editing the live turn's message; the set-up placeholder
 * yielding to the first output; Plan turns (live collapse, the build card,
 * the plan document, the mode badge); and the ambient liveness line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { LoadedVersionsSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer, Turn } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { DROPPED_MESSAGE_LABEL, MessageThread, QUEUED_MESSAGE_LABEL, type MessageThreadProps } from "../MessageThread";
import {
  asked,
  changes,
  ev,
  compaction,
  conversation,
  decided,
  result,
  said,
  status,
  turnsOf,
  user,
  subagent,
  thought,
  toolId,
  use,
  type TurnFixture,
} from "./__fixtures__/thread-events";

// ---------------------------------------------------------------------------
// DOM stubs — useAutoScroll depends on browser APIs not available in happy-dom
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(() => []),
      root: null,
      rootMargin: "",
      thresholds: [0],
    })),
  );
  vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A client no test reaches. */
const CLIENT = {} as Stigmer;

function renderThread(conv: { turns: readonly Turn[]; runs: Run[] }, props: Partial<MessageThreadProps> = {}) {
  return render(
    <StigmerContext.Provider value={CLIENT}>
      <MessageThread turns={conv.turns} runs={conv.runs} {...props} />
    </StigmerContext.Provider>,
  );
}

const FILES = [{ id: "fc-a", path: "src/a.ts" }];

// ---------------------------------------------------------------------------
// File changes stay off the thread
// ---------------------------------------------------------------------------

describe("MessageThread file changes", () => {
  it("draws no file-change record or decision surface for a change set, live or settled", () => {
    renderThread(conversation({ id: "live", phase: "running", reply: "Working.", extra: [changes("live", "cs1", FILES)] }));
    expect(screen.queryByText("File changes")).toBeNull();
    expect(screen.queryByText("Review file changes")).toBeNull();
    cleanup();

    renderThread(conversation({ id: "done", reply: "Done.", extra: [changes("done", "cs1", FILES), decided("done", "cs1", "keep")] }));
    expect(screen.queryByText("File changes")).toBeNull();
    expect(document.querySelector('[data-cursor-target="file-review-list-row"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Answers to waiting tool uses
// ---------------------------------------------------------------------------

describe("MessageThread answers", () => {
  /** A live turn waiting on `call` (`name`). */
  function waiting(id: string, call: string, name: string): { turns: readonly Turn[]; runs: Run[] } {
    return conversation({
      id,
      phase: "running",
      message: "Do something",
      reply: "I need to run a tool.",
      extra: [use(id, call, name, { path: "/tmp/x" }, { ask: true }), asked(id, call), status(id, "waiting")],
    });
  }

  it("draws a waiting call's row as its approval, one object, and routes Allow with its id", () => {
    const onAnswer = vi.fn();
    renderThread(waiting("w", "c1", "delete_file"), { onAnswerToolUse: onAnswer });

    // The row is the card: one approval, on the row, no second card below.
    const asks = screen.getAllByRole("alert");
    expect(asks).toHaveLength(1);
    expect(asks[0].closest('[data-cursor-target="tool-call-row"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onAnswer).toHaveBeenCalledWith(toolId("w", "c1"), "allow", undefined);
  });

  it("shows an inline gate's failure in-card", () => {
    const { container } = renderThread(waiting("w", "c1", "delete_file"), {
      onAnswerToolUse: () => {},
      answerErrors: new Map([[toolId("w", "c1"), new Error("gate already resolved")]]),
    });

    expect(container.querySelector('[data-cursor-target="approval-error"]')?.textContent).toContain("gate already resolved");
  });

  it("renders a waiting call with no row as the bottom card, routing a Deny with its reason", () => {
    const onAnswer = vi.fn();
    renderThread(waiting("w", "c1", "write_todos"), { onAnswerToolUse: onAnswer });

    expect(screen.getByRole("alert").getAttribute("aria-label")).toContain("write_todos");
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    fireEvent.change(screen.getByLabelText("Reason for denying (optional)"), { target: { value: "not now" } });
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onAnswer).toHaveBeenCalledWith(toolId("w", "c1"), "deny", "not now");
  });

  it("shows the bottom card's failure and in-flight state", () => {
    const { container } = renderThread(waiting("w", "c1", "write_todos"), {
      onAnswerToolUse: () => {},
      answeringToolUseIds: new Set([toolId("w", "c1")]),
      answerErrors: new Map([[toolId("w", "c1"), new Error("network down")]]),
    });

    expect(container.querySelector('[data-cursor-target="approval-error"]')?.textContent).toContain("network down");
    expect(screen.getByRole("button", { name: "Allow" }).hasAttribute("disabled")).toBe(true);
  });

  it("renders no decision UI without onAnswerToolUse", () => {
    renderThread(waiting("w", "c1", "write_todos"));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

describe("MessageThread", () => {
  it("renders a role=log container with no turns", () => {
    render(<MessageThread turns={[]} />);

    expect(screen.getByRole("log").getAttribute("aria-live")).toBe("polite");
  });

  it("renders the person's and the agent's messages", () => {
    renderThread(conversation({ id: "a", message: "What is Stigmer?", reply: "Stigmer is a platform for platforms." }));

    expect(screen.getByText("What is Stigmer?")).toBeTruthy();
    expect(screen.getByText("Stigmer is a platform for platforms.")).toBeTruthy();
  });

  it("renders a divider naming the agent version where it starts and where it changes", () => {
    const conv = conversation({ id: "a", message: "one" }, { id: "b", message: "two" });
    conv.runs[0]!.status!.agentVersionHash = "h1";
    conv.runs[1]!.status!.agentVersionHash = "h2";

    renderThread(conv, { agentVersionLabel: (hash) => (hash === "h2" ? "v2" : hash) });

    expect(screen.getAllByTestId("agent-version-marker").map((m) => m.textContent)).toEqual(["Agent version h1", "Agent version v2"]);
  });

  it("renders no agent version divider without a label function", () => {
    const conv = conversation({ id: "a" });
    conv.runs[0]!.status!.agentVersionHash = "h1";

    renderThread(conv);

    expect(screen.queryByTestId("agent-version-marker")).toBeNull();
  });

  it("marks a skill or plugin a turn ran at another version than the turn before, and none on the first turn", () => {
    const loaded = (skills: [string, string, string][], plugins: [string, string, string][] = []) =>
      create(LoadedVersionsSchema, {
        skills: skills.map(([id, slug, version]) => ({ org: "org_a", kind: ApiResourceKind.skill, id, slug, version })),
        plugins: plugins.map(([id, slug, version]) => ({ org: "org_a", kind: ApiResourceKind.plugin, id, slug, version })),
      });
    const conv = conversation({ id: "a", message: "one" }, { id: "b", message: "two" }, { id: "c", message: "three" }, { id: "d", message: "four" });
    conv.runs[0]!.status!.loadedVersions = loaded([["skl_1", "refunds", "v1"]], [["plg_1", "github-tools", "d1"]]);
    conv.runs[1]!.status!.loadedVersions = loaded([["skl_1", "refunds", "v1"], ["skl_1", "refunds", "v2"]], [["plg_1", "github-tools", "d1"]]);
    conv.runs[3]!.status!.loadedVersions = loaded([["skl_1", "refunds", "v2"], ["skl_2", "triage", "v1"]], [["plg_1", "github-tools", "d2"]]);

    renderThread(conv);

    expect(screen.getAllByTestId("loaded-versions-marker").map((m) => m.textContent)).toEqual([
      "Skill refunds updated",
      "Plugin github-tools updated",
    ]);
  });

  it("names a moved skill that was deleted since as a deleted skill", () => {
    const at = (version: string) => create(LoadedVersionsSchema, { skills: [{ org: "org_a", kind: ApiResourceKind.skill, id: "skl_1", slug: "", version }] });
    const conv = conversation({ id: "a" }, { id: "b" });
    conv.runs[0]!.status!.loadedVersions = at("v1");
    conv.runs[1]!.status!.loadedVersions = at("v2");

    renderThread(conv);

    expect(screen.getAllByTestId("loaded-versions-marker").map((m) => m.textContent)).toEqual(["A deleted skill was updated"]);
  });

  it("renders the turn's to-dos as an inline card", () => {
    renderThread(
      conversation({
        id: "t",
        message: "Build the feature",
        phase: "running",
        reply: "Here is my plan",
        extra: [
          use("t", "todo", "write_todos", { todos: [{ content: "Scaffold the component", status: "in_progress" }, { content: "Wire the thread", status: "pending" }] }),
          result("t", "todo", "ok"),
        ],
      }),
    );

    const region = screen.getByRole("region", { name: "Plan" });
    expect(region.textContent).toContain("Scaffold the component");
    expect(region.textContent).toContain("0 of 2 done");
    expect(screen.queryByRole("region", { name: "Agent to-dos" })).toBeNull();
  });

  it("renders a subagent's card and a context compaction", () => {
    const threadId = toolId("s", "task1");
    renderThread(
      conversation({
        id: "s",
        reply: "Delegating.",
        extra: [
          use("s", "task1", "task", { description: "Research renewables" }),
          ...subagent("s", "task1", { agentName: "researcher", items: [said("s", 0, "Looking", threadId)], finished: "completed" }),
          result("s", "task1", "found"),
          compaction("s", "cmp1"),
        ],
      }),
    );

    // The finished turn leads with its answer; its working opens from one line.
    expect(screen.queryByRole("group", { name: /Subagent: Research renewables/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^How it got there/ }));
    expect(screen.getByRole("group", { name: /Subagent: Research renewables/ })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Earlier messages summarized" })).toBeTruthy();
  });

  it("renders the pending message dimmed", () => {
    render(<MessageThread turns={[]} pendingUserMessage="I am thinking..." />);

    expect(screen.getByText("I am thinking...").closest("[role='article']")?.className).toContain("stg:opacity-70");
  });

  it("renders a failed pending message with an inline Retry", () => {
    const onRetrySend = vi.fn();
    render(<MessageThread turns={[]} pendingUserMessage="unsent message" pendingMessageFailed onRetrySend={onRetrySend} />);

    expect(screen.getByText("unsent message")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetrySend).toHaveBeenCalledOnce();
  });

  describe("how a turn ended", () => {
    it("says a failed turn in words, never its raw error, and offers sending its message again", () => {
      const onRetryRun = vi.fn();
      renderThread(conversation({ id: "f", message: "do the thing", phase: "failed", error: "Activity task timed out" }), { onRetryRun });

      const notice = screen.getByRole("alert");
      expect(notice.textContent).toContain("This turn didn't finish.");
      expect(notice.textContent).not.toContain("Activity task timed out");
      expect(within(notice).getByRole("button", { name: "Copy details" })).toBeTruthy();
      fireEvent.click(within(notice).getByRole("button", { name: "Send it again" }));
      expect(onRetryRun).toHaveBeenCalledWith("do the thing");
    });

    it("offers no act where nothing can be sent again: a reader, a turn with no message, a request the provider refused", () => {
      renderThread(conversation({ id: "r", message: "do the thing", phase: "failed", error: "boom" }));
      expect(screen.queryByRole("button", { name: /again/ })).toBeNull();
      cleanup();
      renderThread(conversation({ id: "e", message: "execute", phase: "failed", error: "boom" }), { onRetryRun: vi.fn() });
      expect(screen.queryByRole("button", { name: /again/ })).toBeNull();
      cleanup();
      renderThread(conversation({ id: "q", phase: "failed", stopCause: "model_error", stopDetail: { kind: "request_rejected" }, error: "boom" }), { onRetryRun: vi.fn() });
      expect(screen.queryByRole("button", { name: /again/ })).toBeNull();
    });

    it("picks its words from the kind the runner named", () => {
      renderThread(
        conversation({ id: "k", phase: "failed", stopCause: "failed", stopDetail: { kind: "app_unreachable", app: "issue-tracker" }, error: "[MCPClientError] boom" }),
        { onRetryRun: vi.fn() },
      );

      expect(screen.getByRole("alert").textContent).toContain("The issue-tracker app wouldn't connect.");
    });

    it("says a budget stop as a pause, and continues with a message", () => {
      const onRetryRun = vi.fn();
      renderThread(conversation({ id: "b", phase: "terminated", stopCause: "budget_reached", stopDetail: { kind: "cost_cap" }, error: "Agent reached the cost limit" }), {
        onRetryRun,
      });

      expect(screen.getByText("This turn reached its spending cap.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Copy details" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      expect(onRetryRun).toHaveBeenCalledWith("Continue");
    });

    it("surfaces no reason for a completed turn", () => {
      renderThread(conversation({ id: "ok", error: "stale error that should be ignored" }));

      expect(screen.queryByText(/stale error/)).toBeNull();
    });

    it("renders a cancelled turn quietly, even with an error", () => {
      renderThread(conversation({ id: "c", message: "do the thing", phase: "cancelled", stopCause: "user", error: "Execution cancelled" }), { onRetryRun: vi.fn() });

      expect(screen.getByText(/cancelled/i)).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText("Execution cancelled")).toBeNull();
      expect(screen.getByText("This turn was stopped.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    });
  });

  describe("editing the live turn's message", () => {
    it("shows an Edit affordance only on the live turn's message and routes onEditMessage", () => {
      const onEditMessage = vi.fn();
      renderThread(conversation({ id: "old", message: "old turn" }, { id: "new", message: "new turn", phase: "running", reply: "working on it" }), { onEditMessage });

      const edit = screen.getAllByRole("button", { name: "Edit message" });
      expect(edit).toHaveLength(1);
      fireEvent.click(edit[0]!);
      expect(onEditMessage).toHaveBeenCalledWith("new turn");
    });

    it("shows no Edit affordance without onEditMessage", () => {
      renderThread(conversation({ id: "new", message: "fix the bug", phase: "running" }));

      expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
    });
  });

  // Issue #179: the synthetic "Thinking" placeholder yields the moment real
  // output (a thinking or a tool call) arrives.
  describe("the first output replaces the set-up placeholder (issue #179)", () => {
    it("hides the placeholder once a thinking arrives", () => {
      renderThread(conversation({ id: "s", phase: "running", reply: "", extra: thought("s", 0, "Let me reason") }));

      expect(screen.getByRole("article", { name: "Model thinking" })).toBeTruthy();
      expect(screen.queryByText("Thinking")).toBeNull();
    });

    it("hides the placeholder once a tool call runs", () => {
      renderThread(conversation({ id: "s", phase: "running", reply: "", extra: [use("s", "c1", "read_file", { path: "a" })] }));

      expect(screen.queryByText("Thinking")).toBeNull();
    });
  });

  describe("Plan turns", () => {
    const livePlan: TurnFixture = { id: "live", phase: "running", mode: InteractionMode.PLAN, reply: "# Rollout Plan\n\n1. First step" };

    it("collapses the plan being written behind a live card when onOpenPlan is wired", () => {
      const onOpenPlan = vi.fn();
      renderThread(conversation(livePlan), { onOpenPlan });

      expect(screen.getByRole("region", { name: "Plan being written" }).textContent).toContain("Rollout Plan");
      expect(screen.queryByText(/First step/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open plan" }));
      expect(onOpenPlan).toHaveBeenCalledWith("live");
    });

    it("keeps the plan inline for hosts without a plan surface", () => {
      renderThread(conversation(livePlan));

      expect(screen.queryByRole("region", { name: "Plan being written" })).toBeNull();
      expect(screen.getByText(/First step/)).toBeTruthy();
    });

    it("renders the build card of a completed Plan turn and routes Build", () => {
      const onBuildFromPlan = vi.fn();
      renderThread(conversation({ id: "p", mode: InteractionMode.PLAN }), { onBuildFromPlan });

      fireEvent.click(screen.getByRole("button", { name: "Build" }));
      expect(onBuildFromPlan).toHaveBeenCalledOnce();
    });

    it("marks a Plan turn's message with the Plan badge, and an Agent turn's with none", () => {
      renderThread(conversation({ id: "p", mode: InteractionMode.PLAN }));
      expect(screen.getByRole("status", { name: "Plan mode" })).toBeTruthy();
      cleanup();

      renderThread(conversation({ id: "a", mode: InteractionMode.AGENT }));
      expect(screen.queryByRole("status", { name: "Plan mode" })).toBeNull();
    });

    it("renders a completed Plan turn's plan as a document, and a live one as a chat message", () => {
      renderThread(conversation({ id: "p", mode: InteractionMode.PLAN, reply: "# Rollout Plan\n\n1. First step" }));
      const doc = screen.getByRole("article", { name: "Plan document" });
      expect(doc.textContent).toContain("Rollout Plan");
      cleanup();

      renderThread(conversation({ id: "live", phase: "running", mode: InteractionMode.PLAN, reply: "Draft so far" }));
      expect(screen.queryByRole("article", { name: "Plan document" })).toBeNull();
      expect(screen.getByRole("article", { name: "AI response" })).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Ambient liveness status line (stigmer#277)
// ---------------------------------------------------------------------------

describe("MessageThread liveness status line", () => {
  const LINE = '[data-cursor-target="liveness-status-line"]';

  it("anchors the thread's tail while the live turn works between visible events", () => {
    const { container } = renderThread(conversation({ id: "l", phase: "running", reply: "Let me look around." }));

    expect(container.querySelector(LINE)?.querySelector(".stgm-shimmer-label")?.textContent).toBe("Working…");
  });

  it("yields to a running tool call, and to a working subagent", () => {
    const tool = renderThread(conversation({ id: "l", phase: "running", reply: "Running.", extra: [use("l", "c1", "Bash", { command: "sleep 5" })] }));
    expect(tool.container.querySelector(LINE)).toBeNull();
    cleanup();

    const sub = renderThread(conversation({ id: "l", phase: "running", reply: "Delegating.", extra: [use("l", "task1", "task"), ...subagent("l", "task1")] }));
    expect(sub.container.querySelector(LINE)).toBeNull();
  });

  it("yields to a call waiting for a person", () => {
    const { container } = renderThread(
      conversation({ id: "l", phase: "running", reply: "I need a tool.", extra: [use("l", "c1", "write_file", {}, { ask: true }), asked("l", "c1")] }),
      { onAnswerToolUse: () => {} },
    );

    expect(container.querySelector(LINE)).toBeNull();
  });

  it("is absent once the turn ended — phase-driven", () => {
    const { container } = renderThread(conversation({ id: "d", reply: "All set." }));

    expect(container.querySelector(LINE)).toBeNull();
  });

  it("leaves the pre-first-output window to the set-up placeholder", () => {
    const { container } = renderThread(conversation({ id: "f", phase: "running", reply: "" }));

    expect(container.querySelector(LINE)).toBeNull();
    expect(screen.getByText("Thinking")).toBeTruthy();
  });
});

describe("MessageThread messages sent while a turn works", () => {
  it("shows a message the turn read mid-turn where it read it, as the person's", () => {
    const turns = turnsOf(user("r1", "build it"), said("r1", 0, "Building."), ev("r1", { case: "userMessage", value: { id: "sevt_q", content: [{ type: "text", text: "also the README" }], processedAt: "t" } }), said("r1", 1, "README too."));
    render(<MessageThread turns={turns} />);
    const texts = ["build it", "Building.", "also the README", "README too."].map((t) => screen.getByText(t));
    for (let i = 1; i < texts.length; i++) {
      expect(texts[i - 1]!.compareDocumentPosition(texts[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("shows each message no turn has read after the thread, queued or not read, and no second bubble for a pending one", () => {
    const turns = turnsOf(user("r1", "build it"), status("r1", "running"));
    render(
      <MessageThread
        turns={turns}
        queued={[
          { id: "q1", text: "dropped one", state: "dropped" },
          { id: "q2", text: "waiting one", state: "waiting" },
        ]}
        pendingUserMessage="waiting one"
      />,
    );
    expect(screen.getAllByText("waiting one")).toHaveLength(1);
    expect(screen.getByText(QUEUED_MESSAGE_LABEL)).toBeTruthy();
    expect(screen.getByText(DROPPED_MESSAGE_LABEL)).toBeTruthy();
  });
});
