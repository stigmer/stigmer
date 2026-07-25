/**
 * Connect Tools overview tour — the page-level "what you'll build" walkthrough
 * at the top of "Connect your tools": a connected MCP server with classified
 * policies → one code change → real data in the terminal → the approval gate
 * pausing a sensitive action → the approved result.
 *
 * This is the overview; the two step-level embeds further down the same page
 * (`mcp-server-creation-tour`, `mcp-server-connect-tour`) walk the create and
 * connect flows in detail. All three depict the same server, sourced from
 * `_shared/order-management-mcp.ts`, so the page cannot contradict itself.
 *
 * DD-004 note: the narration deliberately never says "one click connects" —
 * tour 5 on this page establishes the shipped flow is two clicks (Connect
 * opens the credential form; Save connects). The overview describes the
 * *outcome* of connecting and leaves the click-by-click story to the detail
 * embed.
 *
 * Import discipline: `scenar narrate` loads this file in plain Node (tsx),
 * so it must only pull pure modules — the execution snapshots the thread
 * beats render live in `index.tsx` (a rendering concern); step data carries
 * only semantic tags.
 */
import type { ScenarioStep } from "@scenar/react";
import { ORDER_MGMT_MCP } from "../_shared/order-management-mcp";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type ConnectToolsTourStep =
  | {
      view: "detail";
      /** Which capability tab the connected server's detail page lands on. */
      tab: "tools" | "policies";
    }
  | { view: "code" }
  | { view: "terminal" }
  | {
      view: "thread";
      /** The approval story's two frames: gate open, then resolved. */
      phase: "awaiting-approval" | "approved";
    };

// ---------------------------------------------------------------------------
// Code fixture (the "one line connects the tools" beat)
// ---------------------------------------------------------------------------

/**
 * The quickstart project's `ask-agent.ts` at the moment MCP servers join the
 * session. Line 11 (0-based) is the payoff — `mcpServerRefs` — and is the
 * one the editor beat highlights.
 */
export const MCP_REFS_CODE = [
  "// ask-agent.ts — Add tools alongside the Skill",
  'import { Stigmer } from "@stigmer/sdk";',
  "",
  "const stigmer = new Stigmer({",
  "  apiKey: process.env.STIGMER_API_KEY!,",
  "});",
  "",
  "const session = await stigmer.session.create({",
  '  name: `session-${Date.now()}`,',
  '  org: "my-org",',
  '  skillRefs: [{ org: "my-org", slug: "return-policy" }],',
  `  mcpServerRefs: [{ org: "my-org", slug: "${ORDER_MGMT_MCP.slug}" }],`,
  "});",
  "",
  "const execution = await stigmer.agentExecution.create({",
  '  org: "my-org",',
  "  sessionId: session.metadata!.id,",
  '  message: "What\'s the status of order #ORD-4821?",',
  "});",
];

/** 0-based index of the `mcpServerRefs` line `MCP_REFS_CODE` highlights. */
export const MCP_REFS_HIGHLIGHT_LINE = MCP_REFS_CODE.findIndex((line) =>
  line.includes("mcpServerRefs"),
);

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/*
 * Step 0 is deliberately interaction-free: the packed embed arms step-0
 * interactions at mount (under the poster), so they would fire before Play.
 * The capabilities scroll therefore lives on step 1, which lands on the
 * Policies tab via a remount and re-establishes scroll with `scroll_to`
 * (the `mcp-capabilities` target ships inside `@stigmer/react`). The
 * approval beat points the cursor at the gate's real `approve-button`
 * target — also shipped by the SDK.
 */
export const connectToolsTourSteps: ScenarioStep<ConnectToolsTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "detail", tab: "tools" },
    narration:
      "This is what you're building toward: an order management API connected to Stigmer, its tools discovered and ready for your agent.",
  },
  {
    delayMs: 3000,
    data: { view: "detail", tab: "policies" },
    narration:
      "Connecting discovered three tools and classified each one. Read operations pass through. Process return moves money, so it requires human approval.",
    interactions: [
      { atPercent: 0.15, type: "scroll_to", target: "mcp-capabilities" },
    ],
  },
  {
    delayMs: 3500,
    data: { view: "code" },
    narration:
      "Add MCP server refs to your session. The agent now has access to real data.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal" },
    narration:
      "Ask about an order and the agent calls get_order — real data, not a guess.",
  },
  {
    delayMs: 3500,
    data: { view: "thread", phase: "awaiting-approval" },
    narration:
      "Ask to process a return and the agent stops. It shows exactly what it wants to do and waits for a human.",
    interactions: [
      { atPercent: 0.45, type: "set_cursor", target: "approve-button" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3500,
    data: { view: "thread", phase: "approved" },
    narration:
      "Once approved, the agent completes the action and confirms the result.",
  },
];
