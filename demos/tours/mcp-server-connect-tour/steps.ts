/**
 * Sign in and check tools — the walkthrough for the "Connect" step of
 * "Connect your tools": the real plugin page going from a server that asks
 * you to sign in, through the server's own login page, to "Signed in", and
 * then the server's tools as "Check tools" and `stigmer connect plugin`
 * list them, one of which the server marks destructive.
 *
 * Continuity: this tour picks up exactly where `mcp-server-creation-tour`
 * leaves off ("Next, sign in…") — same plugin, same server, same org, all
 * sourced from `_shared/order-management-plugin.ts` so the embeds on the
 * same docs page cannot drift apart.
 *
 * Determinism (the fixture-determinism rule, demos/README.md): the one
 * thing that changes across the timeline is whether My vault holds a
 * login. The page reads it itself, so a beat says which state it shows by
 * the organization it names: before the sign-in by its slug, after by its
 * id (the API takes either), and `.scenar/providers.tsx` answers `getMine`
 * by which one asked. No beat depends on a click having happened.
 *
 * Two moments are deliberately not depicted on the page: the sign-in's
 * busy state (it lives in the sign-in hook's transient state) and the list
 * "Check tools" draws under the server (it lives in the row's own state,
 * filled by the click). The narration owns the first; the second is shown
 * where it is a pure function of data, the terminal's
 * `stigmer connect plugin`, which lists the same tools the same way.
 *
 * Import discipline: `scenar narrate` loads this file in plain Node (tsx),
 * so it must only pull pure modules — the `_shared` data modules and
 * `@scenar/react` types. Step data carries only semantic tags.
 */
import type { ScenarioStep, TerminalLine } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";
import { ORDER_MGMT, ORDER_MGMT_TOOLS } from "../_shared/order-management-plugin";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type McpServerConnectTourStep =
  | {
      view: "plugin-page";
      /** Whether My vault holds the server's login yet. */
      signedIn: boolean;
    }
  | { view: "login" }
  | { view: "terminal" };

// ---------------------------------------------------------------------------
// Terminal fixture
// ---------------------------------------------------------------------------

/** `stigmer connect plugin`'s name column (the CLI's `NAME_COLUMN`). */
const NAME_COLUMN = 30;

/**
 * `stigmer connect plugin order-management-api` after the sign-in, line for
 * line as the CLI renders a listing: the plugin and its server, each tool
 * with the destructive mark on the one the server marks, and where the
 * list came from. The sign-in is already in My vault, so the CLI lists
 * without asking for one.
 */
export const CONNECT_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: `stigmer connect plugin ${ORDER_MGMT.name}` },
  { type: "blank", text: "" },
  { type: "output", text: `Plugin:     ${DEMO_ORG}/${ORDER_MGMT.name}` },
  { type: "output", text: `MCP server: ${ORDER_MGMT.name} (http: ${ORDER_MGMT.url})` },
  { type: "blank", text: "" },
  { type: "output", text: `Tools (${ORDER_MGMT_TOOLS.length}):` },
  ...ORDER_MGMT_TOOLS.map(
    (tool): TerminalLine => ({
      type: "output",
      text: `  ${tool.name.padEnd(NAME_COLUMN)} ${tool.destructive ? "[destructive] " : ""}${tool.description}`,
    }),
  ),
  { type: "blank", text: "" },
  { type: "success", text: "✓ Listed as you; nothing stored" },
];

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/*
 * Cursor choreography: each pointing step sets its cursor mid-step and
 * clears it before the step ends, so every step is self-contained. The
 * plugin page's `sign-in` and `check-tools` targets are named by
 * `_shared/CursorTargets`; `login-allow` is the login card's submit.
 */
export const mcpServerConnectTourSteps: ScenarioStep<McpServerConnectTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "plugin-page", signedIn: false },
    narration:
      "Here's the plugin you just added. Its server asks you to sign in before its first tool call, and the page says so.",
    // No interactions here: the embed arms step-0 interactions at mount
    // (under the poster), so they would fire before Play — a @scenar/react
    // quirk every tour works around by keeping its first step inert.
  },
  {
    delayMs: 2500,
    data: { view: "plugin-page", signedIn: false },
    narration: "Sign in opens the server's own login page.",
    interactions: [
      { atPercent: 0.35, type: "set_cursor", target: "sign-in" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 2500,
    data: { view: "login" },
    narration:
      "You sign in there, with the provider's own login. Stigmer never sees your password: the token it gets back is saved in My vault.",
    interactions: [
      { atPercent: 0.55, type: "set_cursor", target: "login-allow" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 2500,
    data: { view: "plugin-page", signedIn: true },
    narration:
      "Back on the plugin page, the server says Signed in. The login is saved at the server's address, so every conversation of yours that uses this plugin can call it.",
  },
  {
    delayMs: 2500,
    data: { view: "plugin-page", signedIn: true },
    narration:
      "Check tools asks the server for its tools right now, as you, and stores nothing.",
    interactions: [
      { atPercent: 0.35, type: "set_cursor", target: "check-tools" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "terminal" },
    narration:
      "From a terminal, stigmer connect plugin lists the same three tools: get order, list orders, and process return. Process return moves money, so the server marks it destructive, and Stigmer asks a person before any call to it.",
  },
];
