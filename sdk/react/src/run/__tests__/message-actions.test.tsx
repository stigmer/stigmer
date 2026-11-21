// Pins a host's own message actions (`messageActions` on MessageThread):
// the thread asks for them with what it knows about each message (its log
// id, whose it is, whether it is its turn's final answer, its run and
// session) for a person's message in the log and every settled agent
// message, narration inside "How it got there" included, and never for
// thinking, a plan document, a message still streaming, or a bubble not in
// the log (sending); the kit draws the first two with an icon as named
// buttons, the rest in one "More actions" menu, honouring `disabled`; a
// person's bubble draws them after Copy; a `MessageEntry` slot receives the
// same data; and a frame that changes nothing asks for nothing again.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memo } from "react";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { MessageThread, ThreadItemRenderer, type MessageThreadSlots } from "../MessageThread";
import { MessageEntry, type MessageEntryProps } from "../MessageEntry";
import { ThreadPresentationContext } from "../ThreadPresentationContext";
import type { MessageAction, MessageInfo } from "../message-actions";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { conversation, runOf, said, status, thought, turnsOf, use, result, user } from "./__fixtures__/thread-events";

afterEach(cleanup);

const R = "run_m";

/** A finished turn: narration, a step, then its answer. */
const finishedTurn = turnsOf(
  user(R, "Bill Acme"),
  status(R, "running"),
  ...thought(R, 0, "Which customer?"),
  said(R, 0, "Let me find the customer."),
  use(R, "c1", "read_file", { path: "customers.csv" }),
  result(R, "c1", "Acme"),
  said(R, 1, "The invoice is ready."),
  status(R, "completed"),
);

function icon(name: string) {
  return <span aria-hidden="true">{name}</span>;
}

describe("messageActions", () => {
  it("tells the host each message's id, role, final answer, run and session", () => {
    const seen: MessageInfo[] = [];
    const actionsFor = (message: MessageInfo): readonly MessageAction[] => {
      seen.push(message);
      return [];
    };
    render(<MessageThread turns={finishedTurn} sessionId="session_1" messageActions={actionsFor} />);
    fireEvent.click(screen.getByRole("button", { name: /How it got there/ }));

    const byId = new Map(seen.map((info) => [info.id, info]));
    expect(byId.get(`${R}.user`) ?? [...byId.values()].find((info) => info.role === "user")).toMatchObject({ role: "user", text: "Bill Acme", isFinalAnswer: false, sessionId: "session_1", runId: R });
    expect(byId.get(`${R}.root.m1`)).toEqual({ id: `${R}.root.m1`, role: "agent", text: "The invoice is ready.", isFinalAnswer: true, sessionId: "session_1", runId: R });
    expect(byId.get(`${R}.root.m0`)).toMatchObject({ role: "agent", isFinalAnswer: false });
    // Thinking takes none.
    expect([...byId.values()].filter((info) => info.text === "Which customer?")).toEqual([]);
  });

  it("draws two acts with an icon as named buttons and the rest in one More actions menu", async () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    const actions: readonly MessageAction[] = [
      { id: "open", label: "Open in Billing", icon: icon("↗"), onAction: onOpen },
      { id: "paid", label: "Mark as paid", icon: icon("✓"), onAction: () => {} },
      { id: "send", label: "Send to customer", icon: icon("✉"), onAction: () => {} },
      { id: "delete", label: "Delete draft", variant: "destructive", onAction: onDelete },
      { id: "dup", label: "Duplicate", disabled: true, onAction: () => {} },
    ];
    render(<MessageThread turns={finishedTurn} messageActions={(m) => (m.isFinalAnswer ? actions : [])} />);

    fireEvent.click(screen.getByRole("button", { name: "Open in Billing" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Mark as paid" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send to customer" })).toBeNull();

    await openMenu(screen.getByRole("button", { name: "More actions" }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["✉Send to customer", "Delete draft", "Duplicate"]);
    expect(items[2]!.getAttribute("aria-disabled")).toBe("true");
    await userEvent.setup().click(items[1]!);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("draws a person's acts in the bubble's cluster, after Copy", () => {
    render(<MessageThread turns={finishedTurn} messageActions={(m) => (m.role === "user" ? [{ id: "save", label: "Save prompt", icon: icon("★"), onAction: () => {} }] : [])} />);
    const bubble = screen.getByRole("article", { name: "User message" });
    const names = [...bubble.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual(["Copy message", "Save prompt"]);
  });

  it("asks nothing for a message still streaming", () => {
    const actionsFor = vi.fn(() => []);
    render(
      <ThreadPresentationContext.Provider value={{ messageActions: actionsFor }}>
        <ThreadItemRenderer item={{ kind: "message", key: "m", message: { kind: "message", id: "m", text: "Writing", live: true, processedAt: "2026-11-21T10:00:00.000Z" }, runId: R, takesActions: true }} />
      </ThreadPresentationContext.Provider>,
    );
    expect(actionsFor).not.toHaveBeenCalled();
  });

  it("asks nothing for a bubble still sending, nor for a plan document", () => {
    const actionsFor = vi.fn((_: MessageInfo) => []);
    const plan = conversation({ id: "p", mode: InteractionMode.PLAN, reply: "# The plan\n\nStep one." });
    render(<MessageThread turns={plan.turns} runs={plan.runs} pendingUserMessage="And another" messageActions={actionsFor} />);
    const texts = actionsFor.mock.calls.map(([info]) => info.text);
    expect(texts).not.toContain("And another");
    expect(texts.some((text) => text.startsWith("# The plan"))).toBe(false);
    expect(texts).toContain("Hello");
  });

  it("hands a MessageEntry slot the message's info and the acts as data", () => {
    const received: MessageEntryProps[] = [];
    const Entry = memo(function Entry(props: MessageEntryProps) {
      received.push(props);
      return <MessageEntry {...props} />;
    });
    const slots: MessageThreadSlots = { MessageEntry: Entry };
    const act: MessageAction = { id: "open", label: "Open in Billing", onAction: () => {} };
    render(<MessageThread turns={finishedTurn} sessionId="s" slots={slots} messageActions={(m) => (m.isFinalAnswer ? [act] : [])} />);

    const answer = received.find((props) => props.message.id === `${R}.root.m1`);
    expect(answer?.messageInfo).toMatchObject({ role: "agent", isFinalAnswer: true, sessionId: "s", runId: R });
    expect(answer?.messageActions).toEqual([act]);
    // The wrapped built-in draws it.
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
  });

  it("asks again only when the host's function changes, not on a frame that changes no message", async () => {
    const actionsFor = vi.fn((_: MessageInfo) => [] as readonly MessageAction[]);
    const runs = [runOf(R, { spec: { message: "Bill Acme" } })];
    const { rerender } = render(<MessageThread turns={finishedTurn} runs={runs} messageActions={actionsFor} />);
    const first = actionsFor.mock.calls.length;
    expect(first).toBeGreaterThan(0);

    rerender(<MessageThread turns={[...finishedTurn]} runs={[...runs]} messageActions={actionsFor} />);
    expect(actionsFor.mock.calls.length).toBe(first);

    const next = vi.fn((_: MessageInfo) => [] as readonly MessageAction[]);
    rerender(<MessageThread turns={finishedTurn} runs={runs} messageActions={next} />);
    await waitFor(() => expect(next.mock.calls.length).toBe(first));
  });
});
