/**
 * The outcome of reading a package and the closed vocabulary of findings.
 *
 * The shape is the server's `ConnectRunOutcome`: a discriminated union on
 * `ok`, with a closed `kind` union behind the failure arm, so a consumer
 * switches on kinds and the compiler closes the switch. An error refuses the
 * package; a warning never does. Both are `PluginFinding`s with the same
 * fields, so one renderer prints both.
 *
 * Two error postures meet here and the header of each module states which
 * applies. Where the open format tells a client to skip a broken component
 * and keep loading, Stigmer refuses the package: an installed agent that
 * quietly lacks a server or a sub-agent is worse than a refused install.
 * But the reader keeps scanning past a fatal finding so one run reports
 * every problem and an author fixes them in one pass.
 *
 * Every kind has exactly one sentence, in `messages.ts`, and the adversarial
 * suite has exactly one fixture per kind. Adding a kind means adding both.
 */

import type { PluginPackage } from "./types.js";

export type PluginErrorKind =
  // Manifests
  | "no-manifest"
  | "manifest-unreadable"
  | "manifest-schema-missing"
  | "manifest-schema-unsupported"
  | "manifest-name-missing"
  | "manifest-name-invalid"
  | "manifest-name-conflict"
  | "manifest-field-type"
  // Paths
  | "path-not-relative"
  | "path-escapes-root"
  | "path-glob-unsupported"
  | "path-uncontained"
  | "document-too-large"
  // Skills
  | "skill-frontmatter-missing"
  | "skill-frontmatter-unclosed"
  | "skill-frontmatter-unreadable"
  | "skill-name-invalid"
  | "skill-name-duplicate"
  // MCP configuration files
  | "mcp-config-unreadable"
  | "mcp-config-shape"
  | "mcp-config-schema-missing"
  | "mcp-config-schema-unsupported"
  | "mcp-config-field-unknown"
  // MCP server entries
  | "mcp-server-shape"
  | "mcp-server-type-missing"
  | "mcp-server-transport-unknown"
  | "mcp-server-type-ambiguous"
  | "mcp-server-type-unknown"
  | "mcp-server-field-unknown"
  | "mcp-server-field-type"
  | "mcp-server-url-missing"
  | "mcp-server-url-invalid"
  | "mcp-server-url-variable"
  | "mcp-server-command-missing"
  | "mcp-server-command-invalid"
  | "mcp-server-command-relative"
  | "mcp-server-plugin-root-reference"
  | "mcp-server-cwd-unsupported"
  | "mcp-server-env-literal"
  | "mcp-server-env-rename"
  | "mcp-server-name-duplicate"
  | "mcp-server-header-duplicate"
  | "mcp-server-header-invalid"
  // Sub-agents
  | "sub-agent-frontmatter-unreadable"
  | "sub-agent-instructions-short"
  | "sub-agent-name-duplicate"
  // Variables
  | "variable-name-invalid"
  // The ai.stigmer/ overlay
  | "overlay-server-unknown"
  | "overlay-document-unknown";

export type PluginWarningKind =
  | "manifest-field-unknown"
  | "manifest-extensions-invalid"
  | "path-missing"
  | "skill-name-defaulted"
  | "skill-name-differs-from-directory"
  | "skill-description-missing"
  | "mcp-config-field-ignored"
  | "mcp-server-sse-mapped"
  | "mcp-server-field-ignored"
  | "mcp-server-auth-ignored"
  | "variable-inferred"
  | "variable-unreferenced"
  | "variable-default-dropped"
  | "variable-type-narrowed"
  | "variable-option-dropped"
  | "sub-agent-name-defaulted"
  | "sub-agent-skill-unknown"
  | "sub-agent-model-unknown"
  | "sub-agent-field-ignored";

export type PluginFindingKind = PluginErrorKind | PluginWarningKind;

export interface PluginFinding {
  readonly kind: PluginFindingKind;
  /** The file, or the declared path, the finding is about. */
  readonly path?: string;
  /** The skill, server, sub-agent, variable or field the finding names. */
  readonly subject?: string;
  /** A second identifier the sentence needs (a field name, a parser's own message). */
  readonly detail?: string;
  /** The one sentence for this kind, from `messages.ts`. */
  readonly message: string;
}

/** What `read` needs to compose a finding: everything but the sentence. */
export type FindingContext = Pick<PluginFinding, "path" | "subject" | "detail">;

export type PluginReadOutcome =
  | { readonly ok: true; readonly plugin: PluginPackage; readonly warnings: readonly PluginFinding[] }
  | { readonly ok: false; readonly errors: readonly PluginFinding[]; readonly warnings: readonly PluginFinding[] };
