import type { ResourceRef } from "@stigmer/sdk";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { AgentEnvFormVariable } from "./AgentEnvForm.js";

// ---------------------------------------------------------------------------
// Sign-ins — a server of the agent's plugins with no login where the run reads
// ---------------------------------------------------------------------------

/**
 * One MCP server of a plugin the agent lists that signs in and has no
 * login in the vaults the run reads. The agent is not ready until each is
 * signed in: a run would start and fail at the first tool call, so the
 * composer asks first, the way it asks for a missing variable. A sign-in
 * is saved in the person's My vault, at the server's address.
 */
export interface PendingSignIn {
  /** The plugin the server belongs to. */
  readonly plugin: ResourceRef;
  /** The plugin's name. */
  readonly pluginName: string;
  /** The server, from the plugin's status. */
  readonly server: McpServerEntry;
  /** The address the login is saved at: the key a sign-in completes under. */
  readonly address: string;
  /** The row's display name. */
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Resolution — the outcome of agent setup, consumed by session creation
// ---------------------------------------------------------------------------

/**
 * Describes how the agent was resolved, determining how the caller
 * should create the session and its first run.
 *
 * Every mode starts the conversation on the agent itself (the session's
 * `agentRef`); the mode says where the keys the agent declares come from:
 *
 * - `"saved"` — The vaults the conversation uses hold every declared key
 *   (saved in My vault just now or earlier, or in a vault the
 *   conversation lists). Each run reads them from there.
 * - `"direct"` — Nothing is needed from the user: the agent declares no
 *   keys, the platform fills the ones it does, or the agent is another
 *   organization's, whose runs never read My vault.
 */
export type AgentResolution =
  | {
      /** The vaults the conversation uses hold every key the agent declares. */
      readonly mode: "saved";
    }
  | {
      /** Nothing is needed from the user's vaults. */
      readonly mode: "direct";
    };

// ---------------------------------------------------------------------------
// State machine — phases of the agent setup flow
// ---------------------------------------------------------------------------

/**
 * Discriminated union representing the current phase of the agent
 * setup flow managed by {@link useAgentSetup}.
 *
 * The `status` field serves as the discriminant. Phase-specific data
 * (agent reference, missing variables, resolution) is only present
 * on the variants where it is meaningful, enabling TypeScript
 * narrowing in consumer code.
 */
export type AgentSetupPhase =
  | {
      /** No agent resolution has been initiated. */
      readonly status: "idle";
    }
  | {
      /** The agent blueprint is being fetched and its env spec is being evaluated. */
      readonly status: "resolving";
      /** Reference to the agent being resolved. */
      readonly agentRef: ResourceRef;
    }
  | {
      /**
       * The agent needs something from the user before it can run:
       * environment variables it declares, sign-ins to servers of the
       * plugins it lists, or both. Either list may be empty while the other is not.
       */
      readonly status: "needsEnvVars";
      /** Reference to the agent being set up. */
      readonly agentRef: ResourceRef;
      /** Server-assigned ID of the agent blueprint. */
      readonly agentId: string;
      /** Display name of the agent. */
      readonly agentName: string;
      /** Environment variables the user must provide before proceeding. */
      readonly missingVariables: AgentEnvFormVariable[];
      /** Servers of the agent's plugins that sign in and have no login where the run reads. */
      readonly pendingSignIns: readonly PendingSignIn[];
    }
  | {
      /** Environment variables are being saved to the My vault. */
      readonly status: "submitting";
      /** Reference to the agent being set up. */
      readonly agentRef: ResourceRef;
      /** Server-assigned ID of the agent blueprint. */
      readonly agentId: string;
      /** Display name of the agent. */
      readonly agentName: string;
      /** Environment variables that were collected from the user. */
      readonly missingVariables: AgentEnvFormVariable[];
      /** Carried so a failed submission returns to the same waiting state. */
      readonly pendingSignIns: readonly PendingSignIn[];
    }
  | {
      /** The agent is fully resolved and ready for session creation. */
      readonly status: "ready";
      /** Reference to the resolved agent. */
      readonly agentRef: ResourceRef;
      /** Display name of the resolved agent. */
      readonly agentName: string;
      /** How the agent was resolved — determines session creation strategy. */
      readonly resolution: AgentResolution;
    };

/**
 * Full state of the agent setup reducer: the current phase plus an
 * orthogonal error slot.
 *
 * Errors can occur in any async transition (`resolving`, `submitting`)
 * and are surfaced alongside the phase so the UI can show inline
 * error messages without losing the current phase context.
 */
export type AgentSetupState = AgentSetupPhase & {
  /** Error from the last async transition, or `null` when healthy. */
  readonly error: Error | null;
};

// ---------------------------------------------------------------------------
// Result types — imperative return values from hook actions
// ---------------------------------------------------------------------------

/**
 * Result returned by `useAgentSetup().resolveAgent()`.
 *
 * - `"ready"` — the agent can be used immediately.
 * - `"needsEnvVars"` — the agent requires environment variables
 *   the user has not yet provided.
 */
/**
 * Result returned by `useAgentSetup().submitEnvVars()` — always `"ready"`.
 *
 * Also used as the `"ready"` variant of {@link AgentSetupResult}.
 */
export interface AgentSetupReadyResult {
  /** The agent is ready for session creation. */
  readonly status: "ready";
  /** Reference to the resolved agent. */
  readonly agentRef: ResourceRef;
  /** Display name of the resolved agent. */
  readonly agentName: string;
  /** How the agent was resolved — determines session creation strategy. */
  readonly resolution: AgentResolution;
}

/**
 * Result returned by `useAgentSetup().resolveAgent()`.
 *
 * - `"ready"` — the agent can be used immediately.
 * - `"needsEnvVars"` — the agent requires environment variables
 *   the user has not yet provided.
 */
export type AgentSetupResult =
  | AgentSetupReadyResult
  | {
      /** The agent needs env vars, sign-ins, or both, before proceeding. */
      readonly status: "needsEnvVars";
      /** Reference to the agent being set up. */
      readonly agentRef: ResourceRef;
      /** Display name of the agent. */
      readonly agentName: string;
      /** Environment variables the user must provide before proceeding. */
      readonly missingVariables: AgentEnvFormVariable[];
      /** Servers of the agent's plugins that sign in and have no login where the run reads. */
      readonly pendingSignIns: readonly PendingSignIn[];
    };

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Action union for the agent setup state machine managed by {@link agentSetupReducer}. */
export type AgentSetupAction =
  | {
      /** Begin resolving an agent's requirements. */
      readonly type: "RESOLVE_START";
      /** Reference to the agent to resolve. */
      readonly agentRef: ResourceRef;
    }
  | {
      /** Agent resolved but requires env vars from the user. */
      readonly type: "RESOLVE_NEEDS_ENV";
      /** Reference to the agent. */
      readonly agentRef: ResourceRef;
      /** Server-assigned agent ID. */
      readonly agentId: string;
      /** Display name of the agent. */
      readonly agentName: string;
      /** Variables the user must provide. */
      readonly missingVariables: AgentEnvFormVariable[];
      /** Servers the user must sign in to. */
      readonly pendingSignIns: readonly PendingSignIn[];
    }
  | {
      /** One of the pending sign-ins completed; the hook re-resolves the agent when the last one does. */
      readonly type: "SIGN_IN_COMPLETED";
      /** The address the sign-in saved its login at. */
      readonly address: string;
    }
  | {
      /** Agent resolved and is ready for session creation. */
      readonly type: "RESOLVE_READY";
      /** Reference to the resolved agent. */
      readonly agentRef: ResourceRef;
      /** Display name of the resolved agent. */
      readonly agentName: string;
      /** Resolution strategy for session creation. */
      readonly resolution: AgentResolution;
    }
  | {
      /** Re-evaluate missing variables after pool values arrive. */
      readonly type: "POOL_RESOLVE";
      /** Updated missing variables (may be empty if pool covered all). */
      readonly missingVariables: AgentEnvFormVariable[];
    }
  | {
      /** Begin saving env vars to the My vault. */
      readonly type: "SUBMIT_START";
    }
  | {
      /** Env var submission succeeded — agent is ready. */
      readonly type: "SUBMIT_READY";
      /** Reference to the resolved agent. */
      readonly agentRef: ResourceRef;
      /** Display name of the resolved agent. */
      readonly agentName: string;
      /** Resolution strategy for session creation. */
      readonly resolution: AgentResolution;
    }
  | {
      /** An async operation failed. */
      readonly type: "ERROR";
      /** The error that occurred. */
      readonly error: Error;
    }
  | {
      /** Clear the error without changing phase. */
      readonly type: "CLEAR_ERROR";
    }
  | {
      /** Reset to idle state. */
      readonly type: "RESET";
    };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** Initial idle state for the agent setup reducer. */
export const INITIAL_STATE: AgentSetupState = {
  status: "idle",
  error: null,
};

/**
 * Pure reducer for the agent setup state machine.
 *
 * Transitions through `idle → resolving → needsEnvVars → submitting → ready`,
 * with error handling orthogonal to the current phase.
 */
export function agentSetupReducer(
  state: AgentSetupState,
  action: AgentSetupAction,
): AgentSetupState {
  switch (action.type) {
    case "RESOLVE_START":
      return { status: "resolving", agentRef: action.agentRef, error: null };

    case "RESOLVE_NEEDS_ENV":
      return {
        status: "needsEnvVars",
        agentRef: action.agentRef,
        agentId: action.agentId,
        agentName: action.agentName,
        missingVariables: action.missingVariables,
        pendingSignIns: action.pendingSignIns,
        error: null,
      };

    case "SIGN_IN_COMPLETED": {
      if (state.status !== "needsEnvVars") return state;
      const pendingSignIns = state.pendingSignIns.filter((signIn) => signIn.address !== action.address);
      if (pendingSignIns.length === state.pendingSignIns.length) return state;
      return { ...state, pendingSignIns };
    }

    case "RESOLVE_READY":
      return {
        status: "ready",
        agentRef: action.agentRef,
        agentName: action.agentName,
        resolution: action.resolution,
        error: null,
      };

    case "POOL_RESOLVE": {
      if (state.status !== "needsEnvVars") return state;

      // The pool covers variables, never sign-ins: with a sign-in still
      // pending the agent stays where it is, its variable list shortened.
      if (action.missingVariables.length === 0 && state.pendingSignIns.length === 0) {
        return {
          status: "ready",
          agentRef: state.agentRef,
          agentName: state.agentName,
          resolution: { mode: "direct" },
          error: null,
        };
      }

      return {
        ...state,
        missingVariables: action.missingVariables,
      };
    }

    case "SUBMIT_START": {
      if (state.status !== "needsEnvVars") return state;
      return {
        status: "submitting",
        agentRef: state.agentRef,
        agentId: state.agentId,
        agentName: state.agentName,
        missingVariables: state.missingVariables,
        pendingSignIns: state.pendingSignIns,
        error: null,
      };
    }

    case "SUBMIT_READY":
      return {
        status: "ready",
        agentRef: action.agentRef,
        agentName: action.agentName,
        resolution: action.resolution,
        error: null,
      };

    case "ERROR":
      if (state.status === "submitting") {
        return {
          status: "needsEnvVars",
          agentRef: state.agentRef,
          agentId: state.agentId,
          agentName: state.agentName,
          missingVariables: state.missingVariables,
          pendingSignIns: state.pendingSignIns,
          error: action.error,
        };
      }
      return { ...state, error: action.error };

    case "CLEAR_ERROR":
      return { ...state, error: null };

    case "RESET":
      return INITIAL_STATE;

    default:
      return state;
  }
}
