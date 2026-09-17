/**
 * The one sentence for every finding kind, and the collector that composes
 * findings from a kind and its context.
 *
 * Copy lives here and nowhere else: the CLI and the server print these
 * sentences verbatim, so a plugin refused offline is refused by the server
 * with the same words, and a consumer never composes refusal copy of its
 * own. Every sentence says what is wrong and, where the fix is not obvious,
 * what Stigmer needs instead. Identifiers are single-quoted (the ts-server
 * quoting rule for new copy). The `Record` types are exhaustive over the
 * kind unions, so a kind without a sentence does not compile.
 */

import type { Finding, FindingContext, PluginErrorKind, PluginFindingKind, PluginWarningKind } from "./outcome.js";

/** The canonical `$schema` identifiers the open format pins per version. */
export const AGENT_PLUGINS_MANIFEST_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGINS_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

/** The four manifest locations, in the precedence the reader applies when there is no root manifest. */
export const MANIFEST_LOCATIONS = {
  "agent-plugins": "plugin.json",
  claude: ".claude-plugin/plugin.json",
  cursor: ".cursor-plugin/plugin.json",
  codex: ".codex-plugin/plugin.json",
} as const;

/** Single-quote an identifier for a sentence (the ts-server quoting rule); shared with the marketplace vocabulary. */
export const q = (value: string | undefined): string => `'${value ?? ""}'`;
/** ` in '<path>'`, or nothing when the finding names no file. */
export const at = (path: string | undefined): string => (path === undefined ? "" : ` in ${q(path)}`);

export type Sentence = (ctx: FindingContext) => string;

