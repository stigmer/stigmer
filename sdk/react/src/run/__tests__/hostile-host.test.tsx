/**
 * A hostile host cannot take what stays fixed. Every part a host can hand
 * the thread (each slot, a tool card, message actions, a tool presenter's
 * overrides) is replaced at once, in two threads: one waiting on two asks
 * (one inside a tool's row, one with no row of its own) beside a to-do list,
 * and one whose named tool failed and whose turn ended in the failure notice,
 * with a send that failed after it. Under a host whose every part throws, the
 * kit's own parts draw in their place: both approvals with Allow and Deny
 * (and Allow answers), the failed mark, the notice, Copy on every settled
 * message and the failed send, the to-do rows, and every throw is reported,
 * none uncaught. Under a host whose parts draw nothing, the ask inside a row
 * and the failed mark still show, every row keeps a name, and the parts a
 * slot replaces whole still received the decision's wiring, with nothing of
 * the kit's drawn behind them. Under a host that floods, Copy stays first,
 * two icons and one menu hold fifty acts, and an act that throws leaves the
 * thread drawn. A presenter whose label or summary fails leaves the kit's
 * words whole: the counts, and "Created" on a write that made its file.
 *
 * A call of the app's own tools waits in a third thread: a card that
 * throws leaves the kit's row saying it waits for the app, a card that
 * draws nothing leaves the row's line, and a card that floods and answers
 * into a refusal leaves the thread drawn with no unhandled rejection.
 *
 * The slots are typed `Required<MessageThreadSlots>`, so a new slot fails to
 * compile here until the hostile hosts replace it too; a new mechanism joins
 * the list by hand.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { ToolKind, Turn } from "@stigmer/client";
import { MessageThread, type MessageThreadProps, type MessageThreadSlots } from "../MessageThread";
import type { ApprovalCardProps } from "../ApprovalCard";
import type { RunErrorNoticeProps } from "../RunErrorNotice";
import type { MessageAction, MessageInfo } from "../message-actions";
import { ToolCardsContext, type ToolCards } from "../tool-cards-context";
import { registerToolPresenter, type ToolPresenter } from "../tool-presenter";
import { ToolCallItem } from "../ToolCallItem";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { FileReviewContext } from "@stigmer/react-core";
import { reviewFile, reviewSet, toolUse } from "./__fixtures__/fold-values";
import { asked, conversation, customUse, result, said, status, toolId, use } from "./__fixtures__/thread-events";

// ---------------------------------------------------------------------------
// The two threads
// ---------------------------------------------------------------------------

const DONE = "run_done";
const LIVE = "run_live";
const FAILED = "run_failed";

/**
 * A finished turn with its answer, then a live turn that wrote its to-dos and
 * waits on two asks: a command, inside its row, and a to-do write, which has
 * no row of its own.
 */
function waitingThread() {
  return conversation(
    { id: DONE, message: "Plan the release", reply: "Looking at the branches.", extra: [said(DONE, 1, "The release plan is ready.")] },
    {
      id: LIVE,
      message: "Clean the build",
      phase: "running",
      reply: "",
      extra: [
        use(LIVE, "todo", "write_todos", { todos: [{ content: "Clean the build", status: "in_progress" }] }),
        result(LIVE, "todo", "ok"),
        use(LIVE, "sh", "Bash", { command: "rm -rf build" }, { ask: true }),
        asked(LIVE, "sh"),
        use(LIVE, "gate", "write_todos", {}, { ask: true }),
        asked(LIVE, "gate"),
        status(LIVE, "waiting"),
      ],
    },
  );
}

/** A turn whose billing tool failed, ending in the failure notice. */
function failedThread() {
  return conversation({
    id: FAILED,
    message: "Bill Acme",
    reply: "Creating the invoice.",
    phase: "failed",
    error: "model capacity exhausted",
    extra: [use(FAILED, "inv", "create_invoice", { customer: "Acme" }, { mcpServerName: "billing" }), result(FAILED, "inv", "no such customer", { isError: true })],
  });
}

/** The kinds the threads' steps resolve to, for the presenter a host registers. */
const APP = "run_app";

/** A live turn whose call of the app's own tool waits for the app's answer. */
function appWaitingThread() {
  return conversation({
    id: APP,
    message: "Connect our payments account",
    phase: "running",
    reply: "I'll fill in the registration form for you to check.",
    extra: [customUse(APP, "reg", "register_cloud_account", { account_name: "payments-prod" }), status(APP, "waiting")],
  });
}

