/**
 * Add an MCP server — the walkthrough for "Connect your tools", showing the
 * flow the console ships: Library → Plugins → Add MCP server → the form
 * (name, URL, what it is for, headers) → the new plugin's page. An MCP
 * server lives only in a plugin, so "Add MCP server" installs a plugin of
 * that one server, named after it; the page it lands on is the same page
 * any installed plugin has.
 *
 * The form beats are a tour-local replica of `AddMcpServerDialog` (see
 * `index.tsx` for why the real dialog cannot render in an embed); the
 * plugin page is the real `PluginDetailView`, fed by the fixtures in
 * `.scenar/providers.tsx`. Its server reads "Not signed in": the sign-in
 * is the next tour's story (`mcp-server-connect-tour`).
 *
 * Import discipline: `scenar narrate` imports this file in a plain Node
 * process (no bundler), so it must only pull pure modules — protos, test
 * samples, `@scenar/react` types, and the `_shared` data modules. Step data
 * carries only semantic tags for which state to show.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";
import { ORDER_MGMT } from "../_shared/order-management-plugin";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** How far the person has gotten through the form: just opened, or filled in. */
export type AddFormPhase = "empty" | "filled";

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type McpServerCreationTourStep =
  | { view: "home" }
  | { view: "library-click" }
  | { view: "plugins-list" }
  | { view: "add-form"; form: AddFormPhase }
  | { view: "plugin-page" };

// ---------------------------------------------------------------------------
// Library fixtures
// ---------------------------------------------------------------------------

/** The Plugins list before the tour: two plugins the organization already installed. */
export const EXISTING_PLUGINS = [
  samples.searchResult({
    id: "plg-00000000-0000-0000-0000-000000000001",
    org: DEMO_ORG,
    kind: ApiResourceKind.plugin,
    name: "github",
    slug: "github",
    description: "Repository management, issues, and pull requests.",
  }),
  samples.searchResult({
    id: "plg-00000000-0000-0000-0000-000000000002",
    org: DEMO_ORG,
    kind: ApiResourceKind.plugin,
    name: "slack",
    slug: "slack",
    description: "Send messages and manage channels via Slack.",
  }),
];

/** Re-exported for the shell's org indicator (see `index.tsx`). */
export { DEMO_ORG };

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/*
 * Cursor choreography: each pointing step sets its cursor mid-step and clears
 * it before the step ends, so every step is self-contained — no step depends
 * on a previous step's cursor state. `add-mcp-server` and `add-submit` are
 * the replica's own targets; `sign-in` is named on the real page by
 * `_shared/CursorTargets`.
 */
export const mcpServerCreationTourSteps: ScenarioStep<McpServerCreationTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "home" },
    narration:
      "Your agent knows your domain, but it can't act yet. MCP servers are the bridge to your APIs and services, and on Stigmer every MCP server lives in a plugin. Let's add one.",
    // No cursor here: the embed arms step-0 interactions at mount (under the
    // poster), so they fire before Play — a @scenar/react quirk every tour
    // works around by keeping its first step cursor-less.
  },
  {
    delayMs: 2500,
    data: { view: "library-click" },
    interactions: [
      { atPercent: 0.35, type: "set_cursor", target: "library" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 2000,
    data: { view: "plugins-list" },
    narration:
      "Plugins are what your organization installs: from the Marketplace, uploaded from your computer, or, for a single server, added by its address. Click Add MCP server.",
    interactions: [
      { atPercent: 0.6, type: "set_cursor", target: "add-mcp-server" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 1500,
    data: { view: "add-form", form: "empty" },
    narration:
      "The form asks for a name, the server's address, and what it's for. Headers are optional, and a header names a key in your vault rather than holding its value.",
  },
  {
    delayMs: 2500,
    data: { view: "add-form", form: "filled" },
    narration:
      "Name it, paste the URL, and add. Stigmer installs a plugin of this one server, named after it.",
    interactions: [
      { atPercent: 0.55, type: "set_cursor", target: "add-submit" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "plugin-page" },
    narration:
      `The new plugin's page shows what it holds: the ${ORDER_MGMT.name} server, the address it's reached at, and the names its tools take. This server asks you to sign in, so the page says Not signed in.`,
    interactions: [
      { atPercent: 0.55, type: "set_cursor", target: "sign-in" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "plugin-page" },
    narration:
      "From a terminal, stigmer mcp add does the same in one line. Next, sign in and check its tools.",
  },
];