const ERROR_MESSAGES: Record<PluginErrorKind, Sentence> = {
  "no-manifest": () =>
    `no plugin manifest found: expected one of ${Object.values(MANIFEST_LOCATIONS)
      .map((p) => q(p))
      .join(", ")}`,
  "manifest-unreadable": (c) => `manifest ${q(c.path)} is not valid JSON: ${c.detail ?? "parse error"}`,
  "manifest-schema-missing": (c) =>
    `manifest ${q(c.path)} is missing the required '$schema' field; an Agent Plugins manifest declares ${q(AGENT_PLUGINS_MANIFEST_SCHEMA)}`,
  "manifest-schema-unsupported": (c) =>
    `manifest ${q(c.path)} declares an unsupported '$schema' ${q(c.detail)}; this reader supports ${q(AGENT_PLUGINS_MANIFEST_SCHEMA)}`,
  "manifest-name-missing": (c) => `manifest ${q(c.path)} is missing the required 'name' field`,
  "manifest-name-invalid": (c) =>
    `plugin name ${q(c.subject)}${at(c.path)} is invalid: 1 to 64 characters of lowercase letters, digits, hyphens and periods, starting and ending alphanumeric, with no '--' or '..'`,
  "manifest-name-conflict": (c) =>
    `manifests disagree on the plugin name: ${q(c.subject)} in ${q(c.path)} versus ${c.detail ?? "another manifest"}`,
  "manifest-field-type": (c) => `field ${q(c.subject)}${at(c.path)} has the wrong type: expected ${c.detail ?? "a different type"}`,

  "path-not-relative": (c) =>
    `path ${q(c.subject)}${at(c.path)} must be plugin-relative and begin with './'`,
  "path-escapes-root": (c) => `path ${q(c.subject)}${at(c.path)} escapes the plugin root`,
  "path-glob-unsupported": (c) =>
    `path ${q(c.subject)}${at(c.path)} is a glob pattern; declare directories and files by path`,
  "path-uncontained": (c) => `the reader listed a path outside the plugin root: ${q(c.path)}`,
  "document-too-large": (c) =>
    `${q(c.path)} is ${c.subject ?? "too many"} bytes, over the ${c.detail ?? ""}-byte limit for this kind of document`,

  "skill-frontmatter-missing": (c) => `${q(c.path)} must start with YAML frontmatter ('---')`,
  "skill-frontmatter-unclosed": (c) => `${q(c.path)} frontmatter is not closed (missing the closing '---')`,
  "skill-frontmatter-unreadable": (c) => `${q(c.path)} frontmatter is not valid YAML: ${c.detail ?? "parse error"}`,
  "skill-name-invalid": (c) =>
    `skill name ${q(c.subject)}${at(c.path)} is invalid: lowercase letters, digits and hyphens, optionally dot-scoped, with every segment alphanumeric`,
  "skill-name-duplicate": (c) => `skill name ${q(c.subject)} appears more than once (again${at(c.path)})`,

  "mcp-config-unreadable": (c) => `MCP configuration ${q(c.path)} is not valid JSON: ${c.detail ?? "parse error"}`,
  "mcp-config-shape": (c) => `MCP configuration ${q(c.path)} must be an object with an 'mcpServers' object`,
  "mcp-config-schema-missing": (c) =>
    `MCP configuration ${q(c.path)} is missing the required '$schema' field; an Agent Plugins configuration declares ${q(AGENT_PLUGINS_MCP_SCHEMA)}`,
  "mcp-config-schema-unsupported": (c) =>
    `MCP configuration ${q(c.path)} declares an unsupported '$schema' ${q(c.detail)}; this reader supports ${q(AGENT_PLUGINS_MCP_SCHEMA)}`,
  "mcp-config-field-unknown": (c) =>
    `MCP configuration ${q(c.path)} has an unexpected top-level field ${q(c.subject)}; only '$schema' and 'mcpServers' are allowed`,

  "mcp-server-shape": (c) => `MCP server ${q(c.subject)}${at(c.path)} must be an object`,
  "mcp-server-type-missing": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} is missing the 'type' field the Agent Plugins format requires ('stdio', 'streamable-http' or 'sse')`,
  "mcp-server-transport-unknown": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} has no 'type' and neither a 'command' nor a 'url' to infer it from`,
  "mcp-server-type-ambiguous": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} declares both 'command' and 'url'; a server is either stdio or HTTP`,
  "mcp-server-type-unknown": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} has an unknown 'type' ${q(c.detail)}; expected 'stdio', 'http', 'streamable-http' or 'sse'`,
  "mcp-server-field-unknown": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} has a field ${q(c.detail)} that its transport does not define`,
  "mcp-server-field-type": (c) => `MCP server ${q(c.subject)}${at(c.path)} field ${q(c.detail)} has the wrong type`,
  "mcp-server-url-missing": (c) => `MCP server ${q(c.subject)}${at(c.path)} is missing the 'url' its HTTP transport requires`,
  "mcp-server-url-invalid": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} has an invalid 'url' ${q(c.detail)}: expected an absolute HTTPS URL (HTTP only for localhost) with no user information or fragment`,
  "mcp-server-url-variable": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} has a variable in its 'url'; Stigmer sends the URL as written, so write the URL out and put variables in 'headers'`,
  "mcp-server-command-missing": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} is missing the 'command' its stdio transport requires`,
  "mcp-server-command-invalid": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} has a 'command' that is not a single executable name; put arguments in 'args'`,
  "mcp-server-command-relative": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} runs a command bundled in the plugin ${q(c.detail)}; Stigmer runs only commands on the runner's PATH (for example 'npx' or 'uvx')`,
  "mcp-server-plugin-root-reference": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} references the plugin's own files through ${q(c.detail)}; Stigmer does not mount plugin files into the runner`,
  "mcp-server-cwd-unsupported": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} sets a working directory; Stigmer does not mount plugin files, so a bundled directory cannot be reached`,
  "mcp-server-env-literal": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} sets environment variable ${q(c.detail)} to a literal value; Stigmer passes declared variables by name, so write ${q(`${c.detail ?? "KEY"}: "\${${c.detail ?? "KEY"}}"`)} and declare the variable`,
  "mcp-server-env-rename": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} maps environment variable ${q(c.detail)} to a differently named variable; Stigmer passes declared variables by name, so use the same name on both sides`,
  "mcp-server-name-duplicate": (c) => `MCP server name ${q(c.subject)} appears more than once (again${at(c.path)})`,
  "mcp-server-header-duplicate": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} declares header ${q(c.detail)} more than once (header names are case-insensitive)`,
  "mcp-server-header-invalid": (c) => `MCP server ${q(c.subject)}${at(c.path)} has an invalid header name ${q(c.detail)}`,

  "sub-agent-frontmatter-unreadable": (c) => `${q(c.path)} frontmatter is not valid YAML: ${c.detail ?? "parse error"}`,
  "sub-agent-instructions-short": (c) =>
    `sub-agent ${q(c.subject)}${at(c.path)} has instructions under ${c.detail ?? ""} characters; the body of the file is the sub-agent's prompt`,
  "sub-agent-name-duplicate": (c) => `sub-agent name ${q(c.subject)} appears more than once (again${at(c.path)})`,

  "variable-name-invalid": (c) =>
    `variable name ${q(c.subject)}${at(c.path)} is invalid: an environment variable name is letters, digits and underscores, not starting with a digit`,

  "overlay-server-unknown": (c) =>
    `${q(c.path)} overlays MCP server ${q(c.subject)}, which the plugin does not declare`,
  "overlay-document-unknown": (c) =>
    `${q(c.path)} is not a document Stigmer reads; the 'ai.stigmer/' folder holds 'agent.yaml', 'workflows/<name>.yaml' and 'mcp-servers/<server>.yaml'`,
};

