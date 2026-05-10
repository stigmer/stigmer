import type { EnvVarEntry, KeyValueEntry } from "../../resource-creation/types";

export type { EnvVarEntry, KeyValueEntry } from "../../resource-creation/types";

/**
 * Accumulated form state for the MCP server creation wizard.
 *
 * Each field corresponds to a property on `McpServerInput`. The wizard
 * builds this incrementally across steps, then transforms it into
 * a `McpServerInput` for submission on the final step.
 */
export interface McpServerWizardData {
  // --- Step 1: Identity & Transport ---
  /** MCP server display name (required). */
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
  /** Selected transport type. */
  readonly transportType: "http" | "stdio";
  /** HTTP server URL. */
  readonly httpUrl: string;
  /** HTTP custom headers. */
  readonly httpHeaders: KeyValueEntry[];
  /** HTTP request timeout in seconds (0 = default). */
  readonly httpTimeoutSeconds: number;
  /** Stdio command to execute. */
  readonly stdioCommand: string;
  /** Stdio command arguments (space-separated string, split on submit). */
  readonly stdioArgs: string;
  /** Stdio working directory. */
  readonly stdioWorkingDir: string;

  // --- Step 2: Environment & Auth ---
  /** Environment variable declarations. */
  readonly env: EnvVarEntry[];
  /** Whether OAuth auth configuration is enabled. */
  readonly authEnabled: boolean;
  /** OAuth app reference — organization slug. */
  readonly authOAuthAppOrg: string;
  /** OAuth app reference — app slug. */
  readonly authOAuthAppSlug: string;
  /** Env var that receives the OAuth token. */
  readonly authTargetEnvVar: string;
  /** Token lifetime hint (e.g. "1h", "never"). */
  readonly authTokenLifetimeHint: string;
  /** OAuth scope hints (comma-separated, split on submit). */
  readonly authScopeHints: string;
  /** OAuth discovery URL. */
  readonly authDiscoveryUrl: string;
}

/** Creates the initial empty wizard data. */
export function createInitialMcpServerWizardData(): McpServerWizardData {
  return {
    name: "",
    slug: "",
    slugTouched: false,
    description: "",
    iconUrl: "",
    visibility: "private",
    transportType: "http",
    httpUrl: "",
    httpHeaders: [],
    httpTimeoutSeconds: 0,
    stdioCommand: "",
    stdioArgs: "",
    stdioWorkingDir: "",
    env: [],
    authEnabled: false,
    authOAuthAppOrg: "",
    authOAuthAppSlug: "",
    authTargetEnvVar: "",
    authTokenLifetimeHint: "",
    authScopeHints: "",
    authDiscoveryUrl: "",
  };
}
