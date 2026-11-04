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
//
// The homepage's first screen steps through one moment per hard part, and
// the four beside the ask are drawn here too, each true of the product as it
// is:
//
// - `ownComputerScene`: the same session after the person's yes. The agent
//   posted the adjustment, wrote its report in its outputs folder, and the
//   panel hands the report back as a File (the ledger agent may not run
//   commands, but it writes files: examples/variance-report).
// - `hoursScene`: a second Northwind job, the year's bank statements
//   reconciled month by month, two hours in, beside the year's ledger. The
//   working line's time is measured from the turn's first event, stamped
//   back from the scene's clock.
// - `wallsScene`: two customers of one product, Northwind and a bakery, each
//   asking the same agent about its own books. Each panel's conversation
//   lives in its customer's own organization (`<AgentChat org>`), which the
//   panel does not draw, so story-data.ts holds the wiring for a unit case.
// - `keysScene`: the integrator's own Stigmer console, Models & providers,
//   with Anthropic and OpenAI connected on the organization's own keys. The integrator
//   is named here because the console names the organization it signs into.
//
// The walls and keys scenes lay out for their viewport, so one scene gives
// both the wide picture and the phone's.
import type { ReactElement } from "react";
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { ProviderKey } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import { ProviderAvailability } from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { AgentChat, ModelsHub } from "@stigmer/react-sdk";
import { samples, sampleInstant } from "@stigmer/react-sdk/test";
import { JOB, OTHERS } from "../../../../brand/job-story.ts";
import { ORGANIZATION, ownAnthropicKey, readiness } from "../fixtures.ts";
import { dockedBeside } from "./agent-chat.tsx";
import type { Drawing } from "./drawing.ts";
import { modelsRoutes } from "./models.tsx";
import { sessionDrawing, sessionRoutes, type SessionReplay } from "./session.tsx";
import {
  ENTRIES,
  filedIn,
  ledgerCsv,
  numbered,
  STORY_AGENT,
  wallsPanels,
  YEAR_ENTRIES,
  YEAR_ENTRY_COUNT,
  type CustomerPanel,
  type Entry,
} from "./story-data.ts";

/** The quarter's ledger as the agent read it (`ledger.csv`): the entries above. */
const LEDGER_ROWS = ledgerCsv(ENTRIES);

/** The adjustment the agent wants to post: the account, the amount and the reason. */
const ADJUSTMENT = {
  account: "6410 Software subscriptions",
  amount: "1240.00",
  reason: "Figma annual plan of 2026-07-03 was coded to 6100 Office supplies",
} as const;

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

/** An amount as a ledger shows it: grouped thousands, two decimals, credits in brackets. */
function money(amount: string): string {
  const value = Number(amount);
  const shown = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `(${shown})` : shown;
}

/** The host product's sections, its ledger the one open. */
const HOST_NAV = ["Overview", "Ledger", "Invoices", "Bills", "Reports"] as const;

const CELL = { padding: "9px 16px", borderBottom: "1px solid var(--stgm-border)", whiteSpace: "nowrap" } as const;

/** What the host product's ledger screen shows: whose books, which period, and its entries. */
interface LedgerView {
  /** The customer, as the workspace switcher names it. */
  readonly customer: string;
  /** The period in the bar beside the switcher. */
  readonly period: string;
  /** The span the page's subtitle names. */
  readonly span: string;
  readonly entries: readonly Entry[];
  /** How many entries the span holds, when the page lists only the first of them. */
  readonly count?: number;
}

/** Northwind's quarter, the page the ask and the report are drawn beside. */
const QUARTER: LedgerView = { customer: JOB.customer, period: "Q3 2026", span: "July to September 2026", entries: ENTRIES };

/** The host product's bar: the workspace switcher naming the customer, and the period beside it. */
function hostBar(customer: string, period: string): ReactElement {
  return (
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
          {customer.charAt(0)}
        </span>
        {customer}
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>
      <span style={{ color: "var(--stgm-muted-foreground)", fontSize: "var(--stgm-text-sm)" }}>{period}</span>
    </header>
  );
}