const WARNING_MESSAGES: Record<PluginWarningKind, Sentence> = {
  "manifest-field-unknown": (c) => `manifest ${q(c.path)} has an unknown field ${q(c.subject)}, ignored`,
  "manifest-extensions-invalid": (c) => `manifest ${q(c.path)} has an 'extensions' field that is not an object, ignored`,
  "path-missing": (c) => `path ${q(c.subject)} declared${at(c.path)} does not exist in the plugin`,
  "skill-name-defaulted": (c) =>
    `${q(c.path)} has no 'name' in its frontmatter; the skill is named after its directory, ${q(c.subject)}`,
  "skill-name-differs-from-directory": (c) =>
    `skill ${q(c.subject)}${at(c.path)} is named differently from its directory ${q(c.detail)}`,
  "skill-description-missing": (c) => `skill ${q(c.subject)}${at(c.path)} has no 'description'`,
  "mcp-config-field-ignored": (c) =>
    `MCP configuration ${q(c.path)} has a top-level field ${q(c.subject)} Stigmer does not read, ignored`,
  "mcp-server-sse-mapped": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} declares the legacy 'sse' transport; Stigmer connects over Streamable HTTP and falls back to SSE only when the server rejects it`,
  "mcp-server-field-ignored": (c) => `MCP server ${q(c.subject)}${at(c.path)} has a field ${q(c.detail)} Stigmer does not read, ignored`,
  "mcp-server-auth-ignored": (c) =>
    `MCP server ${q(c.subject)}${at(c.path)} has an 'auth' block Stigmer does not read; OAuth for a server is declared in 'ai.stigmer/mcp-servers/${c.subject ?? "<server>"}.yaml'`,
  "variable-inferred": (c) =>
    `variable ${q(c.subject)} is referenced by MCP server ${q(c.detail)} but not declared; it is declared as a required secret`,
  "variable-unreferenced": (c) => `variable ${q(c.subject)}${at(c.path)} is declared but no MCP server references it`,
  "variable-default-dropped": (c) =>
    `variable ${q(c.subject)}${at(c.path)} has a default value, which Stigmer does not carry; the user supplies the value`,
  "variable-type-narrowed": (c) =>
    `variable ${q(c.subject)}${at(c.path)} is typed ${q(c.detail)}; Stigmer variables are strings`,
  "variable-option-dropped": (c) =>
    `variable ${q(c.subject)}${at(c.path)} has a ${q(c.detail)} constraint, which Stigmer does not carry`,
  "sub-agent-name-defaulted": (c) =>
    `${q(c.path)} has no 'name' in its frontmatter; the sub-agent is named after the file, ${q(c.subject)}`,
  "sub-agent-skill-unknown": (c) =>
    `sub-agent ${q(c.subject)}${at(c.path)} asks for skill ${q(c.detail)}, which the plugin does not ship`,
  "sub-agent-model-unknown": (c) =>
    `sub-agent ${q(c.subject)}${at(c.path)} names model ${q(c.detail)}, which Stigmer cannot map; the sub-agent runs on the session's model`,
  "sub-agent-field-ignored": (c) => `sub-agent ${q(c.subject)}${at(c.path)} has a field ${q(c.detail)} Stigmer does not read, ignored`,
};

export function errorMessage(kind: PluginErrorKind, ctx: FindingContext): string {
  return ERROR_MESSAGES[kind](ctx);
}

export function warningMessage(kind: PluginWarningKind, ctx: FindingContext): string {
  return WARNING_MESSAGES[kind](ctx);
}

/** True for the kinds that refuse a package. */
export function isErrorKind(kind: PluginFindingKind): kind is PluginErrorKind {
  return kind in ERROR_MESSAGES;
}

/** A sentence table over a closed kind vocabulary; `Record` so a kind without a sentence does not compile. */
export type SentenceTable<K extends string> = Readonly<Record<K, Sentence>>;

/**
 * Collects findings while a read proceeds. A reader never throws on the
 * content it reads: every problem becomes a finding here, and the read
 * continues so the outcome carries them all. Generic over the two kind
 * vocabularies so the plugin reader and the marketplace reader share one
 * collector and one finding shape while each owns its sentences.
 */
export class FindingCollector<E extends string, W extends string> {
  readonly errors: Finding<E>[] = [];
  readonly warnings: Finding<W>[] = [];

  constructor(
    private readonly errorSentences: SentenceTable<E>,
    private readonly warningSentences: SentenceTable<W>,
  ) {}

  error(kind: E, ctx: FindingContext = {}): void {
    this.errors.push(compose(kind, ctx, this.errorSentences[kind](ctx)));
  }

  warn(kind: W, ctx: FindingContext = {}): void {
    this.warnings.push(compose(kind, ctx, this.warningSentences[kind](ctx)));
  }
}

/** The plugin reader's collector, bound to the plugin vocabulary. */
export class Findings extends FindingCollector<PluginErrorKind, PluginWarningKind> {
  constructor() {
    super(ERROR_MESSAGES, WARNING_MESSAGES);
  }
}

// Optional fields are omitted rather than set to `undefined` so a finding
// serialises to JSON without `null`s and compares structurally in tests.
function compose<K extends string>(kind: K, ctx: FindingContext, message: string): Finding<K> {
  return {
    kind,
    ...(ctx.path !== undefined && { path: ctx.path }),
    ...(ctx.subject !== undefined && { subject: ctx.subject }),
    ...(ctx.detail !== undefined && { detail: ctx.detail }),
    message,
  };
}
