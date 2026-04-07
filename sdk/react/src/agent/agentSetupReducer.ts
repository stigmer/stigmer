import type { EnvVarInput, ResourceRef } from "@stigmer/sdk";
import type { AgentEnvFormVariable } from "./AgentEnvForm";

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
 * - `"direct"` — The agent has no `env_spec` and needs no secrets.
 *   Create the session with `agentRef` directly.
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
      /** The agent has no `env_spec` and needs no secrets. */
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
      /** The agent requires environment variables that the user has not yet provided. */
      readonly status: "needsEnvVars";
      /** Reference to the agent being set up. */
      readonly agentRef: ResourceRef;
      /** Server-assigned ID of the agent blueprint. */
      readonly agentId: string;
      /** Display name of the agent. */
      readonly agentName: string;
      /** Environment variables the user must provide before proceeding. */
      readonly missingVariables: AgentEnvFormVariable[];
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
      /** The agent requires env vars the user has not yet provided. */
      readonly status: "needsEnvVars";
      /** Reference to the agent being set up. */
      readonly agentRef: ResourceRef;
      /** Display name of the agent. */
      readonly agentName: string;
      /** Environment variables the user must provide before proceeding. */
      readonly missingVariables: AgentEnvFormVariable[];
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
        error: null,
      };

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

      if (action.missingVariables.length === 0) {
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
