/**
 * The normalised description of a plugin: what Stigmer would install from a
 * package, whatever dialect the package was written in.
 *
 * These are the library's own plain types, deliberately not the protos. The
 * library describes the plugin FORMAT; the server maps this description onto
 * resources when it installs, and the CLI validates offline without pulling
 * the resource schemas in for a parse. Field names still mirror the protos
 * (`SubAgent.name/description/instructions/model_override`,
 * `EnvVarDeclaration.is_secret/description/optional`, the
 * `McpServerSpec` `stdio`/`http` variants) so the server's mapping is one
 * function per kind and a proto rename is a visible edit here.
 *
 * Every path in this description is plugin-relative, POSIX, with no leading
 * `./`: one path vocabulary for the whole package, whichever reader produced
 * the files.
 */

/** The manifest that gave the plugin its identity. */
export type PluginDialect = "agent-plugins" | "claude" | "cursor" | "codex";

export interface PluginAuthor {
  readonly name?: string;
  readonly email?: string;
  readonly url?: string;
}

/**
 * One skill: a directory holding `SKILL.md`. `files` lists every file under
 * `dir` (plugin-relative), so an installer can build the skill's own archive
 * without walking the package again; `SKILL.md` is among them. For a plugin
 * that IS a single skill (a root `SKILL.md`, the Claude Code layout) `dir` is
 * the empty string and `files` is the whole package.
 */
export interface PluginSkill {
  readonly name: string;
  readonly description?: string;
  readonly dir: string;
  readonly files: readonly string[];
}

/**
 * One MCP server in the shape `McpServerSpec` takes. `env` is the list of
 * variable NAMES the server references (in headers, arguments or its stdio
 * environment), which is what `McpServerSpec.env` declares; values never
 * appear anywhere in this library.
 */
export type PluginMcpServer =
  | {
      readonly name: string;
      readonly transport: "http";
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly env: readonly string[];
    }
  | {
      readonly name: string;
      readonly transport: "stdio";
      readonly command: string;
      readonly args: readonly string[];
      readonly env: readonly string[];
    };

/**
 * A dialect's `model` value classified into an alias the server resolves
 * against its model registry. The library never names a Stigmer model id:
 * the runner drops a sub-agent whose `model_override` is unregistered, so an
 * id the parser could not verify would silently remove sub-agents at run
 * time. `inherit` and an absent `model` both mean "no override"; `unknown`
 * carries the raw text for the server's warning.
 */
export type ModelAlias = "fast" | "sonnet" | "opus" | "haiku" | "inherit" | "unknown";

export interface ModelHint {
  readonly raw: string;
  readonly alias: ModelAlias;
}

/** One sub-agent file (`agents/*.md`) in the shape `SubAgent` takes. */
export interface PluginSubAgent {
  readonly name: string;
  readonly description?: string;
  readonly instructions: string;
  /** Plugin skill names this sub-agent asked for (Claude `skills:`), resolved to `skill_refs` by the installer. */
  readonly skillNames: readonly string[];
  readonly modelHint?: ModelHint;
  /**
   * Claude's "only these tools" list (`tools:`), entries as written. Absent
   * means no list; an empty list is kept apart from absence so the installer
   * can tell "no list" from a list it emptied.
   */
  readonly tools?: readonly string[];
  /** Claude's "never these tools" list (`disallowedTools:`), entries as written. */
  readonly disallowedTools?: readonly string[];
  /** The agent file, for messages that point at it. */
  readonly path: string;
}

/**
 * The hook format a plugin's hooks are written in, which decides the JSON a
 * hook reads and how its answer is parsed (`HookFormat`). Codex plugin hooks
 * are written in Claude Code's format.
 */
export type HookFormat = "claude-code" | "cursor";

/** One command a hook runs, in the shape `HookHandler` takes. */
export interface PluginHookHandler {
  /** As written; placeholders such as `${CLAUDE_PLUGIN_ROOT}` are kept verbatim. */
  readonly command: string;
  /** Claude's exec form; when non-empty the command runs without a shell. */
  readonly args: readonly string[];
  /** Seconds, rounded up; absent means the format's default. */
  readonly timeoutSeconds?: number;
  /** Claude's `if`, a permission rule such as `Bash(git push *)`. */
  readonly condition?: string;
  /** Cursor's `failClosed`. */
  readonly failClosed: boolean;
}

