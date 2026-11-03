// The story's data, with no component in it: the ledgers the host product
// lists, the agent its panel is headed by, and the two customers'
// conversations the picture of walls between customers draws. The scenes
// in story.tsx draw from it, and a unit case reads it under Node, where the
// kit's components do not load (src/__tests__/story-data.test.ts).
//
// The two customers ask the same agent the same thing. Each conversation
// lives in that customer's own organization, the way the embed guide wires
// one integrator's agent for many customers: `<AgentChat org>` names the
// organization the conversation lives in, apart from the agent's. The panel
// draws no organization, so the picture shows two conversations and the
// unit case holds the wiring.
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { samples, sampleInstant } from "@stigmer/react-sdk/test";
import { JOB, OTHERS } from "../../../../brand/job-story.ts";
import type { SessionReplay } from "./session.tsx";

/** One entry of a ledger. */
export interface Entry {
  readonly date: string;
  readonly account: string;
  readonly amount: string;
  readonly memo: string;
}

/** Northwind's quarter, in date order: one expense, the Figma plan, coded to the wrong account. */
export const ENTRIES: readonly Entry[] = [
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

/**
 * Northwind's year so far as its ledger page opens on it: the first entries
 * of January and February, of the year's `YEAR_ENTRY_COUNT`.
 */
export const YEAR_ENTRIES: readonly Entry[] = [
  { date: "2026-01-02", account: "4000 Book sales", amount: "-11840.25", memo: "December card settlements" },
  { date: "2026-01-05", account: "6410 Software subscriptions", amount: "39.00", memo: "Shopify Basic" },
  { date: "2026-01-08", account: "6200 Rent", amount: "4800.00", memo: "January rent" },
  { date: "2026-01-09", account: "5000 Cost of goods sold", amount: "4210.60", memo: "Ingram restock order" },
  { date: "2026-01-13", account: "6300 Utilities", amount: "402.37", memo: "Electricity for December" },
  { date: "2026-01-15", account: "6410 Software subscriptions", amount: "96.00", memo: "GitHub Team" },
  { date: "2026-01-20", account: "6500 Shipping", amount: "512.40", memo: "Postage for January orders" },
  { date: "2026-01-27", account: "6700 Bank fees", amount: "18.00", memo: "Card terminal fee" },
  { date: "2026-01-31", account: "6600 Payroll", amount: "18420.00", memo: "January payroll" },
  { date: "2026-02-02", account: "4000 Book sales", amount: "-7915.80", memo: "January card settlements" },
  { date: "2026-02-04", account: "6410 Software subscriptions", amount: "39.00", memo: "Shopify Basic" },
  { date: "2026-02-08", account: "6200 Rent", amount: "4800.00", memo: "February rent" },
  { date: "2026-02-11", account: "5000 Cost of goods sold", amount: "2655.15", memo: "Ingram restock order" },
  { date: "2026-02-13", account: "6300 Utilities", amount: "371.92", memo: "Electricity for January" },
  { date: "2026-02-15", account: "6410 Software subscriptions", amount: "96.00", memo: "GitHub Team" },
  { date: "2026-02-19", account: "6500 Shipping", amount: "344.10", memo: "Postage for February orders" },
  { date: "2026-02-24", account: "6700 Bank fees", amount: "18.00", memo: "Card terminal fee" },
  { date: "2026-02-28", account: "6600 Payroll", amount: "18420.00", memo: "February payroll" },
];

/** How many entries Northwind's year to date holds, as its ledger page counts them. */
export const YEAR_ENTRY_COUNT = 164;

/** Fernhill Bakery's quarter, in date order. */
export const FERNHILL_ENTRIES: readonly Entry[] = [
  { date: "2026-07-01", account: "4000 Bakery sales", amount: "-14260.90", memo: "June card settlements" },
  { date: "2026-07-02", account: "5000 Ingredients", amount: "1180.00", memo: "Bakers Mill flour" },
  { date: "2026-07-06", account: "6200 Rent", amount: "3900.00", memo: "July rent" },
  { date: "2026-07-14", account: "5000 Ingredients", amount: "642.35", memo: "Dairy order" },
  { date: "2026-07-31", account: "6600 Payroll", amount: "22870.00", memo: "July payroll" },
  { date: "2026-08-03", account: "5000 Ingredients", amount: "1265.00", memo: "Bakers Mill flour" },
  { date: "2026-08-06", account: "6200 Rent", amount: "3900.00", memo: "August rent" },
  { date: "2026-08-14", account: "6800 Repairs", amount: "485.00", memo: "Oven service" },
  { date: "2026-08-31", account: "6600 Payroll", amount: "22870.00", memo: "August payroll" },
  { date: "2026-09-01", account: "5000 Ingredients", amount: "1420.00", memo: "Bakers Mill flour" },
  { date: "2026-09-06", account: "6200 Rent", amount: "3900.00", memo: "September rent" },
];

/** A ledger as the agent reads it: a CSV of its entries. */
export function ledgerCsv(entries: readonly Entry[]): string {
  return ["date,account,amount,memo", ...entries.map((entry) => [entry.date, entry.account, entry.amount, entry.memo].join(","))].join("\n");
}

/** The agent in the panel: the story's ledger agent, by the name the docs give it. */
export const STORY_AGENT = samples.agent({ name: JOB.agent });

/** The events in log order, with their places (`seq`) numbered 1.., as the server keeps them. */
export function numbered(events: readonly SessionEvent[]): SessionEvent[] {
  return events.map((event, index) => ({ ...event, seq: BigInt(index + 1) }));
}

/** `events` filed in session `sessionId`: the samples' builders file every event in their demo session. */
export function filedIn(sessionId: string, events: readonly SessionEvent[]): SessionEvent[] {
  return events.map((event) => ({ ...event, sessionId }));
}

/** One customer's conversation in the walls picture: whose it is, its replay, and how its panel is wired. */
export interface CustomerPanel {
  /** The customer, as the host product's switcher names it. */
  readonly customer: string;
  /** The customer's ledger, as the host product lists it. */
  readonly entries: readonly Entry[];
  readonly replay: SessionReplay;
  /** `<AgentChat agent>`: the integrator's one agent, `org/slug`. */
  readonly agent: string;
  /** `<AgentChat org>`: the customer's own organization, where the conversation lives. */
  readonly org: string;
}

/** The same question each customer asks the agent. */
const WALLS_MESSAGE = JOB.message;

/** One customer's finished review of its own quarter: the ledger read, then its own finding. */
function customerPanel(
  customer: string,
  org: string,
  n: number,
  entries: readonly Entry[],
  reply: string,
): CustomerPanel {
  const sessionId = `ses_0000000000000000000000002${n}`;
  const runId = `run_0000000000000000000000002${n}`;
  const agent = STORY_AGENT.metadata!;
  const session = samples.session({
    id: sessionId,
    org,
    subject: WALLS_MESSAGE.replace(/\.$/, ""),
    agentRef: { org: agent.org, slug: agent.slug },
  });
  const read = samples.toolUseEvent("read_file", { path: JOB.ledger }, { runId, processedAt: sampleInstant(2_000) });
  const events = numbered(
    filedIn(sessionId, [
      samples.userMessageEvent(WALLS_MESSAGE, { runId }),
      samples.runStatusEvent("running", { runId }),
      read,
      samples.toolResultEvent(read.event.value!.id, ledgerCsv(entries), { runId, processedAt: sampleInstant(3_400) }),
      samples.agentMessageEvent(reply, { runId, processedAt: sampleInstant(21_000) }),
      samples.runStatusEvent("completed", { runId, processedAt: sampleInstant(22_000) }),
    ]),
  );
  return {
    customer,
    entries,
    replay: {
      session,
      events,
      runs: [samples.run({ id: runId, sessionId, phase: RunPhase.RUN_COMPLETED, message: WALLS_MESSAGE })],
      files: [],
      liveness: undefined,
      loadError: null,
    },
    agent: `${agent.org}/${agent.slug}`,
    org,
  };
}

/** Northwind's and Fernhill's panels: one agent, the same question, each answered from its own books. */
export function wallsPanels(): readonly [CustomerPanel, CustomerPanel] {
  return [
    customerPanel(
      JOB.customer,
      "northwind-books",
      1,
      ENTRIES,
      "The ledger balances. One entry is miscoded:\n\n- **Figma annual plan**, 3 July, 1,240.00: coded to 6100 Office supplies, it belongs in 6410 Software subscriptions.\n\nEvery other entry matches its account.",
    ),
    customerPanel(
      OTHERS.customer,
      "fernhill-bakery",
      2,
      FERNHILL_ENTRIES,
      "The ledger balances and nothing is miscoded. Two things stand out:\n\n- **Flour** is up 20% since July: Bakers Mill billed 1,180.00 then and 1,420.00 in September.\n- **Oven service** on 14 August, 485.00, is in 6800 Repairs, which is right for a service visit.",
    ),
  ];
}
