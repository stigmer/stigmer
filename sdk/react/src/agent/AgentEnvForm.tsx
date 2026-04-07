"use client";

import type { EnvVarInput } from "@stigmer/sdk";
import {
  EnvVarForm,
  type EnvVarFormVariable,
  type EnvVarFormSubmitOptions,
  type EnvVarFormProps,
} from "../environment/EnvVarForm";

// ---------------------------------------------------------------------------
// Backward-compatible type aliases
// ---------------------------------------------------------------------------

/**
 * Describes a single environment variable that the form should collect.
 *
 * @deprecated Use {@link EnvVarFormVariable} from `@stigmer/react` instead.
 *   This alias is kept for backward compatibility and will be removed in
 *   a future major version.
 */
export type AgentEnvFormVariable = EnvVarFormVariable;

/**
 * Options reported by the form alongside the collected values.
 *
 * @deprecated Use {@link EnvVarFormSubmitOptions} from `@stigmer/react` instead.
 *   This alias is kept for backward compatibility and will be removed in
 *   a future major version.
 */
export type AgentEnvFormSubmitOptions = EnvVarFormSubmitOptions;

// ---------------------------------------------------------------------------
// Props (unchanged public shape)
// ---------------------------------------------------------------------------

/** Props for {@link AgentEnvForm}. */
export interface AgentEnvFormProps {
  /** Agent display name shown in the form header. */
  readonly agentName: string;
  /**
   * Variables to collect. Each entry renders one input field, in order.
   * Must contain at least one variable.
   */
  readonly variables: AgentEnvFormVariable[];
  /**
   * Called with the collected values and the save toggle state when
   * the user submits the form.
   */
  readonly onSubmit: (
    values: Record<string, EnvVarInput>,
    options: AgentEnvFormSubmitOptions,
  ) => void;
  /** Called when the user clicks the back/cancel button. */
  readonly onCancel?: () => void;
  /** When true, the submit button shows a spinner and inputs are disabled. */
  readonly isSubmitting?: boolean;
  /** Prevents interaction with all form inputs when `true`. */
  readonly disabled?: boolean;
  /**
   * Initial state of the "Save for future runs" toggle.
   * Platform builders can override this to match their default
   * secret-persistence policy.
   * @default true
   */
  readonly defaultSaveForFuture?: boolean;
  /**
   * When `true`, the save toggle is hidden and the form always uses
   * `defaultSaveForFuture` as the submit value. Useful for platform
   * builders who want to enforce a single persistence policy.
   * @default false
   */
  readonly hideSaveToggle?: boolean;
  /**
   * Lookup function for pre-filling fields from the session env pool.
   * Passed through to {@link EnvVarForm}.
   */
  readonly poolValues?: EnvVarFormProps["poolValues"];
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Compact form that collects environment variable values for an agent.
 *
 * This is a thin wrapper around {@link EnvVarForm} that provides
 * agent-specific defaults: the agent name as the form title, and a
 * contextual description. All rendering, validation, and toggle
 * behavior is delegated to `EnvVarForm`.
 *
 * @example
 * ```tsx
 * <AgentEnvForm
 *   agentName="GitHub Reviewer"
 *   variables={[
 *     { key: "GITHUB_TOKEN", isSecret: true, description: "Personal access token" },
 *     { key: "REPO_OWNER", isSecret: false },
 *   ]}
 *   onSubmit={(values, { saveForFuture }) => {
 *     if (saveForFuture) saveToEnvironment(values);
 *     else useAsRuntimeEnv(values);
 *   }}
 *   onCancel={() => console.log("cancelled")}
 * />
 * ```
 */
export function AgentEnvForm({ agentName, ...rest }: AgentEnvFormProps) {
  return (
    <EnvVarForm
      title={agentName}
      description="Enter required credentials to use this agent."
      ariaLabel={`Configure ${agentName}`}
      {...rest}
    />
  );
}
