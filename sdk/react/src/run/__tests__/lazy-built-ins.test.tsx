/**
 * The light chat entry's slot built-ins (../lazy-built-ins.tsx) draw the real
 * ones, so a host importing them from `@stigmer/react-sdk/chat` keeps our
 * renderer out of its page's first download and still sees our part:
 *
 *   - inside a thread, on its first frame, from the thread alone: the static
 *     markup (no effect runs) of a thread whose `MessageEntry` slot hands the
 *     agent's messages back holds our response, with a loader that never
 *     answers, on the plain path and, once its own chunk is in, the
 *     virtualized one; a host tool card drawn in the thread hands back too;
 *   - outside any thread, once the built-ins' import lands: nothing before,
 *     the part after, at once on every later mount, and a failed import
 *     tried again on the next mount; the exported ones import the real
 *     built-ins;
 *   - with the props they were given, unchanged (a to-do row's item, an
 *     error notice's retry).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import React, { type ReactNode } from "react";
import type { Stigmer, Todo } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import * as ChatEntry from "../../chat";
import { MessageThread, type MessageThreadProps } from "../MessageThread";
import type { MessageEntryProps } from "../MessageEntry";
import { SLOT_BUILT_INS } from "../slot-guard";
import type { SlotBuiltIns } from "../built-ins-context";
import { ToolCardsContext, type ToolCardProps } from "../tool-cards-context";
import { builtInsLoader, thinBuiltIns } from "../lazy-built-ins";
import { conversation, result, use } from "./__fixtures__/thread-events";

vi.mock("react-virtuoso", () => ({
  Virtuoso: React.forwardRef(function MockVirtuoso(props: Record<string, unknown>, ref: React.Ref<unknown>) {
    const data = props.data as { key: string }[];
    const itemContent = props.itemContent as (index: number, item: unknown) => React.ReactNode;
    React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
    return (
      <div data-testid="virtuoso-scroller">
        {data.map((item, i) => (
          <div key={item.key}>{itemContent(i, item)}</div>
        ))}
      </div>
    );
  }),
}));

beforeEach(() => {
  const observer = vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(), takeRecords: vi.fn(() => []), root: null, rootMargin: "", thresholds: [0] }));
  vi.stubGlobal("IntersectionObserver", observer);
  vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
  vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => (cb(performance.now()), 1)));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A client no test reaches. */
const CLIENT = {} as Stigmer;

/** Built-ins whose own import never lands: whatever they draw came from the thread. */
function threadOnly(): SlotBuiltIns {
  return thinBuiltIns(builtInsLoader(() => new Promise<SlotBuiltIns>(() => undefined)));
}

/** The tutorial's swap: the person's messages in the app's bubble, every other one handed back. */
function personBubble(builtIns: SlotBuiltIns) {
  const HandedBack = builtIns.MessageEntry;
  return function PersonBubble(props: MessageEntryProps) {
    if (props.message.kind !== "user") return <HandedBack {...props} />;
    return <div className="person-bubble">{props.message.text}</div>;
  };
}

function thread(props: Partial<MessageThreadProps>): ReactNode {
  const conv = conversation({ id: "r1", message: "Total the invoices.", reply: "The total is 120." });
  return (
    <StigmerContext.Provider value={CLIENT}>
      <MessageThread turns={conv.turns} runs={conv.runs} {...props} />
    </StigmerContext.Provider>
  );
}

