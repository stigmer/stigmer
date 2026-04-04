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
  | { readonly mode: "saved"; readonly instanceId: string }
  | { readonly mode: "oneTime"; readonly runtimeEnv: Record<string, EnvVarInput> }
  | { readonly mode: "direct" };

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
  | { readonly status: "idle" }
  | { readonly status: "resolving"; readonly agentRef: ResourceRef }
  | {
      readonly status: "needsEnvVars";
      readonly agentRef: ResourceRef;
      readonly agentId: string;
      readonly agentName: string;
      readonly missingVariables: AgentEnvFormVariable[];
    }
  | {
      readonly status: "submitting";
      readonly agentRef: ResourceRef;
      readonly agentId: string;
      readonly agentName: string;
      readonly missingVariables: AgentEnvFormVariable[];
    }
  | {
      readonly status: "ready";
      readonly agentRef: ResourceRef;
      readonly agentName: string;
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
  readonly error: Error | null;
};

// ---------------------------------------------------------------------------
// Result types — imperative return values from hook actions
// ---------------------------------------------------------------------------

/**
 * Result returned by {@link useAgentSetup.resolveAgent}.
 *
 * - `"ready"` — the agent can be used immediately.
 * - `"needsEnvVars"` — the agent requires environment variables
 *   the user has not yet provided.
 */
export type AgentSetupResult =
  | {
      readonly status: "ready";
      readonly agentRef: ResourceRef;
      readonly agentName: string;
      readonly resolution: AgentResolution;
    }
  | {
      readonly status: "needsEnvVars";
      readonly agentRef: ResourceRef;
      readonly agentName: string;
      readonly missingVariables: AgentEnvFormVariable[];
    };

/** Result returned by {@link useAgentSetup.submitEnvVars} — always `"ready"`. */
export type AgentSetupReadyResult = AgentSetupResult & { readonly status: "ready" };

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Action union for the agent setup state machine managed by {@link agentSetupReducer}. */
export type AgentSetupAction =
  | { readonly type: "RESOLVE_START"; readonly agentRef: ResourceRef }
  | {
      readonly type: "RESOLVE_NEEDS_ENV";
      readonly agentRef: ResourceRef;
      readonly agentId: string;
      readonly agentName: string;
      readonly missingVariables: AgentEnvFormVariable[];
    }
  | {
      readonly type: "RESOLVE_READY";
      readonly agentRef: ResourceRef;
      readonly agentName: string;
      readonly resolution: AgentResolution;
    }
  | {
      readonly type: "POOL_RESOLVE";
      readonly missingVariables: AgentEnvFormVariable[];
    }
  | { readonly type: "SUBMIT_START" }
  | {
      readonly type: "SUBMIT_READY";
      readonly agentRef: ResourceRef;
      readonly agentName: string;
      readonly resolution: AgentResolution;
    }
  | { readonly type: "ERROR"; readonly error: Error }
  | { readonly type: "CLEAR_ERROR" }
  | { readonly type: "RESET" };

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
