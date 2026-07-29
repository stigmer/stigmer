/**
 * MCP server creation tour — the walkthrough for "Connect your tools",
 * showing the flow the console ships today: Library → MCP Servers →
 * Add MCP Server → the creation picker (scratch / template / import) → the
 * real three-step creation wizard (identity & transport, environment & auth,
 * review & create) → the Library with the new server.
 *
 * Deliberately NOT an AI-conversation flow — the console's "Add MCP Server"
 * button opens this form wizard, not the mcp-server-creator agent (which
 * still exists as a separate, optional path). A Getting Started tour must
 * depict what a viewer can actually do (scenar-cloud DD-004).
 *
 * The failure beats are the point of this tour: the wizard's real inline
 * validation ("HTTP URL is required") and a real server error on create.
 * Both render through the real exported step components
 * (`IdentityTransportStep`, `ReviewStep`), driven purely by the wizard-data
 * snapshots below — never by synthetic events (steps stay pure functions of
 * step data, so scrubbing and video export reproduce every state exactly).
 *
 * `index.tsx` renders these steps; no RPC fixtures are needed — every beat
 * is prop-driven (`.scenar/providers.tsx` registers nothing).
 *
 * Import discipline: `scenar narrate` imports this file in a plain Node
 * process (no bundler), so it must only pull pure modules — protos, test
 * samples, `@scenar/react` types. The `McpServerWizardData` snapshots the
 * wizard beats render live in `index.tsx` (a rendering concern, compiled by
 * Vite); step data carries only semantic tags for which snapshot to show.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";
import { ORDER_MGMT_MCP } from "../_shared/order-management-mcp";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/**
 * How far the user has gotten through the wizard's identity step:
 * untouched → clicked Next with the URL missing (validation fires) →
 * URL supplied. `index.tsx` maps each phase to a wizard-data snapshot.
 */
export type IdentityFormPhase = "empty" | "invalid" | "complete";

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type McpServerCreationTourStep =
  | { view: "home" }
  | { view: "library-click" }
  | { view: "mcp-servers-list" }
  | { view: "creation-picker" }
  | { view: "wizard-identity"; form: IdentityFormPhase }
  | { view: "wizard-env-auth" }
  | { view: "wizard-review"; failed?: boolean }
  | { view: "import-manifest" }
  | { view: "library-complete" };

// ---------------------------------------------------------------------------
// The import path (shown as the alternative door to the same resource)
// ---------------------------------------------------------------------------

/**
 * The manifest shown in the import beat — the YAML expression of the same
 * server the wizard built, making the point that the form and the file are
 * two doors to one resource (`stigmer apply -f` is the CLI's third).
 */
export const MCP_SERVER_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  org: ${DEMO_ORG}
  name: ${ORDER_MGMT_MCP.slug}
spec:
  description: ${ORDER_MGMT_MCP.description}
  http:
    url: ${ORDER_MGMT_MCP.url}
    headers:
      Authorization: Bearer \${${ORDER_MGMT_MCP.envKey}}
  env:
    ${ORDER_MGMT_MCP.envKey}:
      description: ${ORDER_MGMT_MCP.envDescription}
      is_secret: true`;

// ---------------------------------------------------------------------------
// Library fixtures
// ---------------------------------------------------------------------------

/** The MCP Servers library before the tour: two unrelated existing servers. */
export const EXISTING_SERVERS = [
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000001",
    org: DEMO_ORG,
    kind: ApiResourceKind.mcp_server,
    name: "GitHub",
    slug: "github",
    description: "Repository management, issues, and pull requests.",
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000002",
    org: DEMO_ORG,
    kind: ApiResourceKind.mcp_server,
    name: "Slack Notifications",
    slug: "slack-notifications",
    description: "Send messages and manage channels via Slack API.",
  }),
];

/** The library after creation: the new order-management server joins. */
export const ALL_SERVERS = [
  ...EXISTING_SERVERS,
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000003",
    org: DEMO_ORG,
    kind: ApiResourceKind.mcp_server,
    name: ORDER_MGMT_MCP.name,
    slug: ORDER_MGMT_MCP.slug,
    description: ORDER_MGMT_MCP.description,
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
 * on a previous step's cursor state (the pattern all ported tours use).
 * Targets inside real components (`creation-path-scratch`, `wizard-next`)
 * are the `data-cursor-target` hooks @stigmer/react ships for guided tours.
 */
export const mcpServerCreationTourSteps: ScenarioStep<McpServerCreationTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "home" },
    narration:
      "Your agent knows your domain, but it can't act yet. MCP servers are the bridge to your APIs and services — let's register one.",
    // No cursor here: the embed arms step-0 interactions at mount (under the
    // poster), so they fire before Play — a @scenar/react quirk every ported
    // tour works around by keeping its first step cursor-less.
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
    data: { view: "mcp-servers-list" },
    narration:
      "Your organization's MCP servers live in the Library. Click Add MCP Server to register a new one.",
    interactions: [
      { atPercent: 0.55, type: "set_cursor", target: "create-mcp-server" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 2000,
    data: { view: "creation-picker" },
    narration:
      "Start from scratch, pick a pre-built template, or import a YAML file you already have. We'll build this one from scratch.",
    interactions: [
      { atPercent: 0.6, type: "set_cursor", target: "creation-path-scratch" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 1500,
    data: { view: "wizard-identity", form: "empty" },
    narration:
      "The wizard walks you through three steps. First, identity and transport: name the server and say how Stigmer reaches it — a remote HTTP endpoint, or a local command over stdio.",
  },
  {
    delayMs: 2000,
    data: { view: "wizard-identity", form: "invalid" },
    narration:
      "The form validates as you go. Skip a required field — like the HTTP URL — and the step tells you exactly what's missing before you can continue.",
    interactions: [
      { atPercent: 0.25, type: "set_cursor", target: "wizard-next" },
      { atPercent: 0.85, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 2000,
    data: { view: "wizard-identity", form: "complete" },
    narration:
      "Add the endpoint URL and you're through. Headers can reference environment variables with the dollar-brace syntax, so no secret ever lands in the config itself.",
    interactions: [
      // Bring the filled URL + headers (this beat's payoff) into view inside
      // the wizard's internal scroll area.
      { atPercent: 0.2, type: "scroll_to", target: "mcp-transport" },
    ],
  },
  {
    delayMs: 2500,
    data: { view: "wizard-env-auth" },
    narration:
      "Step two declares what the server needs at runtime. API TOKEN is marked secret — Stigmer stores it securely and injects it where the header placeholder points.",
  },
  {
    delayMs: 2500,
    data: { view: "wizard-review" },
    narration:
      "Step three shows the full picture: a summary, and the exact YAML manifest that will be created. The form is just a friendlier way to write this file.",
  },
  {
    delayMs: 3000,
    data: { view: "wizard-review", failed: true },
    narration:
      "If creation fails — say the slug is already taken in your org — the server's exact error appears right here. Adjust and create again; nothing is lost.",
  },
  {
    delayMs: 3000,
    data: { view: "import-manifest" },
    narration:
      "And if you already have that YAML, skip the wizard: the import door accepts a pasted manifest or a file — the console counterpart of stigmer apply dash f.",
  },
  {
    delayMs: 3000,
    data: { view: "library-complete" },
    narration:
      "The server is in your Library. Next, connect it — Stigmer will catalog its tools and generate approval policies automatically.",
  },
];
