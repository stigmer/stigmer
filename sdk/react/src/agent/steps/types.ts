import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import type { EnvVarEntry } from "../../resource-creation/types.js";

export type { EnvVarEntry } from "../../resource-creation/types.js";

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
