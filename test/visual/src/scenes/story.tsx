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
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { samples } from "@stigmer/react-sdk/test";
import { JOB } from "../../../../brand/job-story.ts";
import type { Drawing } from "./drawing.ts";
import { sessionDrawing, type SessionReplay } from "./session.tsx";

/** The quarter's ledger as the agent read it: one expense coded to the wrong account. */
const LEDGER_ROWS = [
  "date,account,amount,memo",
  "2026-07-03,6100 Office supplies,1240.00,Figma annual plan",
  "2026-07-08,6200 Rent,4800.00,July rent",
  "2026-07-15,6410 Software subscriptions,96.00,GitHub Team",
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
