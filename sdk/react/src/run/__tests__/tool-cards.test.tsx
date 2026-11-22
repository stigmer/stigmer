// Pins a host's own tool cards (`toolCards` on StigmerProvider): the card
// draws the body of its call's row in every state, under the kit's line,
// open by default, with the narrowed view (state, redacted input, result,
// truncation, session and run); the kit's approval stays the row for a
// viewer who answers, and a viewer who cannot reads whom it waits on above
// the card; a card that throws falls back to the kit's body and gets a fresh
// try once the call's state moves; built-in, memory and built-in-named calls
// take no card, nor does an inherited key; and every place that closes or
// groups steps keeps a call with a card in view: the working stretch, a
// plan's loose steps, a to-do item past its turn, grouped calls, a helper's
// row, and a finished turn, which draws each card once above its fold while
// the step inside draws the kit's body.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ToolUse, TurnSteps } from "@stigmer/client";
import { ToolCallItem } from "../ToolCallItem";
import { PlanSteps } from "../PlanSteps";
import { SubagentSection } from "../SubagentSection";
import { MessageThread, buildThreadItems, type ThreadItem } from "../MessageThread";
import { segmentToolCalls } from "../segment-tool-calls";
import { ApprovalContext } from "../ApprovalContext";
import { ThreadPresentationContext } from "../ThreadPresentationContext";
import { ToolCardsContext, type ToolCardProps, type ToolCards } from "../tool-cards-context";
import { hostCardOf, toolCallInfoOf } from "../tool-card";
import { thread, toolUse } from "./__fixtures__/fold-values";
import { result, said, status, subagent, toolId, turnsOf, use, user } from "./__fixtures__/thread-events";

afterEach(cleanup);

/** The host's invoice card: what it was handed, as words a test can read. */
function InvoiceCard({ call }: ToolCardProps) {
  return (
    <div data-testid="invoice-card">
      {call.state} · {call.sessionId} · {call.runId} · {call.result?.text ?? "no result"}
      {call.result?.truncated === true ? " · truncated" : ""}
    </div>
  );
}

const CARDS: ToolCards = { mcp__billing__create_invoice: InvoiceCard };

function invoice(init: Partial<Parameters<typeof toolUse>[0]> = {}): ToolUse {
  return toolUse({ name: "create_invoice", mcpServerName: "billing", input: { customer: "Acme", amount: 120 }, ...init });
}

function withCards(node: ReactNode, cards: ToolCards = CARDS, sessionId = "session_1"): ReactNode {
  return (
    <ToolCardsContext.Provider value={cards}>
      <ThreadPresentationContext.Provider value={{ sessionId }}>{node}</ThreadPresentationContext.Provider>
    </ToolCardsContext.Provider>
  );
}

describe("toolCallInfoOf", () => {
  it("maps each log state to the card's own, by the row's failure rule", () => {
    expect(toolCallInfoOf(invoice({ state: "running" }), "s").state).toBe("running");
    expect(toolCallInfoOf(invoice({ ask: {} }), "s").state).toBe("needs-approval");
    expect(toolCallInfoOf(invoice({ result: "INV-1" }), "s").state).toBe("completed");
    expect(toolCallInfoOf(invoice({ result: "no such customer", isError: true }), "s").state).toBe("failed");
    expect(toolCallInfoOf(invoice({ ask: {}, confirmation: "deny" }), "s").state).toBe("denied");
    expect(toolCallInfoOf(invoice({ state: "stopped" }), "s").state).toBe("stopped");
    // A call of the host app's own tools waits for the app, never for an approval.
    expect(toolCallInfoOf(invoice({ state: "waiting_on_host" }), "s").state).toBe("waiting-on-host");
  });

  it("hands the card its call, a redacted input, the result's truncation, the session and the run", () => {
    const info = toolCallInfoOf(invoice({ input: { customer: "Acme", token: "s3cret" }, result: "INV-1 head", fullOutput: { sizeBytes: 90_000n } }), "session_1");
    expect(info).toEqual({
      id: "run_1.create_invoice",
      tool: "create_invoice",
      server: "billing",
      input: { customer: "Acme", token: "[REDACTED]" },
      state: "completed",
      result: { text: "INV-1 head", isError: false, truncated: true },
      sessionId: "session_1",
      runId: "run_1",
    });
  });
});

