// The story's scenes: the job every picture of Stigmer at work tells
// (brand/job-story.ts), drawn by the real components, so the site can show
// a moment of it as a test-drawn picture rather than a mock-up.
//
// `asksFirstScene` is the moment the agent asks: Northwind Books' ledger
// agent has read the quarter's ledger, found a miscoded expense, and stops
// before `post_adjustment`, the tool the `ledger` server marks destructive
// (docs/concepts/approval-flows.mdx), showing the account, the amount and the
// reason. It is drawn as the customer sees it inside the integrator's
// product: the end user's session view, whose approval card they answer and
// whose console pickers they never see. The session is built from the kit's
// public samples, numbered from 1 and stamped at the samples' fixed instant,
// so the drawing is the same on every run.
//
// `inProductScene` is the same moment inside the product itself: the
// integrator's ledger screen for its customer Northwind Books, with
// Stigmer's chat panel docked beside it (`<AgentChat variant="panel">`, as
// the embed guide puts it in an app), headed by the story's agent. The
// host page lists the quarter's entries the agent read, so the row it
// names is a row the visitor can find; the host marks nothing, since it
// does not know what the agent found. It is drawn in the kit's tokens and
// names no product of its own: the workspace switcher carries the
// customer, as a product serving many customers shows the one it is in.
import type { ReactElement } from "react";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { AgentChat } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { JOB } from "../../../../brand/job-story.ts";
import { dockedBeside } from "./agent-chat.tsx";
import type { Drawing } from "./drawing.ts";
import { sessionDrawing, sessionRoutes, type SessionReplay } from "./session.tsx";

/** One entry of the quarter's ledger. */
interface Entry {
  readonly date: string;
  readonly account: string;
  readonly amount: string;
  readonly memo: string;
}

/** The quarter's entries, in date order: one expense, the Figma plan, coded to the wrong account. */
const ENTRIES: readonly Entry[] = [
  { date: "2026-07-01", account: "4000 Book sales", amount: "-8920.40", memo: "June card settlements" },
  { date: "2026-07-03", account: "6100 Office supplies", amount: "1240.00", memo: "Figma annual plan" },
  { date: "2026-07-08", account: "6200 Rent", amount: "4800.00", memo: "July rent" },
  { date: "2026-07-10", account: "5000 Cost of goods sold", amount: "3615.40", memo: "Ingram restock order" },
  { date: "2026-07-12", account: "6300 Utilities", amount: "312.18", memo: "Electricity for June" },
  { date: "2026-07-15", account: "6410 Software subscriptions", amount: "96.00", memo: "GitHub Team" },
  { date: "2026-07-21", account: "6500 Shipping", amount: "428.75", memo: "Postage for July orders" },
  { date: "2026-07-24", account: "6100 Office supplies", amount: "86.20", memo: "Printer paper and toner" },
  { date: "2026-07-31", account: "6600 Payroll", amount: "18420.00", memo: "July payroll" },
  { date: "2026-08-01", account: "4000 Book sales", amount: "-9412.85", memo: "July card settlements" },
  { date: "2026-08-04", account: "6410 Software subscriptions", amount: "39.00", memo: "Shopify Basic" },
  { date: "2026-08-08", account: "6200 Rent", amount: "4800.00", memo: "August rent" },
  { date: "2026-08-12", account: "5000 Cost of goods sold", amount: "2980.10", memo: "Ingram restock order" },
  { date: "2026-08-14", account: "6300 Utilities", amount: "298.64", memo: "Electricity for July" },
  { date: "2026-08-21", account: "6500 Shipping", amount: "391.20", memo: "Postage for August orders" },
  { date: "2026-08-31", account: "6600 Payroll", amount: "18420.00", memo: "August payroll" },
  { date: "2026-09-01", account: "4000 Book sales", amount: "-10106.30", memo: "August card settlements" },
  { date: "2026-09-08", account: "6200 Rent", amount: "4800.00", memo: "September rent" },
];

/** The quarter's ledger as the agent read it (`ledger.csv`): the entries above. */
const LEDGER_ROWS = [
  "date,account,amount,memo",
  ...ENTRIES.map((entry) => [entry.date, entry.account, entry.amount, entry.memo].join(",")),
].join("\n");

/** The adjustment the agent wants to post: the account, the amount and the reason. */
const ADJUSTMENT = {
  account: "6410 Software subscriptions",
  amount: "1240.00",
  reason: "Figma annual plan of 2026-07-03 was coded to 6100 Office supplies",
} as const;

/** The events in log order, with their places (`seq`) numbered 1.., as the server keeps them. */
function numbered(events: readonly SessionEvent[]): SessionEvent[] {
  return events.map((event, index) => ({ ...event, seq: BigInt(index + 1) }));
}

/** Northwind's session, waiting for a yes before the adjustment is posted. */
export function asksFirstReplay(): SessionReplay {
  const session = samples.session({ subject: JOB.message.replace(/\.$/, "") });
  const toolUseId = `${samples.run().metadata!.id}.tc-${JOB.tool}`;
  const events = numbered([
    ...samples.turnEvents({
      message: JOB.message,
      phase: "running",
      tools: [{ name: "read_file", input: { path: JOB.ledger }, result: LEDGER_ROWS }],
      reply:
        "The ledger balances, but the Figma annual plan on 3 July is coded to office supplies. It belongs in software subscriptions, so I'll move it.",
    }),
    samples.toolUseEvent(JOB.tool, ADJUSTMENT, { id: toolUseId, evaluatedPermission: "ask", mcpServerName: "ledger" }),
    samples.permissionAskedEvent(toolUseId, { argsPreview: JSON.stringify(ADJUSTMENT) }),
    samples.runStatusEvent("waiting"),
  ]);
  return {
    session,
    events,
    runs: [samples.run({ sessionId: session.metadata!.id, phase: RunPhase.RUN_WAITING_FOR_APPROVAL, message: JOB.message })],
    files: [],
    liveness: undefined,
    loadError: null,
  };
}

