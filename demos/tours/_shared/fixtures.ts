import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import type { UseWorkspaceEntriesReturn } from "@stigmer/react";
import { samples } from "@stigmer/react/test";

/**
 * Org slug used across real-component tour chrome. Shown in the shell's org
 * indicator and passed to `SessionComposer` as its scope; no backend lookup
 * happens (the composer's list callbacks are inert in a demo).
 */
export const DEMO_ORG = "acme";

/**
 * The one MCP server the Getting Started tours tell a story about. Tour 4
 * (`mcp-server-creation-tour`) creates it; tour 5 (`mcp-server-connect-tour`)
 * connects it on the same docs page — so every field lives here once, and the
 * two embeds cannot drift apart.
 */
export const ORDER_MGMT_MCP = {
  name: "Order Management API",
  slug: "order-management-api",
  description: "REST API for order lookup, inventory, and return processing.",
  url: "https://api.acme.com/mcp",
  /** The env var the Authorization header resolves from at runtime. */
  envKey: "API_TOKEN",
  envDescription: "Bearer token for the Order Management API",
} as const;

/**
 * Frozen instant for the connect tour's "Discovered <date>" header line.
 * Fixtures must never read the real clock — a `new Date()` here would make
 * the packed embed render differently on every replay and every video-export
 * frame (scenar-cloud DD-006).
 */
export const ORDER_MGMT_DISCOVERED_AT = new Date("2026-07-20T09:30:00Z");

/**
 * Zoom applied to real `@stigmer/react` components rendered in the shell's
 * content area. The components are built for full application width; 0.9 fits
 * a full-featured surface (MessageThread, SessionComposer) inside the demo
 * shell without distorting typography ratios.
 *
 * In the docs this lived in a shared tokens module; here it travels with the
 * chrome that applies it. `zoom` is what Scenar's own `DemoViewport` uses to
 * scale the canonical layout, so it composes cleanly with the embed.
 */
export const DEMO_CONTENT_ZOOM = 0.9;

/**
 * Zoom applied to real `@stigmer/react` widgets in the shell's right sidebar
 * (`WidgetsSidebar`). Slightly higher than `DEMO_CONTENT_ZOOM` because the
 * sidebar is narrower and the widgets are already compact.
 */
export const DEMO_SIDEBAR_ZOOM = 0.92;

/**
 * Build an execution snapshot where the first human message goes into
 * `spec.message` and the rest into `status.messages`. `MessageThread`
 * synthesizes the human bubble from `spec.message`, so this split avoids
 * rendering it twice.
 *
 * The default `EXECUTION_IN_PROGRESS` phase suits mid-conversation frames
 * (`MessageThread`/`ExecutionProgress` render it as a "working" indicator
 * without fetching anything — they are presentational); pass
 * `EXECUTION_COMPLETED` for a finished conversation.
 */
export function snapshot(
  msgs: AgentMessage[],
  phase: ExecutionPhase = ExecutionPhase.EXECUTION_IN_PROGRESS,
  artifacts?: ExecutionArtifact[],
): AgentExecution {
  const firstHumanIdx = msgs.findIndex((m) => m.type === MessageType.MESSAGE_HUMAN);
  const specMessage = firstHumanIdx >= 0 ? msgs[firstHumanIdx].content : "";
  const statusMessages =
    firstHumanIdx >= 0
      ? [...msgs.slice(0, firstHumanIdx), ...msgs.slice(firstHumanIdx + 1)]
      : msgs;

  const exec = samples.agentExecution({ phase, messages: statusMessages, artifacts });
  exec.spec!.message = specMessage;
  return exec;
}

const noop = () => {};

/**
 * An empty workspace for `SessionComposer` in a demo. The composer takes the
 * workspace-entries controller as a prop rather than fetching it, so a static,
 * empty, inert implementation is all a tour needs — there is nothing to add,
 * remove, or submit in a playback.
 */
export const MOCK_WORKSPACE: UseWorkspaceEntriesReturn = {
  entries: [],
  addGitRepo: noop,
  addLocalPath: noop,
  remove: noop,
  clear: noop,
  clearLocal: noop,
  toInput: () => [],
  hasEntries: false,
};
