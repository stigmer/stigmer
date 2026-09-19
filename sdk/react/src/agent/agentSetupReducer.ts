import type { EnvVarInput, ResourceRef } from "@stigmer/sdk";
import type { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { AgentEnvFormVariable } from "./AgentEnvForm.js";

// ---------------------------------------------------------------------------
// Sign-ins — an OAuth server of the agent's with no grant in the organization
// ---------------------------------------------------------------------------

/**
 * One MCP server the agent uses that authenticates by OAuth and has no
 * usable grant in the organization. The agent is not ready until each is
 * signed in: execution would start and fail at the first tool call, so the
 * composer asks first, the way it asks for a missing variable. Grants are
 * per organization today, so one colleague's sign-in serves everyone.
 */
export interface PendingSignIn {
  /** The server's reference, for the row's own read. */
  readonly ref: ResourceRef;
  /** The server's id, the key a sign-in completes under. */
  readonly id: string;
  /** The server's display name. */
  readonly name: string;
  /** The grant's health as the backend graded it; `NO_GRANT` when none exists. */
  readonly health: OAuthConnectionHealth;
}

// ---------------------------------------------------------------------------
// Resolution — the outcome of agent setup, consumed by session creation
// ---------------------------------------------------------------------------

/**
 * Describes how the agent was resolved, determining how the caller
 * should create the session and its first execution.
 *
 * - `"saved"` — Secrets were persisted to the user's personal
 *   environment and a personal agent instance was created (or already
 *   existed). Use `instanceId` with `createSession`.
 * - `"oneTime"` — Secrets were collected but **not** persisted. Pass
 *   `runtimeEnv` to `createExecution` for this run only.
 * - `"direct"` — The agent has no `env` declarations and needs no
 *   secrets. Create the session with `agentRef` directly.
 */
export type AgentResolution =
  | {
      /** Secrets were persisted to the user's personal environment. */
      readonly mode: "saved";
      /** ID of the personal agent instance to use for session creation. */
      readonly instanceId: string;
    }
  | {
      /** Secrets were collected but not persisted — pass to execution only. */
      readonly mode: "oneTime";
      /** Collected secrets to forward as execution-scoped runtime env vars. */
      readonly runtimeEnv: Record<string, EnvVarInput>;
    }
  | {
      /** The agent has no `env` declarations and needs no secrets. */
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
       * environment variables it declares, sign-ins to OAuth servers it
       * uses, or both. Either list may be empty while the other is not.
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
      /** OAuth servers of the agent's that nobody in the organization has signed in to. */
      readonly pendingSignIns: readonly PendingSignIn[];
    }
  | {
      /** Environment variables are being persisted or the instance is being provisioned. */
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
      /** OAuth servers of the agent's that nobody in the organization has signed in to. */
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
      /** The server's id. */
      readonly id: string;
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
      /** Begin persisting env vars or creating an agent instance. */
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
      const pendingSignIns = state.pendingSignIns.filter((signIn) => signIn.id !== action.id);
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