/** The moment the ledger agent asks before it posts an adjustment, as Northwind's person sees it. */
export function asksFirstScene(): Drawing {
  return sessionDrawing(asksFirstReplay(), { audience: "endUser" });
}

/** The agent in the panel: the story's ledger agent, by the name the docs give it. */
const STORY_AGENT = samples.agent({ name: JOB.agent });

/** An amount as a ledger shows it: grouped thousands, two decimals, credits in brackets. */
function money(amount: string): string {
  const value = Number(amount);
  const shown = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `(${shown})` : shown;
}

/** The host product's sections, its ledger the one open. */
const HOST_NAV = ["Overview", "Ledger", "Invoices", "Bills", "Reports"] as const;

const CELL = { padding: "9px 16px", borderBottom: "1px solid var(--stgm-border)", whiteSpace: "nowrap" } as const;

/** The integrator's ledger screen for Northwind Books: its own bar, its sections, and the quarter's entries. */
function hostLedgerPage(): ReactElement {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--stgm-background)" }}>
      <header
        style={{
          height: 52,
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px",
          borderBottom: "1px solid var(--stgm-border)",
        }}
      >
        <button
          type="button"
          aria-haspopup="menu"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 32,
            padding: "0 10px 0 6px",
            border: "1px solid var(--stgm-border)",
            borderRadius: "var(--stgm-radius)",
            background: "var(--stgm-card)",
            color: "var(--stgm-foreground)",
            font: "inherit",
            fontSize: "var(--stgm-text-sm)",
            fontWeight: 500,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "grid",
              placeItems: "center",
              width: 20,
              height: 20,
              borderRadius: 4,
              background: "var(--stgm-primary)",
              color: "var(--stgm-primary-foreground)",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            N
          </span>
          {JOB.customer}
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 4.5 6 7.5 9 4.5" />
          </svg>
        </button>
        <span style={{ color: "var(--stgm-muted-foreground)", fontSize: "var(--stgm-text-sm)" }}>Q3 2026</span>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <nav
          aria-label="Sections"
          style={{
            width: 168,
            flex: "none",
            padding: 12,
            borderRight: "1px solid var(--stgm-sidebar-border)",
            background: "var(--stgm-sidebar)",
          }}
        >
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
            {HOST_NAV.map((section) => {
              const open = section === "Ledger";
              return (
                <li key={section}>
                  <a
                    href={`#${section.toLowerCase()}`}
                    aria-current={open ? "page" : undefined}
                    onClick={(event) => event.preventDefault()}
                    style={{
                      display: "block",
                      padding: "6px 10px",
                      borderRadius: "var(--stgm-radius)",
                      fontSize: "var(--stgm-text-sm)",
                      textDecoration: "none",
                      color: open ? "var(--stgm-sidebar-accent-foreground)" : "var(--stgm-sidebar-foreground)",
                      background: open ? "var(--stgm-sidebar-accent)" : "transparent",
                      fontWeight: open ? 500 : 400,
                    }}
                  >
                    {section}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <main style={{ flex: 1, minWidth: 0, overflow: "hidden", padding: "20px 24px" }}>
          <h1 style={{ margin: 0, fontSize: "var(--stgm-text-xl)", fontWeight: 600, color: "var(--stgm-foreground)" }}>Ledger entries</h1>
          <p style={{ margin: "4px 0 16px", fontSize: "var(--stgm-text-sm)", color: "var(--stgm-muted-foreground)" }}>
            July to September 2026 · {ENTRIES.length} entries
          </p>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "var(--stgm-text-sm)",
              color: "var(--stgm-foreground)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <thead>
              <tr style={{ color: "var(--stgm-muted-foreground)", textAlign: "left" }}>
                <th scope="col" style={{ ...CELL, fontWeight: 500 }}>Date</th>
                <th scope="col" style={{ ...CELL, fontWeight: 500 }}>Account</th>
                <th scope="col" style={{ ...CELL, fontWeight: 500 }}>Memo</th>
                <th scope="col" style={{ ...CELL, fontWeight: 500, textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {ENTRIES.map((entry) => (
                <tr key={`${entry.date}-${entry.memo}`}>
                  <td style={{ ...CELL, color: "var(--stgm-muted-foreground)" }}>{entry.date}</td>
                  <td style={CELL}>{entry.account}</td>
                  <td style={CELL}>{entry.memo}</td>
                  <td style={{ ...CELL, textAlign: "right" }}>{money(entry.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      </div>
    </div>
  );
}

/** The moment the ledger agent asks, in Stigmer's panel docked beside the integrator's ledger screen. */
export function inProductScene(): Drawing {
  const replay = asksFirstReplay();
  const session = replay.session!;
  const agent = STORY_AGENT.metadata!;
  return {
    inOrganization: true,
    routes: sessionRoutes(replay, { agent: STORY_AGENT }),
    render: () => (
      <div style={{ borderRadius: 12, overflow: "hidden", boxShadow: "0 0 0 1px var(--stgm-border)" }}>
        {dockedBeside(
          hostLedgerPage(),
          <AgentChat
            agent={`${agent.org}/${agent.slug}`}
            org={session.metadata!.org}
            variant="panel"
            defaultOpen
            defaultSessionId={session.metadata!.id}
          />,
        )}
      </div>
    ),
  };
}