describe("hostCardOf", () => {
  it("matches a connected server's tool by its public name", () => {
    expect(hostCardOf(CARDS, invoice())).toBe(InvoiceCard);
    expect(hostCardOf(null, invoice())).toBeUndefined();
  });

  it("gives no card to a built-in, the memory attachment's tool, or a server tool named like a built-in", () => {
    const cards: ToolCards = { mcp____Edit: InvoiceCard, "mcp__stigmer-memory__remember": InvoiceCard, mcp__files__read_file: InvoiceCard };
    expect(hostCardOf(cards, toolUse({ name: "Edit" }))).toBeUndefined();
    expect(hostCardOf(cards, toolUse({ name: "remember", mcpServerName: "stigmer-memory" }))).toBeUndefined();
    expect(hostCardOf(cards, toolUse({ name: "read_file", mcpServerName: "files" }))).toBeUndefined();
  });

  it("never matches an inherited key", () => {
    const inherited = Object.create({ mcp__billing__create_invoice: InvoiceCard }) as ToolCards;
    expect(hostCardOf(inherited, invoice())).toBeUndefined();
  });
});

describe("ToolCallItem with a host card", () => {
  it.each([
    ["running", invoice({ state: "running" }), "running · session_1 · run_1 · no result"],
    ["completed", invoice({ result: "INV-1" }), "completed · session_1 · run_1 · INV-1"],
    ["failed", invoice({ result: "no such customer", isError: true }), "failed · session_1 · run_1 · no such customer"],
    ["denied", invoice({ ask: {}, confirmation: "deny" }), "denied · session_1 · run_1 · no result"],
    ["stopped", invoice({ state: "stopped" }), "stopped · session_1 · run_1 · no result"],
    ["truncated", invoice({ result: "INV-1 head", fullOutput: {} }), "completed · session_1 · run_1 · INV-1 head · truncated"],
  ])("draws the card under the kit's line, open, while %s", (_name, call, words) => {
    const { container } = render(withCards(<ToolCallItem toolUse={call} />));

    expect(screen.getByTestId("invoice-card").textContent).toBe(words);
    // The line stays the kit's, with its toggle open by default.
    const toggle = container.querySelector('[data-cursor-target="thread-card-toggle"]');
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the failed mark and the denied badge in the kit's line", () => {
    render(withCards(<ToolCallItem toolUse={invoice({ ask: {}, confirmation: "deny" })} />));
    expect(screen.getByText("Denied")).toBeTruthy();
  });

  it("lets a person close it, and the card goes with the body", () => {
    const { container } = render(withCards(<ToolCallItem toolUse={invoice({ result: "INV-1" })} />));
    fireEvent.click(container.querySelector('[data-cursor-target="thread-card-toggle"]')!);
    expect(screen.queryByTestId("invoice-card")).toBeNull();
  });

  it("draws the kit's approval, and no card, for a viewer who answers", () => {
    render(
      withCards(
        <ApprovalContext.Provider value={{ onAnswer: () => {}, submittingIds: new Set(), errorsByToolUseId: new Map() }}>
          <ToolCallItem toolUse={invoice({ ask: {} })} />
        </ApprovalContext.Provider>,
      ),
    );
    expect(screen.getByRole("alert", { name: "Approval required for create_invoice" })).toBeTruthy();
    expect(screen.queryByTestId("invoice-card")).toBeNull();
  });

  it("draws the card as needing approval under a line saying whom it waits on, for a viewer who cannot answer", () => {
    render(
      withCards(
        <ApprovalContext.Provider value={{ submittingIds: new Set(), errorsByToolUseId: new Map(), approverName: "Priya" }}>
          <ToolCallItem toolUse={invoice({ ask: {} })} />
        </ApprovalContext.Provider>,
      ),
    );
    expect(screen.getByTestId("invoice-card").textContent).toContain("needs-approval");
    expect(screen.getByText(/Priya/)).toBeTruthy();
  });

  it("draws the kit's body when the card throws, and tries the card again once the call's state moves", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let throws = true;
    function Flaky({ call }: ToolCardProps) {
      if (throws) throw new Error("card broke");
      return <div data-testid="flaky-card">{call.state}</div>;
    }
    const cards: ToolCards = { mcp__billing__create_invoice: Flaky };
    const { rerender } = render(withCards(<ToolCallItem toolUse={invoice({ state: "running" })} />, cards));
    expect(screen.queryByTestId("flaky-card")).toBeNull();

    // Same state: still the kit's body, no fresh try.
    throws = false;
    rerender(withCards(<ToolCallItem toolUse={invoice({ state: "running", input: { customer: "Acme", amount: 121 } })} />, cards));
    expect(screen.queryByTestId("flaky-card")).toBeNull();

    // The result landed: the card draws.
    rerender(withCards(<ToolCallItem toolUse={invoice({ result: "INV-1 for Acme" })} />, cards));
    expect(screen.getByTestId("flaky-card").textContent).toBe("completed");
    error.mockRestore();
  });

  it("falls back to the kit's own fields for the call", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never {
      throw new Error("card broke");
    }
    render(withCards(<ToolCallItem toolUse={invoice({ result: "INV-1 for Acme" })} />, { mcp__billing__create_invoice: Broken }));
    expect(screen.getAllByText(/INV-1 for Acme/).length).toBeGreaterThan(0);
    expect(screen.getByText("Acme")).toBeTruthy();
    error.mockRestore();
  });

  it("keeps a helper's own collapsible step open after it finished while a step inside has a card", () => {
    const done = thread({ state: "completed", items: [invoice({ threadId: "t1", result: "INV-1" })] });
    render(withCards(<SubagentSection thread={done} subject="bill the customer" collapsible />));
    expect(screen.getByTestId("invoice-card")).toBeTruthy();

    cleanup();
    render(<SubagentSection thread={done} subject="bill the customer" collapsible />);
    expect(screen.queryByText(/INV-1/)).toBeNull();
  });

  it("keeps a helper's row open after it finished while a step inside has a card", () => {
    const helper = toolUse({
      name: "task",
      input: { description: "bill the customer" },
      result: "done",
      thread: thread({ state: "completed", items: [invoice({ threadId: "t1", result: "INV-1" })] }),
    });
    render(withCards(<ToolCallItem toolUse={helper} />));
    expect(screen.getByTestId("invoice-card")).toBeTruthy();
  });
});

