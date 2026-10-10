/**
 * Connect Tools overview tour — the page-level "what you'll build" walkthrough
 * at the top of "Connect your tools": an MCP server in a plugin, signed in →
 * Start a chat with the plugin → one code change → real data in the
 * terminal → the approval gate pausing the tool the server marks
 * destructive → the approved result.
 *
 * This is the overview; the two step-level embeds further down the same page
 * (`mcp-server-creation-tour`, `mcp-server-connect-tour`) walk adding the
 * server and signing in to it in detail. All three depict the same plugin,
 * sourced from `_shared/order-management-plugin.ts`, so the page cannot
 * contradict itself.
 *
 * Honest depiction: the overview describes the outcome of signing in and
 * leaves the click-by-click story to the detail embed; the plugin page here
 * is already signed in, and its "Start a chat" lands on the console home
 * with the plugin picked (`/?plugin=<org>/<slug>`), the route the console's
 * plugin page opens.
 *
 * Import discipline: `scenar narrate` loads this file in plain Node (tsx),
 * so it must only pull pure modules — the run snapshots the thread
 * beats render live in `index.tsx` (a rendering concern); step data carries
 * only semantic tags.
 */
import type { ScenarioStep } from "@scenar/react";
import { ORDER_MGMT } from "../_shared/order-management-plugin";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type ConnectToolsTourStep =
  | { view: "plugin-page" }
  | { view: "chat-launcher" }
  | { view: "code" }
  | { view: "terminal" }
  | {
      view: "thread";
      /** The approval story's two frames: gate open, then resolved. */
      phase: "awaiting-approval" | "approved";
    };

/** The question the launcher beat has typed, and the code beat's session asks. */
export const ORDER_QUESTION = "What's the status of order #ORD-4821?";

// ---------------------------------------------------------------------------
// Code fixture (the "one line adds the tools" beat)
// ---------------------------------------------------------------------------

/**
 * The quickstart project's `ask-agent.ts` at the moment the plugin joins the
 * session. The `plugins` line is the payoff and is the one the editor beat
 * highlights.
 */
export const PLUGIN_REFS_CODE = [
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
  `  plugins: [{ org: "my-org", slug: "${ORDER_MGMT.name}" }],`,
  "});",
  "",
  "const run = await stigmer.run.create({",
  '  org: "my-org",',
  "  sessionId: session.metadata!.id,",
  `  message: "${ORDER_QUESTION}",`,
  "});",
];

/** 0-based index of the `plugins` line `PLUGIN_REFS_CODE` highlights. */
export const PLUGIN_REFS_HIGHLIGHT_LINE = PLUGIN_REFS_CODE.findIndex((line) =>
  line.includes("plugins:"),
);

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/*
 * Step 0 is deliberately interaction-free: the packed embed arms step-0
 * interactions at mount (under the poster), so they would fire before Play.
 * The plugin page's `start-chat` target is named by `_shared/CursorTargets`;
 * the approval beat points the cursor at the gate's real `approve-button`
 * target, shipped by the SDK.
 */
export const connectToolsTourSteps: ScenarioStep<ConnectToolsTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "plugin-page" },
    narration:
      "This is what you're building toward: your order management API in a plugin, signed in, its tools ready for a conversation.",
  },
  {
    delayMs: 3000,
    data: { view: "plugin-page" },
    narration:
      "Start a chat opens a new conversation that uses the plugin whole: its server's tools, and anything else it holds.",
    interactions: [
      { atPercent: 0.35, type: "set_cursor", target: "start-chat" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "chat-launcher" },
    narration:
      "The new conversation already lists the plugin. Ask about an order.",
  },
  {
    delayMs: 3500,
    data: { view: "code" },
    narration:
      "From code, it's one line: list the plugin on your session. The agent now has access to real data.",
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
      "Ask to process a return and the agent stops. The server marks process return destructive, because it moves money, so the agent shows exactly what it wants to do and waits for a human.",
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
