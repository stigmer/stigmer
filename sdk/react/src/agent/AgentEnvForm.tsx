"use client";

import type { EnvVarInput } from "../vault/types.js";
import {
  EnvVarForm,
  type EnvVarFormVariable,
  type EnvVarFormProps,
} from "../vault/EnvVarForm.js";

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
  /** Called with the collected values (for My vault) when the user submits the form. */
  readonly onSubmit: (values: Record<string, EnvVarInput>) => void;
  /** Called when the user clicks the back/cancel button. */
  readonly onCancel?: () => void;
  /** When true, the submit button shows a spinner and inputs are disabled. */
  readonly isSubmitting?: boolean;
  /** Prevents interaction with all form inputs when `true`. */
  readonly disabled?: boolean;
  /**
   * Lookup function for pre-filling fields from another source the host
   * holds. Passed through to {@link EnvVarForm}.
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
 * contextual description. All rendering and validation is delegated to
 * `EnvVarForm`. It offers no save toggle: a value typed for an agent is
 * saved in My vault, since a conversation keeps no values of its own.
 *
 * @example
 * ```tsx
 * <AgentEnvForm
 *   agentName="GitHub Reviewer"
 *   variables={[
 *     { key: "GITHUB_TOKEN", isSecret: true, description: "Personal access token" },
 *     { key: "REPO_OWNER", isSecret: false },
 *   ]}
 *   onSubmit={(values) => saveToMyVault(values)}
 *   onCancel={() => console.log("cancelled")}
 * />
 * ```
 */
export function AgentEnvForm({ agentName, ...rest }: AgentEnvFormProps) {
  return (
    <EnvVarForm
      title={agentName}
      description="Enter required credentials to use this agent. They are saved in My vault."
      ariaLabel={`Configure ${agentName}`}
      {...rest}
    />
  );
}
