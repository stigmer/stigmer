// A host's own tool card and message actions in a real Chromium, light and
// dark: a finished turn with an invoice card above its fold and the answer's
// acts passes axe; the acts are reached by keyboard alone (Tab to each
// named icon, Tab to More actions, Enter opens it, the arrows walk its
// items, Escape closes it back to its trigger); no key is taken from the
// page (every keydown reaches the page's own listener, none prevented); and
// the quiet row stays shown while its menu is open, though the menu's
// portal takes the focus out of the row. Under a host whose every slot and
// card throws (and whose message actions throw for a person's message), a
// thread waiting on two asks still passes axe and is still walked by
// keyboard alone: Tab reaches both approvals' Allow and the answer's More
// actions, with no key taken.

import { describe, it, expect, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { auditA11y, COLOR_MODES, renderAudited, resetAudit } from "../../../__tests__/helpers/a11y-audit";
import { MessageThread, type MessageThreadSlots } from "../../MessageThread";
import { ToolCardsContext, type ToolCardProps, type ToolCards } from "../../tool-cards-context";
import type { MessageAction, MessageInfo } from "../../message-actions";
import { asked, result, said, status, turnsOf, use, user } from "../__fixtures__/thread-events";

afterEach(resetAudit);

const R = "run_h";
const TURNS = turnsOf(
  user(R, "Bill Acme for July"),
  status(R, "running"),
  use(R, "c1", "create_invoice", { customer: "Acme", amount: 1200 }, { mcpServerName: "billing" }),
  result(R, "c1", "INV-2041"),
  said(R, 0, "The July invoice for Acme is ready as a draft."),
  status(R, "completed"),
);

function InvoiceCard({ call }: ToolCardProps) {
  return (
    <article aria-label="Invoice INV-2041" style={{ border: "1px solid var(--stgm-border)", borderRadius: 8, padding: 12 }}>
      <p style={{ margin: 0 }}>Acme · $1,200.00 · {call.state === "completed" ? "Draft" : "Creating"}</p>
    </article>
  );
}
const CARDS: ToolCards = { mcp__billing__create_invoice: InvoiceCard };

function glyph(text: string) {
  return <span aria-hidden="true">{text}</span>;
}

const ACTS: readonly MessageAction[] = [
  { id: "open", label: "Open in Billing", icon: glyph("↗"), onAction: () => {} },
  { id: "paid", label: "Mark as paid", icon: glyph("✓"), onAction: () => {} },
  { id: "send", label: "Send to customer", onAction: () => {} },
  { id: "delete", label: "Delete draft", variant: "destructive", onAction: () => {} },
];
const actionsFor = (message: MessageInfo): readonly MessageAction[] => (message.isFinalAnswer ? ACTS : []);

function renderThread(mode: "light" | "dark"): HTMLElement {
  return renderAudited(
    <ToolCardsContext.Provider value={CARDS}>
      <input aria-label="Search invoices" />
      <MessageThread turns={TURNS} sessionId="ses_1" messageActions={actionsFor} />
    </ToolCardsContext.Provider>,
    mode,
  );
}

describe("a host's tool card and message actions", () => {
  it.each(COLOR_MODES)("pass the audit (%s)", async (mode) => {
    const container = renderThread(mode);
    await screen.findByRole("article", { name: "Invoice INV-2041" });
    await auditA11y(container, `host card and acts · ${mode}`);
  });

  it("are reached by keyboard alone, and take no key from the page", async () => {
    const prevented: string[] = [];
    const seen: string[] = [];
    const listener = (event: KeyboardEvent) => {
      seen.push(event.key);
      // Read after the kit's own handlers ran.
      queueMicrotask(() => {
        if (event.defaultPrevented) prevented.push(event.key);
      });
    };
    document.addEventListener("keydown", listener);
    try {
      renderThread("light");
      // The answer's Copy, then its scores (none here), then the host's acts.
      screen.getAllByRole("button", { name: "Copy message" }).at(-1)!.focus();
      await userEvent.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open in Billing" }));
      await userEvent.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mark as paid" }));
      await userEvent.tab();
      const more = screen.getByRole("button", { name: "More actions" });
      expect(document.activeElement).toBe(more);

      await userEvent.keyboard("{Enter}");
      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual(["Send to customer", "Delete draft"]);
      await userEvent.keyboard("{ArrowDown}");
      await waitFor(() => expect(document.activeElement?.textContent).toBe("Delete draft"));

      // The row stays shown while its menu holds the focus.
      const row = more.parentElement!;
      expect(getComputedStyle(row).opacity).toBe("1");

      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryAllByRole("menuitem")).toHaveLength(0));
      expect(document.activeElement).toBe(more);

      // A key pressed on an act, or in the page's own field, reaches the
      // page untouched: the acts bind no key.
      screen.getByRole("button", { name: "Open in Billing" }).focus();
      await userEvent.keyboard("k");
      await userEvent.click(screen.getByRole("textbox", { name: "Search invoices" }));
      await userEvent.keyboard("j{Escape}");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(seen).toEqual(expect.arrayContaining(["k", "j", "Escape"]));
      expect(prevented.filter((key) => key === "k" || key === "j" || key === "Tab")).toEqual([]);
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });
});