const PRESENTED_KINDS: readonly ToolKind[] = ["shell", "mcp", "todo"];

// ---------------------------------------------------------------------------
// The hostile hosts
// ---------------------------------------------------------------------------

/** What a host hands the thread, besides the presenter it registers. */
interface Host {
  readonly slots: Required<MessageThreadSlots>;
  readonly cards: ToolCards;
  readonly messageActions: NonNullable<MessageThreadProps["messageActions"]>;
  readonly presenter: ToolPresenter;
}

function broke(part: string): never {
  throw new Error(`host part broke: ${part}`);
}

/** Every part throws. */
const THROWS: Host = {
  slots: {
    MessageEntry: () => broke("MessageEntry"),
    ApprovalCard: () => broke("ApprovalCard"),
    TodoCard: () => broke("TodoCard"),
    TodoRow: () => broke("TodoRow"),
    PlanFileCard: () => broke("PlanFileCard"),
    PlanCompletionCard: () => broke("PlanCompletionCard"),
    PlanStreamingCard: () => broke("PlanStreamingCard"),
    SetupProgress: () => broke("SetupProgress"),
    RecalledMemoriesCard: () => broke("RecalledMemoriesCard"),
    RunErrorNotice: () => broke("RunErrorNotice"),
    LivenessStatusLine: () => broke("LivenessStatusLine"),
  },
  cards: { mcp__billing__create_invoice: () => broke("tool card"), register_cloud_account: () => broke("custom tool card") },
  messageActions: () => broke("messageActions"),
  presenter: {
    label: () => broke("presenter label"),
    summary: () => broke("presenter summary"),
    disclosure: () => broke("presenter disclosure"),
    chrome: () => broke("presenter chrome"),
    runGroupable: () => broke("presenter runGroupable"),
  },
};

/** What the parts a slot replaces whole were handed, under the host that draws nothing. */
const handed: { approvals: ApprovalCardProps[]; notices: RunErrorNoticeProps[] } = { approvals: [], notices: [] };

/** Every part draws nothing, and the presenter gives its quietest words. */
const DRAWS_NOTHING: Host = {
  slots: {
    MessageEntry: () => null,
    ApprovalCard: (props) => {
      handed.approvals.push(props);
      return null;
    },
    TodoCard: () => null,
    TodoRow: () => null,
    PlanFileCard: () => null,
    PlanCompletionCard: () => null,
    PlanStreamingCard: () => null,
    SetupProgress: () => null,
    RecalledMemoriesCard: () => null,
    RunErrorNotice: (props) => {
      handed.notices.push(props);
      return null;
    },
    LivenessStatusLine: () => null,
  },
  cards: { mcp__billing__create_invoice: () => null, register_cloud_account: () => null },
  messageActions: () => [],
  presenter: { label: () => "  ", summary: () => null, disclosure: () => "summary", chrome: () => "quiet", runGroupable: () => false },
};

let disposers: Array<() => void> = [];

function hostRegisters(presenter: ToolPresenter): void {
  disposers = PRESENTED_KINDS.map((kind) => registerToolPresenter(kind, presenter));
}

/** The thread under `host`, with every wiring a person needs to act. */
function renderUnder(host: { readonly slots?: MessageThreadSlots; readonly cards: ToolCards; readonly messageActions: Host["messageActions"] }, conv: { turns: readonly Turn[]; runs: Run[] }, props: Partial<MessageThreadProps> = {}) {
  const node: ReactNode = (
    <ToolCardsContext.Provider value={host.cards}>
      <MessageThread turns={conv.turns} runs={conv.runs} sessionId="session_1" slots={host.slots} messageActions={host.messageActions} {...props} />
    </ToolCardsContext.Provider>
  );
  return render(node);
}

// ---------------------------------------------------------------------------
// DOM stubs and the error watch
// ---------------------------------------------------------------------------

let consoleError: ReturnType<typeof vi.spyOn>;
let uncaught: unknown[];
const onWindowError = (event: ErrorEvent) => {
  uncaught.push(event.error);
};

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(), takeRecords: vi.fn(() => []), root: null, rootMargin: "", thresholds: [0] })));
  vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  uncaught = [];
  window.addEventListener("error", onWindowError);
  handed.approvals = [];
  handed.notices = [];
});

