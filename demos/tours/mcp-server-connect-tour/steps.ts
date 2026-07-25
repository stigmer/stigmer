/**
 * MCP server connect tour — the walkthrough for the "Connect" step of
 * "Connect your tools": the real `McpServerDetailView` going from a freshly
 * registered server (no tools) through the shipped two-click connect flow
 * (Connect opens the credential form *without* connecting; Save connects) to
 * discovered tools and an auto-classified approval policy.
 *
 * Continuity: this tour picks up exactly where `mcp-server-creation-tour`
 * leaves off ("Next, connect it…") — same server, same org, same env var,
 * all sourced from `_shared/order-management-mcp.ts` so the embeds on the
 * same docs page cannot drift apart.
 *
 * Determinism (scenar-cloud DD-006): the resource that CHANGES across the
 * timeline — the server before vs after discovery — is data this tour owns.
 * `index.tsx` passes frozen `McpServer` snapshots into the view through its
 * `mcpServerState` prop, so no beat depends on an RPC resolving; the router
 * in `.scenar/providers.tsx` registers nothing. Depicted states via props,
 * remounts via `key` for internal-state resets, never synthetic events.
 *
 * The one thing deliberately not depicted is the "Connecting..." busy state:
 * it lives in `useMcpServerConnect`'s transient state and is not
 * prop-drivable. The narration owns that moment instead — honestly, since
 * the real connect blocks for a few seconds while a workflow talks to the
 * live endpoint.
 *
 * Import discipline: `scenar narrate` loads this file in plain Node (tsx),
 * so it must only pull pure modules — the `McpServer` snapshots live in
 * `index.tsx` (a rendering concern); step data carries only semantic tags.
 */
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** How far the credential form has gotten: just opened, or token pasted. */
export type CredentialFormPhase = "empty" | "filled";

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type McpServerConnectTourStep =
  | {
      view: "detail";
      /** Which snapshot the detail view renders: pre- or post-discovery. */
      phase: "registered" | "connected";
      /** The capability tab the beat lands on. */
      tab: "tools" | "policies";
    }
  | { view: "credentials"; form: CredentialFormPhase };

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/*
 * Cursor choreography: each pointing step sets its cursor mid-step and
 * clears it before the step ends, so every step is self-contained. Cursor
 * targets inside the real component (`connect-button`, `credential-form`,
 * `env-form-submit`, `tab-policies`) are the `data-cursor-target` hooks
 * @stigmer/react ships; the cursor auto-scrolls its target into view.
 * Beats without a cursor open with a `scroll_to` instead, because a `key`
 * remount resets the frame's scroll position to the top.
 */
export const mcpServerConnectTourSteps: ScenarioStep<McpServerConnectTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "detail", phase: "registered", tab: "tools" },
    narration:
      "Here's the server you just created. It's registered, but Stigmer hasn't talked to it yet — the Tools tab is empty until you connect.",
    // No interactions here: the embed arms step-0 interactions at mount
    // (under the poster), so they would fire before Play — a @scenar/react
    // quirk every tour works around by keeping its first step inert.
  },
  {
    delayMs: 2500,
    data: { view: "detail", phase: "registered", tab: "tools" },
    narration:
      "Connecting reaches the live server, catalogs every tool it offers, and classifies each one for approval. It all starts from this one button.",
    interactions: [
      { atPercent: 0.35, type: "set_cursor", target: "connect-button" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 2500,
    data: { view: "credentials", form: "empty" },
    narration:
      "This server declares a bearer token, so Connect asks for it before dialing out. Save for future runs keeps the token in your personal environment — you enter it once.",
    interactions: [
      { atPercent: 0.1, type: "scroll_to", target: "mcp-connection" },
      { atPercent: 0.45, type: "set_cursor", target: "credential-form" },
      { atPercent: 0.9, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 2500,
    data: { view: "credentials", form: "filled" },
    narration:
      "Paste the token and save. Stigmer stores it securely, connects to the live endpoint, and starts discovery. This takes a few seconds — it's talking to the real server.",
    interactions: [
      { atPercent: 0.45, type: "set_cursor", target: "env-form-submit" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "detail", phase: "connected", tab: "tools" },
    narration:
      "Connected. Stigmer found three tools — get order, list orders, and process return — and the header now shows when discovery last ran.",
    interactions: [{ atPercent: 0.2, type: "scroll_to", target: "mcp-capabilities" }],
  },
  {
    delayMs: 2800,
    data: { view: "detail", phase: "connected", tab: "tools" },
    narration:
      "Discovery also classified each tool. Read-only lookups pass through automatically — check the Policies tab for the one that doesn't.",
    interactions: [
      { atPercent: 0.4, type: "set_cursor", target: "tab-policies" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "detail", phase: "connected", tab: "policies" },
    narration:
      "process return moves money, so it was auto-classified to require human approval. Your agent will pause and ask before any refund goes out — no extra code, the policy lives on the server.",
    interactions: [{ atPercent: 0.15, type: "scroll_to", target: "mcp-capabilities" }],
  },
];