function broke(part: string): never {
  throw new Error(`host part broke: ${part}`);
}

const THROWING_SLOTS: Required<MessageThreadSlots> = {
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
};

const L = "run_l";
/** The invoiced turn, then a turn waiting on a command in its row and a to-do write with no row. */
const WAITING = [
  ...TURNS,
  ...turnsOf(
    user(L, "Clean the build"),
    status(L, "running"),
    use(L, "sh", "Bash", { command: "rm -rf build" }, { ask: true }),
    asked(L, "sh"),
    use(L, "gate", "write_todos", {}, { ask: true }),
    asked(L, "gate"),
    status(L, "waiting"),
  ),
];

const throwingActions = (message: MessageInfo): readonly MessageAction[] => (message.role === "user" ? broke("messageActions") : actionsFor(message));

function renderHostile(mode: "light" | "dark"): HTMLElement {
  return renderAudited(
    <ToolCardsContext.Provider value={{ mcp__billing__create_invoice: () => broke("tool card") }}>
      <input aria-label="Search invoices" />
      <MessageThread turns={WAITING} sessionId="ses_1" slots={THROWING_SLOTS} messageActions={throwingActions} onAnswerToolUse={() => {}} />
    </ToolCardsContext.Provider>,
    mode,
  );
}

describe("a host whose every part throws", () => {
  it.each(COLOR_MODES)("leaves a thread that passes the audit (%s)", async (mode) => {
    const container = renderHostile(mode);
    await screen.findByRole("alert", { name: "Approval required for write_todos" });
    await auditA11y(container, `hostile host · ${mode}`);
  });

  it("leaves both approvals and the answer's acts reached by keyboard alone, taking no key", async () => {
    const prevented: string[] = [];
    const listener = (event: KeyboardEvent) => {
      queueMicrotask(() => {
        if (event.defaultPrevented) prevented.push(event.key);
      });
    };
    document.addEventListener("keydown", listener);
    try {
      renderHostile("light");
      const reached = new Set<string>();
      screen.getByRole("textbox", { name: "Search invoices" }).focus();
      for (let i = 0; i < 40; i += 1) {
        await userEvent.tab();
        const active = document.activeElement as HTMLElement | null;
        const name = active?.getAttribute("aria-label") ?? active?.textContent ?? "";
        const approval = active?.closest('[role="alert"]')?.getAttribute("aria-label") ?? "";
        reached.add(approval === "" ? name : `${approval}: ${name}`);
      }
      expect([...reached]).toEqual(
        expect.arrayContaining(["Approval required for Bash: Allow", "Approval required for write_todos: Allow", "More actions"]),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(prevented.filter((key) => key === "Tab")).toEqual([]);
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });
});