describe("a built-in handed back inside the thread", () => {
  it("draws on the thread's first frame, from the thread alone", () => {
    const markup = renderToStaticMarkup(thread({ slots: { MessageEntry: personBubble(threadOnly()) } }));

    expect(markup).toContain('<div class="person-bubble">Total the invoices.</div>');
    expect(markup).toContain('aria-label="AI response"');
    expect(markup).toContain("The total is 120.");
    // The same response the thread draws with no slot at all.
    const plain = renderToStaticMarkup(thread({}));
    const response = (html: string) => html.slice(html.indexOf('aria-label="AI response"'));
    expect(response(markup)).toBe(response(plain));
  });

  it("draws the chat entry's own built-in on the first frame too", () => {
    const markup = renderToStaticMarkup(thread({ slots: { MessageEntry: personBubble(ChatEntry as unknown as SlotBuiltIns) } }));
    expect(markup).toContain("The total is 120.");
  });

  it("draws on the virtualized path once its chunk is in, with no load of its own", async () => {
    render(thread({ virtualized: true, slots: { MessageEntry: personBubble(threadOnly()) } }));

    await vi.waitFor(() => expect(screen.getByTestId("virtuoso-scroller")).toBeTruthy());
    expect(screen.getByText("Total the invoices.").className).toBe("person-bubble");
    expect(screen.getByRole("article", { name: "AI response" }).textContent).toContain("The total is 120.");
  });

  it("draws in a host tool card, with the props it was given", () => {
    const builtIns = threadOnly();
    const onRetry = vi.fn();
    const Notice = builtIns.RunErrorNotice;
    function InvoiceCard(_: ToolCardProps) {
      return <Notice error="no such customer" retryMessage="Bill Acme again." onRetry={onRetry} />;
    }
    const conv = conversation({
      id: "r1",
      reply: "",
      extra: [use("r1", "inv", "create_invoice", { customer: "Acme" }, { mcpServerName: "billing" }), result("r1", "inv", "no such customer", { isError: true })],
    });
    render(
      <StigmerContext.Provider value={CLIENT}>
        <ToolCardsContext.Provider value={{ mcp__billing__create_invoice: InvoiceCard }}>
          <MessageThread turns={conv.turns} runs={conv.runs} />
        </ToolCardsContext.Provider>
      </StigmerContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(onRetry).toHaveBeenCalledWith("Bill Acme again.");
  });
});

describe("a built-in drawn outside any thread", () => {
  const ITEM: Todo = { id: "t1", content: "Send the invoice", status: "pending", createdAt: "", updatedAt: "" };

  it("draws once the built-ins' import lands, and at once on every later mount", async () => {
    let land: (builtIns: SlotBuiltIns) => void = () => undefined;
    const importBuiltIns = vi.fn(() => new Promise<SlotBuiltIns>((resolve) => (land = resolve)));
    const { TodoRow } = thinBuiltIns(builtInsLoader(importBuiltIns));

    const first = render(<ul><TodoRow item={ITEM} /></ul>);
    expect(first.container.textContent).toBe("");
    await act(async () => land(SLOT_BUILT_INS));
    expect(first.container.textContent).toContain("Send the invoice");
    first.unmount();

    const second = render(<ul><TodoRow item={ITEM} /></ul>);
    expect(second.container.textContent).toContain("Send the invoice");
    expect(importBuiltIns).toHaveBeenCalledTimes(1);
  });

  it("tries a failed import again on the next mount", async () => {
    const importBuiltIns = vi.fn<() => Promise<SlotBuiltIns>>().mockRejectedValueOnce(new Error("chunk failed")).mockResolvedValueOnce(SLOT_BUILT_INS);
    const { TodoRow } = thinBuiltIns(builtInsLoader(importBuiltIns));

    const first = render(<ul><TodoRow item={ITEM} /></ul>);
    await act(async () => undefined);
    expect(first.container.textContent).toBe("");
    first.unmount();

    const second = render(<ul><TodoRow item={ITEM} /></ul>);
    await vi.waitFor(() => expect(second.container.textContent).toContain("Send the invoice"));
    expect(importBuiltIns).toHaveBeenCalledTimes(2);
  });

  it("imports the real built-ins for the chat entry's own", async () => {
    render(<ul><ChatEntry.TodoRow item={ITEM} /></ul>);
    expect(await screen.findByText("Send the invoice")).toBeTruthy();
  });
});