/** One event, its matcher as written, and the handlers that run, in the shape `HookGroup` takes. */
export interface PluginHookGroup {
  /** Spelled as the format spells it (`PreToolUse`, `beforeShellExecution`). */
  readonly event: string;
  /** As written; empty or `*` matches every call. */
  readonly matcher: string;
  readonly handlers: readonly PluginHookHandler[];
}

/**
 * The plugin's tool-call hooks Stigmer reads, in the shape `HookConfig` takes.
 * Only events and handlers Stigmer runs are here; everything else the
 * plugin's hooks files carry is named in the read's warnings.
 */
export interface PluginHooks {
  readonly format: HookFormat;
  readonly groups: readonly PluginHookGroup[];
}

/**
 * One variable in the shape `EnvVarDeclaration` takes. `declaredBy` says
 * where the declaration came from: a Cursor `variables` schema, a Claude
 * `userConfig` entry, or inference from an undeclared `${VAR}` reference,
 * which the library declares as a required secret because the runner hands a
 * server only the variables its spec declares.
 */
export interface PluginVariable {
  readonly name: string;
  readonly description?: string;
  readonly isSecret: boolean;
  readonly optional: boolean;
  readonly declaredBy: "cursor" | "claude" | "inferred";
}

/**
 * A document under `ai.stigmer/`, handed over as bytes. The library locates
 * these and checks they name things the plugin declares; parsing them into
 * resources is the installer's, where the resource schemas live.
 */
export interface OverlayDocument {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface OverlayNamedDocument extends OverlayDocument {
  /** The file stem, the workflow's name. */
  readonly name: string;
}

export interface OverlayServerDocument extends OverlayDocument {
  /** The MCP server (a `mcpServers` key) this overlay layers over. */
  readonly server: string;
}

export interface StigmerOverlay {
  /** `ai.stigmer/agent.yaml`: the Agent that replaces the composed default. */
  readonly agent?: OverlayDocument;
  /** `ai.stigmer/workflows/<name>.yaml`. */
  readonly workflows: readonly OverlayNamedDocument[];
  /** `ai.stigmer/mcp-servers/<server>.yaml`: the richer `McpServer` overlay. */
  readonly mcpServers: readonly OverlayServerDocument[];
}

/**
 * The component kinds Stigmer reads past without carrying. Recorded once per
 * component (a directory, a file or a manifest field), never per file, so
 * an author sees "hooks/ is not installed" once.
 */
export type IgnoredComponentKind =
  | "agents"
  | "apps"
  | "assets"
  | "bin"
  | "canvases"
  | "channels"
  | "commands"
  | "default-enabled"
  | "dependencies"
  | "evals"
  | "extension"
  | "logo"
  | "lsp-servers"
  | "min-client-versions"
  | "monitors"
  | "output-styles"
  | "rules"
  | "settings"
  | "themes"
  | "workflows";

export interface IgnoredComponent {
  readonly kind: IgnoredComponentKind;
  /** The directory, file, or `<manifest path>#<field>` the component came from. */
  readonly path: string;
}

/** What Stigmer would install from the package. */
export interface PluginPackage {
  readonly name: string;
  /** As written; Semantic Versioning is recommended by the format, not enforced. */
  readonly version?: string;
  readonly description?: string;
  readonly author?: PluginAuthor;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly keywords: readonly string[];
  readonly dialect: PluginDialect;
  /** Every manifest the reader consulted, identity first. */
  readonly manifestsFound: readonly string[];
  readonly skills: readonly PluginSkill[];
  readonly mcpServers: readonly PluginMcpServer[];
  readonly subAgents: readonly PluginSubAgent[];
  readonly variables: readonly PluginVariable[];
  readonly overlay: StigmerOverlay;
  /** The tool-call hooks Stigmer reads; absent when the plugin carries none. */
  readonly hooks?: PluginHooks;
  /**
   * The sub-agent a Claude plugin's settings (`settings.json` or the
   * manifest's `settings`) name as the session's main agent, by its name in
   * `subAgents`; absent when none is named.
   */
  readonly mainAgent?: string;
  readonly ignored: readonly IgnoredComponent[];
}
