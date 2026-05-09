import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";

/**
 * Accumulated form state for the agent creation wizard.
 *
 * Each field corresponds to a property on `AgentInput`. The wizard
 * builds this incrementally across steps, then transforms it into
 * an `AgentInput` for submission on the final step.
 */
export interface AgentWizardData {
  // --- Step 1: Identity & Instructions ---
  /** Agent display name (required). */
  readonly name: string;
  /** URL-friendly slug (auto-derived from name, editable). */
  readonly slug: string;
  /** Whether the slug has been manually edited by the user. */
  readonly slugTouched: boolean;
  /** Short description (optional). */
  readonly description: string;
  /** Icon URL (optional). */
  readonly iconUrl: string;
  /** Resource visibility. */
  readonly visibility: "private" | "public";
  /** System prompt / instructions (the agent's core content). */
  readonly instructions: string;

  // --- Step 2: Capabilities ---
  /** MCP server usages with tool configuration. */
  readonly mcpServerUsages: McpServerUsageInput[];
  /** Skill references. */
  readonly skillRefs: ResourceRef[];
  /** Environment variable declarations. */
  readonly env: EnvVarEntry[];
}

/** A single env var declaration entry in the wizard form. */
export interface EnvVarEntry {
  /** Environment variable name (e.g. GITHUB_TOKEN). */
  readonly key: string;
  /** Human-readable description. */
  readonly description: string;
  /** Whether this variable holds a secret value. */
  readonly isSecret: boolean;
  /** Whether the variable is optional. */
  readonly optional: boolean;
}

/** Creates the initial empty wizard data. */
export function createInitialWizardData(): AgentWizardData {
  return {
    name: "",
    slug: "",
    slugTouched: false,
    description: "",
    iconUrl: "",
    visibility: "private",
    instructions: "",
    mcpServerUsages: [],
    skillRefs: [],
    env: [],
  };
}
