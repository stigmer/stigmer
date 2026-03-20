import type { ResourceRef } from "@stigmer/sdk";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { DiscoveredTool } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { EnvVarFormVariable } from "../environment/EnvVarForm";

// ---------------------------------------------------------------------------
// Key utility
// ---------------------------------------------------------------------------

/**
 * Builds the map key for an MCP server from its resource reference.
 *
 * Format: `"org/slug"`. Used as the entry key in
 * {@link McpServerSetupState} and the `key` field on every per-entry
 * {@link McpServerSetupAction}.
 */
export function toServerKey(ref: ResourceRef): string {
  return `${ref.org}/${ref.slug}`;
}

// ---------------------------------------------------------------------------
// State machine — phases of an individual MCP server's setup flow
// ---------------------------------------------------------------------------

/**
 * Discriminated union representing the current phase of an individual
 * MCP server's setup flow managed by the orchestration hook
 * (`useMcpServerSetup`).
 *
 * The `status` field serves as the discriminant. Phase-specific data
 * (server resource, missing variables, discovered tools, enabled tools)
 * is only present on the variants where it is meaningful, enabling
 * TypeScript narrowing in consumer code.
 *
 * Phases:
 * - `"loading"` — Fetching the full `McpServer` resource (spec + status).
 * - `"needsSetup"` — The server has an `env_spec` with variables missing
 *   from the user's personal environment. The UI should present a
 *   credential collection form.
 * - `"submitting"` — Environment variables are being persisted (save path)
 *   or collected (one-time path). The UI should show a loading indicator
 *   on the submit button.
 * - `"ready"` — The server is fully configured and ready for session
 *   creation. Carries the effective `enabledTools` list. Covers both
 *   the "no env_spec needed" and "env vars resolved" cases.
 */
export type McpServerSetupPhase =
  | { readonly status: "loading" }
  | {
      readonly status: "needsSetup";
      readonly mcpServer: McpServer;
      readonly missingVariables: EnvVarFormVariable[];
      readonly discoveredTools: DiscoveredTool[];
      readonly toolApprovals: ToolApprovalPolicy[];
    }
  | {
      readonly status: "submitting";
      readonly mcpServer: McpServer;
      readonly discoveredTools: DiscoveredTool[];
      readonly toolApprovals: ToolApprovalPolicy[];
    }
  | {
      readonly status: "ready";
      readonly mcpServer: McpServer;
      readonly discoveredTools: DiscoveredTool[];
      readonly toolApprovals: ToolApprovalPolicy[];
      readonly enabledTools: string[];
    };

/**
 * Full state of an individual MCP server setup entry: the current phase
 * plus an orthogonal error slot.
 *
 * Errors can occur in any async transition (`loading`, `submitting`)
 * and are surfaced alongside the phase so the UI can show inline
 * error messages without losing the current phase context.
 *
 * Matches the pattern established by `AgentSetupState`.
 */
export type McpServerSetupEntry = McpServerSetupPhase & {
  readonly error: Error | null;
};

/**
 * The complete reducer state: an immutable record of server setup
 * entries keyed by `"org/slug"` (see {@link toServerKey}).
 *
 * Each entry tracks one selected MCP server independently through the
 * setup lifecycle. Entries are added when the user toggles a server on
 * in the picker and removed when toggled off.
 */
export type McpServerSetupState = Readonly<
  Record<string, McpServerSetupEntry>
>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Actions dispatched by the orchestration hook to drive per-server
 * setup state transitions.
 *
 * Every per-entry action carries a `key` field (the `"org/slug"` string
 * produced by {@link toServerKey}) identifying the target entry.
 */
export type McpServerSetupAction =
  | { readonly type: "ADD_SERVER"; readonly key: string }
  | {
      readonly type: "RESOLVE_NEEDS_SETUP";
      readonly key: string;
      readonly mcpServer: McpServer;
      readonly missingVariables: EnvVarFormVariable[];
      readonly discoveredTools: DiscoveredTool[];
      readonly toolApprovals: ToolApprovalPolicy[];
    }
  | {
      readonly type: "RESOLVE_READY";
      readonly key: string;
      readonly mcpServer: McpServer;
      readonly discoveredTools: DiscoveredTool[];
      readonly toolApprovals: ToolApprovalPolicy[];
      readonly enabledTools: string[];
    }
  | { readonly type: "SUBMIT_START"; readonly key: string }
  | {
      readonly type: "SUBMIT_DONE";
      readonly key: string;
      readonly enabledTools: string[];
    }
  | {
      readonly type: "SET_ENABLED_TOOLS";
      readonly key: string;
      readonly enabledTools: string[];
    }
  | { readonly type: "SET_ERROR"; readonly key: string; readonly error: Error }
  | { readonly type: "CLEAR_ERROR"; readonly key: string }
  | { readonly type: "REMOVE_SERVER"; readonly key: string }
  | { readonly type: "RESET" };

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const INITIAL_MCP_SETUP_STATE: McpServerSetupState = {};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function mcpServerSetupReducer(
  state: McpServerSetupState,
  action: McpServerSetupAction,
): McpServerSetupState {
  switch (action.type) {
    case "ADD_SERVER":
      return { ...state, [action.key]: { status: "loading", error: null } };

    case "RESOLVE_NEEDS_SETUP": {
      const entry = state[action.key];
      if (entry?.status !== "loading") return state;
      return {
        ...state,
        [action.key]: {
          status: "needsSetup",
          mcpServer: action.mcpServer,
          missingVariables: action.missingVariables,
          discoveredTools: action.discoveredTools,
          toolApprovals: action.toolApprovals,
          error: null,
        },
      };
    }

    case "RESOLVE_READY": {
      const entry = state[action.key];
      if (entry?.status !== "loading") return state;
      return {
        ...state,
        [action.key]: {
          status: "ready",
          mcpServer: action.mcpServer,
          discoveredTools: action.discoveredTools,
          toolApprovals: action.toolApprovals,
          enabledTools: action.enabledTools,
          error: null,
        },
      };
    }

    case "SUBMIT_START": {
      const entry = state[action.key];
      if (entry?.status !== "needsSetup") return state;
      return {
        ...state,
        [action.key]: {
          status: "submitting",
          mcpServer: entry.mcpServer,
          discoveredTools: entry.discoveredTools,
          toolApprovals: entry.toolApprovals,
          error: null,
        },
      };
    }

    case "SUBMIT_DONE": {
      const entry = state[action.key];
      if (entry?.status !== "submitting") return state;
      return {
        ...state,
        [action.key]: {
          status: "ready",
          mcpServer: entry.mcpServer,
          discoveredTools: entry.discoveredTools,
          toolApprovals: entry.toolApprovals,
          enabledTools: action.enabledTools,
          error: null,
        },
      };
    }

    case "SET_ENABLED_TOOLS": {
      const entry = state[action.key];
      if (entry?.status !== "ready") return state;
      return {
        ...state,
        [action.key]: { ...entry, enabledTools: action.enabledTools },
      };
    }

    case "SET_ERROR": {
      const entry = state[action.key];
      if (!entry) return state;
      return { ...state, [action.key]: { ...entry, error: action.error } };
    }

    case "CLEAR_ERROR": {
      const entry = state[action.key];
      if (!entry) return state;
      return { ...state, [action.key]: { ...entry, error: null } };
    }

    case "REMOVE_SERVER": {
      if (!(action.key in state)) return state;
      const { [action.key]: _, ...rest } = state;
      return rest;
    }

    case "RESET":
      return INITIAL_MCP_SETUP_STATE;

    default:
      return state;
  }
}