describe("a call with a host card is never closed or grouped away", () => {
  const R = "run_w";
  function working(cards: boolean): ThreadItem[] {
    const turns = turnsOf(
      user(R, "go"),
      status(R, "running"),
      use(R, "c1", "read_file", { path: "a.ts" }),
      result(R, "c1", "ok"),
      use(R, "c2", "create_invoice", { customer: "Acme" }, { mcpServerName: "billing" }),
      result(R, "c2", "INV-1"),
    );
    return buildThreadItems(turns, [], { includeLiveness: false, ...(cards ? { hasToolCard: (tool: ToolUse) => hostCardOf(CARDS, tool) !== undefined } : {}) });
  }

  it("keeps the working turn's stretch unfolded", () => {
    const group = (items: ThreadItem[]) => items.find((item) => item.kind === "tool-group");
    expect(group(working(false))).toMatchObject({ fold: true });
    expect(group(working(true))).not.toHaveProperty("fold");
  });

  it("never groups a call with a card into a chip", () => {
    const reads = [toolUse({ id: "r1", name: "read_file" }), toolUse({ id: "r2", name: "read_file" }), toolUse({ id: "r3", name: "read_file" })];
    expect(segmentToolCalls(reads).map((s) => s.kind)).toEqual(["run"]);
    expect(segmentToolCalls(reads, (tool) => tool.id === "r2").map((s) => s.kind)).toEqual(["row", "row", "row"]);
  });

  it("keeps a plan's loose steps with a card out of the folded stretch", () => {
    const steps: TurnSteps = {
      plan: [],
      loose: [toolUse({ id: "l1", name: "read_file", result: "a" }), toolUse({ id: "l2", name: "read_file", result: "b" }), invoice({ id: "l3", result: "INV-1" })],
    };
    render(withCards(<PlanSteps steps={steps} working={false} />));
    expect(screen.getByTestId("invoice-card")).toBeTruthy();
  });

  it("keeps a to-do item open past its turn while it holds a call with a card, its own or a helper's", () => {
    const helper = toolUse({ id: "h1", name: "task", input: { description: "bill" }, result: "done", thread: thread({ state: "completed", items: [invoice({ id: "i2", threadId: "h1", result: "INV-2" })] }) });
    const steps: TurnSteps = {
      plan: [
        { todo: { id: "t1", content: "Bill Acme", status: "completed", createdAt: "", updatedAt: "" }, calls: [invoice({ id: "i1", result: "INV-1" })] },
        { todo: { id: "t2", content: "Bill Initech", status: "completed", createdAt: "", updatedAt: "" }, calls: [helper] },
        { todo: { id: "t3", content: "Read the ledger", status: "completed", createdAt: "", updatedAt: "" }, calls: [toolUse({ id: "r1", name: "read_file", result: "a" })] },
      ],
      loose: [],
    };
    render(withCards(<PlanSteps steps={steps} working={false} />));
    expect(screen.getAllByTestId("invoice-card").map((card) => card.textContent)).toEqual([
      expect.stringContaining("INV-1"),
      expect.stringContaining("INV-2"),
    ]);
    expect(screen.getByRole("button", { name: "Read the ledger" }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("a finished turn's host cards", () => {
  const R = "run_f";
  const turns = turnsOf(
    user(R, "Bill Acme"),
    status(R, "running"),
    use(R, "c1", "create_invoice", { customer: "Acme" }, { mcpServerName: "billing" }),
    result(R, "c1", "INV-1"),
    said(R, 0, "The invoice is ready."),
    status(R, "completed"),
  );

  it("rides the fold's item, in the order made", () => {
    const items = buildThreadItems(turns, [], { includeLiveness: false, hasToolCard: (tool) => hostCardOf(CARDS, tool) !== undefined });
    const how = items.find((item): item is Extract<ThreadItem, { kind: "how-it-got-there" }> => item.kind === "how-it-got-there");
    expect(how?.cards.map((tool) => tool.id)).toEqual([toolId(R, "c1")]);
  });

  it("lifts a helper's card out of the fold too", () => {
    const threadId = toolId(R, "task1");
    const helperTurns = turnsOf(
      user(R, "Bill Acme"),
      status(R, "running"),
      use(R, "task1", "task", { description: "bill Acme" }),
      subagent(R, "task1", {
        items: [use(R, "c1", "create_invoice", { customer: "Acme" }, { mcpServerName: "billing", threadId }), result(R, "c1", "INV-7", { threadId })],
        finished: "completed",
        reply: "Billed.",
      }),
      result(R, "task1", "Billed."),
      said(R, 0, "Acme is billed."),
      status(R, "completed"),
    );
    const items = buildThreadItems(helperTurns, [], { includeLiveness: false, hasToolCard: (tool) => hostCardOf(CARDS, tool) !== undefined });
    const how = items.find((item): item is Extract<ThreadItem, { kind: "how-it-got-there" }> => item.kind === "how-it-got-there");
    expect(how?.cards.map((tool) => tool.id)).toEqual([toolId(R, "c1")]);

    render(withCards(<MessageThread turns={helperTurns} />));
    expect(screen.getAllByTestId("invoice-card").map((card) => card.textContent)).toEqual([expect.stringContaining("INV-7")]);
  });

  it("puts the kit's body above the fold when a lifted card throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never {
      throw new Error("card broke");
    }
    render(withCards(<MessageThread turns={turns} />, { mcp__billing__create_invoice: Broken }));
    const lifted = document.querySelector('[data-cursor-target="host-tool-card"]');
    expect(lifted).not.toBeNull();
    expect(lifted!.textContent).toContain("INV-1");
    error.mockRestore();
  });

  it("draws each card once, after the answer and above the fold, and the step inside draws the kit's body", () => {
    render(withCards(<MessageThread turns={turns} sessionId="session_1" />));

    const cards = screen.getAllByTestId("invoice-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toBe("completed · session_1 · run_f · INV-1");
    const answer = screen.getByRole("article", { name: "AI response" });
    const fold = screen.getByRole("button", { name: /How it got there/ });
    expect(answer.compareDocumentPosition(cards[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cards[0]!.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(fold);
    expect(screen.getAllByTestId("invoice-card")).toHaveLength(1);
    const step = screen.getAllByRole("group").find((group) => group.getAttribute("data-cursor-target") === "tool-call-group");
    expect(step).toBeTruthy();
    expect(within(step!).queryByTestId("invoice-card")).toBeNull();
  });
});