afterEach(() => {
  cleanup();
  for (const dispose of disposers) dispose();
  disposers = [];
  window.removeEventListener("error", onWindowError);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The kit's failure notice, if it draws. */
function failureNotice(): HTMLElement | undefined {
  return screen.queryAllByRole("alert").find((alert) => alert.textContent?.includes("This turn didn't finish."));
}

/** The messages the reports named, as `host part broke: <part>`. */
function reportedParts(): string[] {
  const parts = new Set<string>();
  for (const call of consoleError.mock.calls) {
    for (const arg of call) {
      const message = arg instanceof Error ? arg.message : typeof arg === "string" ? arg : "";
      const match = /host part broke: ([\w ]+)/.exec(message);
      if (match) parts.add(match[1]!);
    }
  }
  return [...parts].sort();
}

// ---------------------------------------------------------------------------
// A host whose every part throws
// ---------------------------------------------------------------------------

describe("a host whose every part throws", () => {
  it("still offers both approvals with Allow and Deny, and Allow answers its call", () => {
    hostRegisters(THROWS.presenter);
    const onAnswerToolUse = vi.fn();
    renderUnder(THROWS, waitingThread(), { onAnswerToolUse });

    const inRow = screen.getByRole("alert", { name: "Approval required for Bash" });
    const backstop = screen.getByRole("alert", { name: "Approval required for write_todos" });
    for (const approval of [inRow, backstop]) {
      expect(within(approval).getByRole("button", { name: "Allow" })).toBeTruthy();
      expect(within(approval).getByRole("button", { name: "Deny" })).toBeTruthy();
    }
    fireEvent.click(within(inRow).getByRole("button", { name: "Allow" }));
    fireEvent.click(within(backstop).getByRole("button", { name: "Allow" }));
    expect(onAnswerToolUse).toHaveBeenCalledWith(toolId(LIVE, "sh"), "allow", undefined);
    expect(onAnswerToolUse).toHaveBeenCalledWith(toolId(LIVE, "gate"), "allow", undefined);

    // The to-do list draws, its rows the kit's.
    expect(screen.getByRole("region", { name: "Agent to-dos" }).textContent).toContain("Clean the build");
    // Copy on every settled message.
    expect(screen.getAllByRole("button", { name: "Copy message" }).length).toBeGreaterThanOrEqual(3);
    expect(uncaught).toEqual([]);
    expect(reportedParts()).toEqual(expect.arrayContaining(["ApprovalCard", "MessageEntry", "TodoCard", "messageActions", "presenter label"]));
  });

  it("still shows the failed step's mark, the failure notice, and Copy on the failed send", () => {
    hostRegisters(THROWS.presenter);
    const { container } = renderUnder(THROWS, failedThread(), { onRetryRun: vi.fn(), onRetrySend: vi.fn(), pendingUserMessage: "Try the invoice again", pendingMessageFailed: true });

    // The step's own words, its failed mark, and the kit's body in place of the card.
    const row = [...container.querySelectorAll('[data-cursor-target="tool-call-row"]')].find((el) => el.textContent?.includes("create_invoice") || el.textContent?.includes("Create invoice"));
    expect(row).toBeDefined();
    expect(row!.querySelector(".stg\\:text-status-failed")).not.toBeNull();
    expect(failureNotice()).toBeDefined();
    expect(screen.getByRole("button", { name: "Send it again" })).toBeTruthy();
    // The failed send keeps its bubble, its Copy and its retry.
    expect(screen.getByText("Try the invoice again")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Copy message" }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(uncaught).toEqual([]);
    expect(reportedParts()).toEqual(expect.arrayContaining(["MessageEntry", "RunErrorNotice", "tool card"]));
  });
});

// ---------------------------------------------------------------------------
// A host whose every part draws nothing
// ---------------------------------------------------------------------------

describe("a host whose every part draws nothing", () => {
  it("leaves the ask inside a row with Allow and Deny, and hands the slotted ask its wiring", () => {
    hostRegisters(DRAWS_NOTHING.presenter);
    const onAnswerToolUse = vi.fn();
    const { container } = renderUnder(DRAWS_NOTHING, waitingThread(), { onAnswerToolUse });

    // The ask inside a tool's row is the row's, not a slot's.
    const inRow = screen.getByRole("alert", { name: "Approval required for Bash" });
    fireEvent.click(within(inRow).getByRole("button", { name: "Allow" }));
    expect(onAnswerToolUse).toHaveBeenCalledWith(toolId(LIVE, "sh"), "allow", undefined);
    expect(within(inRow).getByRole("button", { name: "Deny" })).toBeTruthy();

    // The ask with no row went to the host's card, with what deciding needs,
    // and the kit draws no second approval behind it.
    expect(screen.queryByRole("alert", { name: "Approval required for write_todos" })).toBeNull();
    const slotted = handed.approvals.at(-1)!;
    expect(slotted.toolUse.id).toBe(toolId(LIVE, "gate"));
    slotted.onAnswer("deny", "not now");
    expect(onAnswerToolUse).toHaveBeenCalledWith(toolId(LIVE, "gate"), "deny", "not now");

    // Every step row keeps a name: the blank label fell back to the kit's words.
    for (const toggle of container.querySelectorAll('[data-cursor-target="thread-card-toggle"]')) {
      expect(toggle.getAttribute("aria-label")?.trim() ?? toggle.textContent?.trim()).not.toBe("");
    }
    expect(uncaught).toEqual([]);
  });

  it("keeps the failed mark, and hands the notice slot the failure and its retry", () => {
    hostRegisters(DRAWS_NOTHING.presenter);
    const onRetryRun = vi.fn();
    const { container } = renderUnder(DRAWS_NOTHING, failedThread(), { onRetryRun });

    expect(container.querySelector(".stg\\:text-status-failed")).not.toBeNull();
    // The notice is the host's to draw: it was told the reason and how to retry,
    // and the kit draws no notice of its own behind it.
    expect(failureNotice()).toBeUndefined();
    const notice = handed.notices.at(-1)!;
    expect(notice.error).toBe("model capacity exhausted");
    notice.onRetry?.(notice.retryMessage ?? "");
    expect(onRetryRun).toHaveBeenCalledWith("Bill Acme");
    expect(uncaught).toEqual([]);
  });

  it("draws a failed step as a card however quiet the presenter asks it to be, named by the kit's words", () => {
    hostRegisters(DRAWS_NOTHING.presenter);
    const { container } = render(<ToolCallItem toolUse={toolUse({ name: "Bash", input: { command: "make" }, result: "boom\n[Command failed with exit code 2]" })} />);

    const row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    expect(row.className).toContain("stg:rounded-lg");
    expect(row.querySelector(".stg\\:text-status-failed")).not.toBeNull();
    const toggle = container.querySelector('[data-cursor-target="thread-card-toggle"]');
    expect(toggle?.getAttribute("aria-label")).toContain("Command failed");
  });
});

// ---------------------------------------------------------------------------
// Which words stay the host's when its presenter fails
// ---------------------------------------------------------------------------

describe("a presenter whose words fail", () => {
  /** The step's second line: the line under its words. */
  const secondLine = (container: HTMLElement) => container.querySelector("[data-step-title]")!.nextElementSibling?.textContent ?? "";

  it("keeps the kit's counts when its summary throws", () => {
    disposers = [registerToolPresenter("search", { summary: () => broke("presenter summary") })];
    const grep = toolUse({
      name: "grep",
      input: { pattern: "round(", path: "src/billing" },
      result: "src/billing/invoice.ts:41:sum + roundCents(lineTotal(line))\nsrc/billing/credit-note.ts:18:amount: roundCents(line.amount)",
    });
    const { container } = render(<ToolCallItem toolUse={grep} />);

    expect(secondLine(container)).toBe("2 matches in 2 files");
    expect(reportedParts()).toEqual(["presenter summary"]);
  });

  it.each([
    ["throws", (): string => broke("presenter label")],
    ["is blank", (): string => " "],
  ])("keeps Created on a write its review says made the file when its label %s", (_name, label) => {
    disposers = [registerToolPresenter("file_write", { label })];
    const write = toolUse({ name: "write_file", input: { path: "/workspace/src/billing/rounding.test.ts", content: "a\nb\n" }, result: "ok" });
    const set = reviewSet({ files: [reviewFile({ path: "src/billing/rounding.test.ts", change: "added" })] });
    const { container } = render(
      <FileReviewContext.Provider value={{ fileReviewByRunId: new Map([["run_1", [set]]]), changeSetsById: new Map() }}>
        <ToolCallItem toolUse={write} />
      </FileReviewContext.Provider>,
    );

    expect(container.querySelector("[data-step-title]")!.textContent).toContain("Created");
    expect(secondLine(container)).toContain("new file");
  });
});

// ---------------------------------------------------------------------------
// A host that floods
// ---------------------------------------------------------------------------

describe("a host that floods", () => {
  const icon = <span aria-hidden="true">•</span>;
  const FIFTY: readonly MessageAction[] = Array.from({ length: 50 }, (_, i) => ({
    id: `act-${i}`,
    label: `Act ${i}`,
    icon,
    onAction: i === 0 ? () => broke("onAction") : () => {},
  }));
  const LONG = "An invoice line. ".repeat(2000);
  const FLOODS = {
    cards: { mcp__billing__create_invoice: () => <div data-testid="long-card">{LONG}</div> },
    messageActions: (message: MessageInfo) => (message.isFinalAnswer ? FIFTY : []),
  };

  it("keeps Copy first, two icons and one menu for fifty acts, and survives an act that throws", async () => {
    renderUnder(FLOODS, waitingThread(), { onAnswerToolUse: vi.fn() });

    const answer = screen.getByText("The release plan is ready.").closest<HTMLElement>('[role="article"]')!;
    const buttons = within(answer).getAllByRole("button");
    expect(buttons[0]!.getAttribute("aria-label") ?? buttons[0]!.textContent).toBe("Copy message");
    expect(within(answer).getByRole("button", { name: "Act 0" })).toBeTruthy();
    expect(within(answer).getByRole("button", { name: "Act 1" })).toBeTruthy();
    expect(within(answer).queryByRole("button", { name: "Act 2" })).toBeNull();

    // An act that throws is an event handler's error: the thread stays drawn.
    fireEvent.click(within(answer).getByRole("button", { name: "Act 0" }));
    expect(screen.getByText("The release plan is ready.")).toBeTruthy();

    await openMenu(within(answer).getByRole("button", { name: "More actions" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(48);
  });

  it("draws a card's very long body inside the row, the step line still the kit's", () => {
    const { container } = renderUnder(FLOODS, failedThread(), { onRetryRun: vi.fn() });

    expect(screen.getByTestId("long-card")).toBeTruthy();
    expect(container.querySelector(".stg\\:text-status-failed")).not.toBeNull();
    expect(failureNotice()).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The app's own tools
// ---------------------------------------------------------------------------

describe("a call of the app's own tools under a hostile host", () => {
  it("keeps the kit's row saying it waits for the app when the card throws, and reports the throw", () => {
    hostRegisters(THROWS.presenter);
    renderUnder(THROWS, appWaitingThread(), { onAnswerCustomToolUse: vi.fn() });

    expect(screen.getByText(/Waiting for the app/)).toBeTruthy();
    expect(screen.getByText("payments-prod")).toBeTruthy();
    expect(reportedParts()).toContain("custom tool card");
    expect(uncaught).toEqual([]);
  });

  it("keeps the row's line when the card draws nothing", () => {
    hostRegisters(DRAWS_NOTHING.presenter);
    renderUnder(DRAWS_NOTHING, appWaitingThread(), { onAnswerCustomToolUse: vi.fn() });

    expect(screen.getByText("Register cloud account")).toBeTruthy();
    expect(screen.getByText(/Waiting for the app/)).toBeTruthy();
  });

  it("keeps the thread when a flooding card's answer is refused, with no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => unhandled.push(event.reason);
    window.addEventListener("unhandledrejection", onUnhandled);
    const refused = vi.fn(async () => Promise.reject(new Error("already answered")));
    const LONG = "A field. ".repeat(2000);
    const floods = {
      cards: {
        register_cloud_account: ({ answer }: { answer?: (text: string) => Promise<void> }) => (
          <div data-testid="long-app-card">
            {LONG}
            <button type="button" onClick={() => void answer?.("Registered").catch(() => undefined)}>
              Register
            </button>
          </div>
        ),
      },
      messageActions: () => [],
    };
    renderUnder(floods, appWaitingThread(), { onAnswerCustomToolUse: refused });

    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await vi.waitFor(() => expect(refused).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("long-app-card")).toBeTruthy();
    expect(screen.getByText(/Waiting for the app/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    window.removeEventListener("unhandledrejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });
});