/** The integrator's ledger screen for one customer: its own bar, its sections, and the period's entries. */
function hostLedgerPage({ customer, period, span, entries, count = entries.length }: LedgerView): ReactElement {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--stgm-background)" }}>
      {hostBar(customer, period)}
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
            {span} · {count} entries
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
              {entries.map((entry) => (
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

/** A product window: the frame every story moment inside a product is drawn in. */
export function productWindow(content: ReactElement): ReactElement {
  return <div style={{ borderRadius: 12, overflow: "hidden", boxShadow: "0 0 0 1px var(--stgm-border)" }}>{content}</div>;
}

/** `replay` in Stigmer's panel, docked beside the integrator's ledger screen as `view` shows it. */
function inProductDrawing(replay: SessionReplay, view: LedgerView): Drawing {
  const session = replay.session!;
  const agent = STORY_AGENT.metadata!;
  return {
    inOrganization: true,
    routes: sessionRoutes(replay, { agent: STORY_AGENT }),
    render: () =>
      productWindow(
        dockedBeside(
          hostLedgerPage(view),
          <AgentChat
            agent={`${agent.org}/${agent.slug}`}
            org={session.metadata!.org}
            variant="panel"
            defaultOpen
            defaultSessionId={session.metadata!.id}
          />,
        ),
      ),
  };
}

/** The moment the ledger agent asks, in Stigmer's panel docked beside the integrator's ledger screen. */
export function inProductScene(): Drawing {
  return inProductDrawing(asksFirstReplay(), QUARTER);
}

/** A person's answer to the tool call `toolUseId`; the samples have no builder for it. */
function confirmationEvent(toolUseId: string, result: "allow" | "deny", processedAt: string): SessionEvent {
  const ask = samples.permissionAskedEvent(toolUseId);
  return create(SessionEventSchema, {
    sessionId: ask.sessionId,
    runId: ask.runId,
    threadId: "",
    event: { case: "userToolConfirmation", value: { id: `${toolUseId}.confirm`, toolUseId, result, denyMessage: "", processedAt } },
  });
}

/**
 * Northwind's session after the person's yes: the ask's own events, then the
 * yes, the adjustment posted, the report written in the agent's outputs
 * folder, its reply and the turn's end, with the report handed back as a
 * File. The ask's events are `asksFirstReplay`'s, unchanged.
 */
export function ownComputerReplay(): SessionReplay {
  const asked = asksFirstReplay();
  const runId = samples.run().metadata!.id;
  const toolUseId = `${runId}.tc-${JOB.tool}`;
  const write = samples.toolUseEvent("write_file", { path: `/.stigmer/outputs/${JOB.report}` }, { processedAt: sampleInstant(38_000) });
  const events = numbered([
    ...asked.events,
    confirmationEvent(toolUseId, "allow", sampleInstant(30_000)),
    samples.runStatusEvent("running", { id: `${runId}.status.running.after-yes`, processedAt: sampleInstant(30_000) }),
    samples.toolResultEvent(toolUseId, "Posted adjustment ADJ-0412: 1,240.00 from 6100 Office supplies to 6410 Software subscriptions.", {
      mcp: true,
      processedAt: sampleInstant(31_500),
    }),
    write,
    samples.toolResultEvent(write.event.value!.id, "Wrote 2.4 KB", { processedAt: sampleInstant(38_300) }),
    samples.agentMessageEvent(
      `Posted: the Figma annual plan is now in 6410 Software subscriptions. The variance report has the quarter by account and the correction, in ${JOB.report}.`,
      { id: `${runId}.root.m1`, processedAt: sampleInstant(46_000) },
    ),
    samples.runStatusEvent("completed", { processedAt: sampleInstant(47_000) }),
  ]);
  return {
    ...asked,
    events,
    runs: [samples.run({ sessionId: asked.session!.metadata!.id, phase: RunPhase.RUN_COMPLETED, message: JOB.message })],
    files: [samples.outputFile(JOB.report, { mimeType: "text/markdown", sizeBytes: 2_410n })],
  };
}

/** The report handed back: the finished turn after the yes, beside Northwind's quarter. */
export function ownComputerScene(): Drawing {
  return inProductDrawing(ownComputerReplay(), QUARTER);
}

/** The scene's clock, as `tests/draw.ts` sets it: the scenario catalogue's, 90 s after the samples' instant. */
const CLOCK_MS = 90_000;

/** How long the year's reconciliation has run at the scene's clock: 2 h 14 min, and some seconds the line drops. */
const HOURS_ELAPSED_MS = (2 * 60 + 14) * 60_000 + 25_000;

/** The months of the year so far, in order. */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September"] as const;

/** How many of the months are reconciled when the picture is taken; the next one is in progress. */
const MONTHS_DONE = 6;

/** The year's job: the person's message. */
const HOURS_MESSAGE = "Reconcile this year's bank statements against the ledger, month by month.";

/**
 * Northwind's second session: a reconciliation of the year to date, two
 * hours in. The agent read the ledger, then each month's bank statement in
 * turn, writing that month's reconciliation; six are done and July's
 * statement is being read. Every event is stamped back from the scene's
 * clock, so the working line reads 2 h 14 min.
 */
export function hoursReplay(): SessionReplay {
  const sessionId = "ses_00000000000000000000000031";
  const runId = "run_00000000000000000000000031";
  const start = CLOCK_MS - HOURS_ELAPSED_MS;
  const at = (ms: number) => sampleInstant(start + ms);
  const call = (name: string, input: JsonObject, atMs: number, result?: string, id?: string): SessionEvent[] => {
    const use = samples.toolUseEvent(name, input, { runId, id: id ?? `${runId}.tc-${name}`, processedAt: at(atMs) });
    if (result === undefined) return [use];
    return [use, samples.toolResultEvent(use.event.value!.id, result, { runId, processedAt: at(atMs + 1_400) })];
  };
  const todos = (done: number) =>
    MONTHS.map((month, index) => ({
      content: `Reconcile ${month}`,
      status: index < done ? "completed" : index === done ? "in_progress" : "pending",
    }));
  const monthMs = 21 * 60_000;
  const months = MONTHS.slice(0, MONTHS_DONE).map((month, index) => {
    const name = month.toLowerCase();
    const begins = 90_000 + index * monthMs;
    return [
      ...call("read_file", { path: `statements/${name}-statement.csv` }, begins, `date,description,amount\n2026-${String(index + 1).padStart(2, "0")}-01,…`, `${runId}.tc-read-${name}`),
      ...call(
        "write_file",
        { path: `/.stigmer/outputs/reconciliation-${name}.md`, content: `# ${month} reconciliation\n\nThe statement and the ledger agree.\n` },
        begins + monthMs - 120_000,
        "Wrote 1.9 KB",
        `${runId}.tc-write-${name}`,
      ),
    ];
  });
  const july = MONTHS[MONTHS_DONE].toLowerCase();
  const session = samples.session({ id: sessionId, subject: "Reconcile this year's bank statements" });
  const events = numbered(
    filedIn(sessionId, [
      samples.userMessageEvent(HOURS_MESSAGE, { runId, processedAt: at(0) }),
      samples.runStatusEvent("running", { runId, processedAt: at(0) }),
      ...call("write_todos", { todos: todos(0) }, 4_000, "Updated the to-do list", `${runId}.tc-todos-0`),
      ...call("read_file", { path: "ledger-2026.csv" }, 20_000, ledgerCsv(YEAR_ENTRIES), `${runId}.tc-read-ledger`),
      ...months.slice(0, 5).flat(),
      samples.agentMessageEvent(
        "May reconciles once two card terminal fees are counted: the statement has them and the ledger does not. Both are listed in reconciliation-may.md.",
        { runId, id: `${runId}.root.m-may`, processedAt: at(90_000 + 5 * monthMs - 60_000) },
      ),
      ...months.slice(5).flat(),
      ...call("write_todos", { todos: todos(MONTHS_DONE) }, HOURS_ELAPSED_MS - 40_000, "Updated the to-do list", `${runId}.tc-todos-${MONTHS_DONE}`),
      ...call("read_file", { path: `statements/${july}-statement.csv` }, HOURS_ELAPSED_MS - 30_000, undefined, `${runId}.tc-read-${july}`),
    ]),
  );
  return {
    session,
    events,
    runs: [samples.run({ id: runId, sessionId, phase: RunPhase.RUN_IN_PROGRESS, message: HOURS_MESSAGE })],
    files: [],
    liveness: undefined,
    loadError: null,
  };
}

/** Northwind's year so far, as its ledger page opens on it. */
const YEAR: LedgerView = {
  customer: JOB.customer,
  period: "2026",
  span: "January to September 2026",
  entries: YEAR_ENTRIES,
  count: YEAR_ENTRY_COUNT,
};

/** The year's reconciliation two hours in, in the panel beside Northwind's year to date. */
export function hoursScene(): Drawing {
  return inProductDrawing(hoursReplay(), YEAR);
}

/**
 * The layout of the walls picture: two windows side by side. On a narrow
 * screen they stack, each its bar over its panel and as tall as the panel
 * needs to show its conversation, so a phone's picture holds the first
 * window whole and the start of the second (the kit's panel keeps its
 * header and composer at any height).
 */
const WALLS_STYLE = `
.story-walls { display: flex; gap: 16px; height: calc(100vh - 48px); }
.story-walls > * { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.story-walls-body { flex: 1; min-height: 0; display: flex; }
.story-walls-panel { width: 390px; flex: none; }
@media (max-width: 600px) {
  .story-walls { flex-direction: column; height: auto; }
  .story-walls > * { flex: none; height: 680px; }
  .story-walls-ledger { display: none; }
  .story-walls-panel { width: auto; flex: 1; border-left: none; }
}
`;

/** One customer's books as a narrow column beside its panel: each entry's memo and amount. */
function slimLedger(entries: readonly Entry[]): ReactElement {
  return (
    <section
      className="story-walls-ledger"
      aria-label="Ledger entries"
      style={{ flex: 1, minWidth: 0, overflow: "hidden", padding: "16px 16px", background: "var(--stgm-background)" }}
    >
      <h2 style={{ margin: "0 0 10px", fontSize: "var(--stgm-text-sm)", fontWeight: 600, color: "var(--stgm-foreground)" }}>Ledger entries</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--stgm-text-xs)", color: "var(--stgm-foreground)", fontVariantNumeric: "tabular-nums" }}>
        <tbody>
          {entries.map((entry) => (
            <tr key={`${entry.date}-${entry.memo}`}>
              <td style={{ padding: "7px 0", borderBottom: "1px solid var(--stgm-border)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 0, width: "100%" }}>
                {entry.memo}
              </td>
              <td style={{ padding: "7px 0 7px 8px", borderBottom: "1px solid var(--stgm-border)", textAlign: "right", whiteSpace: "nowrap" }}>{money(entry.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** One customer's window: the host's bar naming the customer, its books, and its own conversation in the panel. */
function customerWindow({ customer, entries, replay, agent, org }: CustomerPanel): ReactElement {
  return (
    <div key={org} style={{ borderRadius: 12, overflow: "hidden", boxShadow: "0 0 0 1px var(--stgm-border)", background: "var(--stgm-background)" }}>
      {hostBar(customer, "Q3 2026")}
      <div className="story-walls-body">
        {slimLedger(entries)}
        <div className="story-walls-panel stg:border-l stg:border-border">
          <AgentChat agent={agent} org={org} variant="panel" defaultOpen defaultSessionId={replay.session!.metadata!.id} />
        </div>
      </div>
    </div>
  );
}

/** Two customers of one product, each asking the same agent about its own books in its own window. */
export function wallsScene(): Drawing {
  const [first, second] = wallsPanels();
  return {
    inOrganization: true,
    routes: sessionRoutes(first.replay, { agent: STORY_AGENT, others: [second.replay] }),
    render: () => (
      <>
        <style>{WALLS_STYLE}</style>
        <div className="story-walls">
          {customerWindow(first)}
          {customerWindow(second)}
        </div>
      </>
    ),
  };
}

/** The integrator's organization, as Stigmer's console names it, under the samples' organization's id. */
const INTEGRATOR_ORG = samples.organization({ id: ORGANIZATION.metadata!.id, name: OTHERS.integrator, slug: "harbor-ledger" });

/** Both providers on the integrator's own keys. */
const BOTH_OWN = readiness({
  anthropic: ProviderAvailability.served_by_organization,
  openai: ProviderAvailability.served_by_organization,
});

/** The integrator's own keys, saved by its admin: Anthropic's, and OpenAI's beside it. */
function integratorKeys(): ProviderKey[] {
  const anthropic = ownAnthropicKey(OTHERS.integratorAdmin);
  const openai = ownAnthropicKey(OTHERS.integratorAdmin);
  openai.provider = "openai";
  openai.keyHint = "Rk4e";
  return [anthropic, openai];
}

/**
 * The integrator's own Stigmer console: Models & providers, with Anthropic
 * and OpenAI connected on the organization's own keys, saved by its admin.
 * This is the integrator's view, not its customers'.
 */
export function keysScene(): Drawing {
  return {
    inOrganization: true,
    routes: modelsRoutes(BOTH_OWN, integratorKeys(), "admin", INTEGRATOR_ORG),
    render: () =>
      productWindow(
        <div style={{ height: "calc(100vh - 48px)", overflow: "hidden", background: "var(--stgm-background)" }}>
          <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
            <ModelsHub org={INTEGRATOR_ORG.metadata!.id} />
          </div>
        </div>,
      ),
  };
}
