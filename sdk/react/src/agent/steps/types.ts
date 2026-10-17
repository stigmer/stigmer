import type { AgentMcpServerInput, ResourceRef } from "@stigmer/client";
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
  /** System prompt / instructions (the agent's core content). */
  readonly instructions: string;

  // --- Step 2: Capabilities ---
  /** Plugins the agent uses, each whole: its skills, agents, hooks and MCP servers. */
  readonly plugins: ResourceRef[];
  /**
   * MCP servers the agent writes itself, each by name, URL and headers.
   * Only an organization's admins may save an agent with one; the step
   * offers them to no one else.
   */
  readonly mcpServers: AgentMcpServerInput[];
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
    instructions: "",
    plugins: [],
    mcpServers: [],
    skillRefs: [],
    env: [],
  };
}
