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
  | {
      /** Fetching the full MCP server resource (spec + status). */
      readonly status: "loading";
    }
  | {
      /** The server has env vars missing from the user's personal environment. */
      readonly status: "needsSetup";
      /** The fetched MCP server resource. */
      readonly mcpServer: McpServer;
      /** Environment variables the user must provide before proceeding. */
      readonly missingVariables: EnvVarFormVariable[];
      /** Tools discovered by the MCP server's status probe. */
      readonly discoveredTools: DiscoveredTool[];
      /** Per-tool approval policies from the server spec. */
      readonly toolApprovals: ToolApprovalPolicy[];
    }
  | {
      /** Environment variables are being persisted or the instance is being provisioned. */
      readonly status: "submitting";
      /** The fetched MCP server resource. */
      readonly mcpServer: McpServer;
      /** Environment variables collected from the user. */
      readonly missingVariables: EnvVarFormVariable[];
      /** Tools discovered by the MCP server's status probe. */
      readonly discoveredTools: DiscoveredTool[];
      /** Per-tool approval policies from the server spec. */
      readonly toolApprovals: ToolApprovalPolicy[];
    }
  | {
      /** The server is fully configured and ready for session creation. */
      readonly status: "ready";
      /** The fetched MCP server resource. */
      readonly mcpServer: McpServer;
      /** Tools discovered by the MCP server's status probe. */
      readonly discoveredTools: DiscoveredTool[];
      /** Per-tool approval policies from the server spec. */
      readonly toolApprovals: ToolApprovalPolicy[];
      /** Tool names enabled for this session, after user selection. */
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
  /** Error from the last async transition, or `null` when healthy. */
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
  | {
      /** Add a new server entry in `loading` phase. */
      readonly type: "ADD_SERVER";
      /** Server key (`"org/slug"`). */
      readonly key: string;
    }
  | {
      /** Server resolved but needs env var collection. */
      readonly type: "RESOLVE_NEEDS_SETUP";
      /** Server key (`"org/slug"`). */
      readonly key: string;
      /** The fetched MCP server resource. */
      readonly mcpServer: McpServer;
      /** Variables the user must provide. */
      readonly missingVariables: EnvVarFormVariable[];
      /** Tools discovered by the server's status probe. */
      readonly discoveredTools: DiscoveredTool[];
      /** Per-tool approval policies from the server spec. */
      readonly toolApprovals: ToolApprovalPolicy[];
    }
  | {
      /** Server resolved and is ready (no env vars needed). */
      readonly type: "RESOLVE_READY";
      /** Server key (`"org/slug"`). */
      readonly key: string;
      /** The fetched MCP server resource. */
      readonly mcpServer: McpServer;
      /** Tools discovered by the server's status probe. */
      readonly discoveredTools: DiscoveredTool[];
      /** Per-tool approval policies from the server spec. */
      readonly toolApprovals: ToolApprovalPolicy[];
      /** Tool names enabled for this session. */
      readonly enabledTools: string[];
    }
  | {
      /** Re-evaluate missing variables after pool values arrive. */
      readonly type: "POOL_RESOLVE";
      /** Server key (`"org/slug"`). */
      readonly key: string;
      /** Updated missing variables (may be empty if pool covered all). */
      readonly missingVariables: EnvVarFormVariable[];
      /** Tool names enabled for this session. */
      readonly enabledTools: string[];
    }
  | {
      /** Begin persisting env vars for this server. */
      readonly type: "SUBMIT_START";
      /** Server key (`"org/slug"`). */
      readonly key: string;
    }
  | {
      /** Env var submission succeeded — server is ready. */
      readonly type: "SUBMIT_DONE";
      /** Server key (`"org/slug"`). */
      readonly key: string;
      /** Tool names enabled for this session. */
      readonly enabledTools: string[];
    }
  | {
      /** Update the enabled tools list for a ready server. */
      readonly type: "SET_ENABLED_TOOLS";
      /** Server key (`"org/slug"`). */
      readonly key: string;
      /** New set of enabled tool names. */
      readonly enabledTools: string[];
    }
  | {
      /** Env var submission failed — revert to `needsSetup`. */
      readonly type: "SUBMIT_FAIL";
      /** Server key (`"org/slug"`). */
      readonly key: string;
      /** The error that occurred during submission. */
      readonly error: Error;
    }
  | {
      /** Set an error on a specific server entry. */
      readonly type: "SET_ERROR";
      /** Server key (`"org/slug"`). */
      readonly key: string;
      /** The error to set. */
      readonly error: Error;
    }
  | {
      /** Clear the error on a specific server entry. */
      readonly type: "CLEAR_ERROR";
      /** Server key (`"org/slug"`). */
      readonly key: string;
    }
  | {
      /** Remove a server entry from the state. */
      readonly type: "REMOVE_SERVER";
      /** Server key (`"org/slug"`). */
      readonly key: string;
    }
  | {
      /** Reset all server entries to the initial empty state. */
      readonly type: "RESET";
    };

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

    case "POOL_RESOLVE": {
      const entry = state[action.key];
      if (entry?.status !== "needsSetup") return state;

      if (action.missingVariables.length === 0) {
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

      return {
        ...state,
        [action.key]: {
          ...entry,
          missingVariables: action.missingVariables,
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
          missingVariables: entry.missingVariables,
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

    case "SUBMIT_FAIL": {
      const entry = state[action.key];
      if (entry?.status !== "submitting") return state;
      return {
        ...state,
        [action.key]: {
          status: "needsSetup",
          mcpServer: entry.mcpServer,
          missingVariables: entry.missingVariables,
          discoveredTools: entry.discoveredTools,
          toolApprovals: entry.toolApprovals,
          error: action.error,
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
