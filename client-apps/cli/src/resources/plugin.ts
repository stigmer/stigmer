// A plugin directory as the reader's input, and the reader's outcome as
// something the CLI can print.
//
// `@stigmer/plugin-package` is pure over a `PluginFiles` list; this module is
// the CLI's edge for it. The walk lists every file under the directory
// (symlinks never followed, sizes from `stat` so the library can refuse an
// over-cap document before reading it) and hands the list to the shared
// selection rule in `@stigmer/plugin-package/client`, which decides
// inclusion and order the same way for every client: what `validate` reads
// here is exactly what a push of the same directory packages, and exactly
// what the console packages from the same tree on a marketplace host.
//
// `describePlugin` is the JSON projection for `--json`: the normalised
// package and the reader's findings. Hooks are summarised
// as their format and the handlers per event, offline from the package and
// after an install from `status.hooks`; what is not run is in the warnings.
// `get plugin` stays the generic resource view, whose YAML and JSON carry
// `status.hooks` whole.
//
// The push half is two steps with a value between them: `preparePluginPush`
// (the same selected file list, archived and digested by the shared module,
// so the bytes and their SHA-256 are a function of content alone and equal
// what the console computes for the same tree) and `pushPrepared` (the SDK's
// routed plugin client; the plugin it answers lists everything the archive
// holds). The value in between is what `push plugin --dry-run` prints, what
// `stigmer install` and `stigmer mcp add` push, and what `stigmer up`
// compares with the server's digest before deciding to push. `validate -f`, `push plugin --dry-run` and `push plugin` share one
// description renderer so the author reads one vocabulary at every step.
//
// `nextSteps` is what the install leaves the user to do, read from the
// plugin's status alone: a sign-in a server takes (`stigmer connect plugin`
// runs it), the keys the plugin needs saved in a vault, then the two ways
// to use it, `stigmer run --plugin` and an agent's `plugins`. `stigmer up`
// does not print them: its plugin is the built-in assistant, not a user's
// act.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { create, toJson } from "@bufbuild/protobuf";
import {
  MANIFEST_LOCATIONS,
  PLACEHOLDER_PATTERN,
  type PluginFiles,
  type PluginFinding,
  type PluginPackage,
} from "@stigmer/plugin-package";
import {
  DIALECT_LABELS,
  preparePluginArchive,
  selectPluginFiles,
  type CandidateFile,
} from "@stigmer/plugin-package/client";
import {
  PluginSchema,
  type Plugin,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PushPluginRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { PluginDialect as PluginDialectProto } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb";
import type { HookConfig } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { hookFormatName, hooksSummary, type Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { createMatcher } from "./ignore/index.js";
import {
  formatBytes,
  shortHash,
  type IgnoreOptions,
  type ZipStats,
} from "./skill.js";

export { DIALECT_LABELS };

/** The four manifest locations; a directory holding any of them is a plugin. */
export const PLUGIN_MANIFEST_PATHS: readonly string[] =
  Object.values(MANIFEST_LOCATIONS);

/** True when `path` is a directory holding one of the four plugin manifests. */
export function isPluginDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
  } catch {
    return false;
  }
  return PLUGIN_MANIFEST_PATHS.some((manifest) => {
    try {
      return statSync(join(path, ...manifest.split("/"))).isFile();
    } catch {
      return false;
    }
  });
}

export interface PluginDirectory {
  readonly files: PluginFiles;
  /** What the walk included and left out, for the summary line. */
  readonly stats: ZipStats;
}

/** Validate's ignore posture: the defaults and the directory's own ignore files, no flags. */
export const DEFAULT_IGNORE_OPTIONS: IgnoreOptions = {
  respectGitignore: true,
  extraIgnore: [],
  extraInclude: [],
};

/**
 * List the files under `dir` and select through the shared rule. The walk
 * prunes a directory the matcher ignores before descending (a
 * `node_modules/` is never stat'ed), and the selection applies the same
 * matcher to what remains, so the CLI and the console agree on every
 * decision and only the CLI pays the filesystem. Symlinks are neither
 * files nor directories to `readdirSync` and are never followed.
 */
export function readPluginDirectory(
  dir: string,
  options: IgnoreOptions = DEFAULT_IGNORE_OPTIONS,
): PluginDirectory {
  const matcher = createMatcher({
    rootDir: dir,
    respectGitignore: options.respectGitignore,
    includeDefaults: true,
    extraIgnore: options.extraIgnore,
    extraInclude: options.extraInclude,
  });
  let dirsSkipped = 0;
  const candidates: CandidateFile[] = [];
  const walk = (currentDir: string, prefix: string): void => {
    for (const dirent of readdirSync(currentDir, { withFileTypes: true })) {
      const relPath = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
      if (dirent.isDirectory()) {
        if (matcher.match(relPath, true)) {
          dirsSkipped++;
          continue;
        }
        walk(join(currentDir, dirent.name), relPath);
        continue;
      }
      if (!dirent.isFile()) continue;
      candidates.push({
        path: relPath,
        size: statSync(join(currentDir, dirent.name)).size,
      });
    }
  };
  walk(dir, "");

  const read = (path: string): Uint8Array =>
    new Uint8Array(readFileSync(join(dir, ...path.split("/"))));
  const selection = selectPluginFiles(candidates, read, {
    respectGitignore: options.respectGitignore,
    extraIgnore: options.extraIgnore,
    extraInclude: options.extraInclude,
  });
  return {
    files: selection.files,
    stats: { ...selection.stats, dirsSkipped },
  };
}

/** The `--json` payload: the package, plus the findings. */
export interface PluginDescription {
  readonly plugin: PluginPackage;
  readonly warnings: readonly PluginFinding[];
  readonly excludedFiles: number;
}

export function describePlugin(
  plugin: PluginPackage,
  warnings: readonly PluginFinding[],
  stats: ZipStats,
): PluginDescription {
  return { plugin, warnings, excludedFiles: stats.filesIgnored };
}

// ─── Rendering, shared by `validate -f <dir>` and `push plugin --dry-run` ────

/** The library's refusal as the CLI's one UsageError: every problem, then every warning. */
export function pluginRefusal(
  dir: string,
  errors: readonly PluginFinding[],
  warnings: readonly PluginFinding[],
): UsageError {
  const lines = [
    `${dir}: plugin cannot be installed, ${count(errors.length, "problem")} found:`,
    ...errors.map((finding) => `  - ${finding.message}`),
  ];
  if (warnings.length > 0) {
    lines.push(
      `and ${count(warnings.length, "warning")}:`,
      ...warnings.map((finding) => `  - ${finding.message}`),
    );
  }
  return new UsageError(lines.join("\n"));
}

/**
 * What the package would install, as sections on a result — the one
 * description `validate` prints and `push --dry-run` prints under its own
 * headline, so an author reads the same words offline and before a push.
 */
export function describePackageOn(
  result: CommandResult,
  plugin: PluginPackage,
  warnings: readonly PluginFinding[],
  stats: ZipStats,
): CommandResult {
  const about = result.addSection("Plugin");
  about.field("Name", plugin.name);
  if (plugin.version !== undefined) about.field("Version", plugin.version);
  about.field("Format", DIALECT_LABELS[plugin.dialect]);
  about.field("Manifests", plugin.manifestsFound.join(", "));
  about.field(
    "Files",
    `${stats.filesIncluded} read, ${stats.filesIgnored} excluded by ignore rules`,
  );

  const contents = result.addSection("Installs");
  contents.field("Skills", named(plugin.skills.map((s) => s.name)));
  contents.field(
    "MCP servers",
    named(plugin.mcpServers.map((s) => `${s.name} (${s.transport})`)),
  );
  // The main agent runs the main thread and is not installed as a sub-agent too.
  contents.field(
    "Sub-agents",
    named(
      plugin.subAgents
        .map((a) => a.name)
        .filter((name) => name !== plugin.mainAgent),
    ),
  );
  if (plugin.mainAgent !== undefined)
    contents.field("Main agent", plugin.mainAgent);
  contents.field(
    "Hooks",
    plugin.hooks === undefined
      ? "none"
      : hooksSummary(plugin.hooks.format, plugin.hooks.groups),
  );
  contents.field(
    "Variables",
    named(
      plugin.variables.map(
        (v) =>
          `${v.name}${v.optional ? " (optional)" : ""}${v.declaredBy === "inferred" ? " (inferred)" : ""}`,
      ),
    ),
  );
  if (warnings.length > 0) {
    const section = result.addSection("Warnings");
    for (const warning of warnings) section.item(warning.message);
  }
  if (plugin.ignored.length > 0) {
    const section = result.addSection("Not installed");
    for (const component of plugin.ignored)
      section.item(`${component.kind} (${component.path})`);
  }
  return result.withData(describePlugin(plugin, warnings, stats));
}

export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function named(items: readonly string[]): string {
  return items.length === 0 ? "none" : `${items.length}: ${items.join(", ")}`;
}

function installedHooksSummary(hooks: HookConfig): string {
  return hooksSummary(hookFormatName(hooks.format), hooks.groups);
}

// ─── Push ────────────────────────────────────────────────────────────────

/**
 * A plugin directory read, validated and zipped, but not yet pushed. The
 * step between "a folder" and "a push" is its own value because two callers
 * need to look at it first: `push plugin --dry-run` prints it, and `stigmer
 * up` compares `digest` with what the server already holds before deciding
 * whether a push is needed at all.
 */
export interface PreparedPluginPush {
  /** The directory that was read, for sentences. */
  readonly dir: string;
  readonly files: PluginFiles;
  readonly stats: ZipStats;
  readonly plugin: PluginPackage;
  readonly warnings: readonly PluginFinding[];
  /** The exact bytes a push sends. */
  readonly archive: Uint8Array;
  /**
   * SHA-256 of `archive`, lowercase hex: the identity the server records as
   * `status.digest` (its digest is over the bytes it receives, and these are
   * those bytes), so a client can know "already installed" without pushing.
   */
  readonly digest: string;
}

/**
 * Read and validate offline (the same refusal `validate` prints, before a
 * byte moves), then zip. The server re-validates with the same library; the
 * offline pass exists so an author never waits on the network to hear a
 * sentence the CLI could say.
 */
export async function preparePluginPush(
  dir: string,
  ignoreOptions: IgnoreOptions = DEFAULT_IGNORE_OPTIONS,
): Promise<PreparedPluginPush> {
  // The walk is the CLI's (it prunes directories before listing them, which
  // a flat tree cannot); everything after it is the shared tail every client
  // runs, so a folder pushed here and the same tree read by the console have
  // one digest by construction.
  const directory = readPluginDirectory(dir, ignoreOptions);
  const outcome = await preparePluginArchive(directory);
  if (!outcome.ok) {
    throw pluginRefusal(dir, outcome.errors, outcome.warnings);
  }
  return {
    dir,
    files: outcome.prepared.files,
    stats: directory.stats,
    plugin: outcome.prepared.plugin,
    warnings: outcome.prepared.warnings,
    archive: outcome.prepared.archive,
    digest: outcome.prepared.digest,
  };
}

export interface PushPreparedOptions {
  readonly org: string;
  readonly visibility: ApiResourceVisibility | undefined;
  readonly message: string;
}

export interface PushPluginOptions extends PushPreparedOptions {
  readonly ignoreOptions: IgnoreOptions;
}

export interface PushPluginOutcome {
  readonly plugin: Plugin;
  readonly archiveBytes: number;
}

/**
 * Push a prepared archive. The plugin the server answers is the whole
 * install: its status lists the skills, agents, MCP servers and hooks the
 * archive holds, so nothing is read back.
 */
export async function pushPrepared(
  client: Stigmer,
  prepared: PreparedPluginPush,
  options: PushPreparedOptions,
): Promise<PushPluginOutcome> {
  const plugin = await client.plugin.push(
    create(PushPluginRequestSchema, {
      org: options.org,
      artifact: prepared.archive,
      message: options.message,
      ...(options.visibility !== undefined && {
        visibility: options.visibility,
      }),
    }),
  );
  return { plugin, archiveBytes: prepared.archive.length };
}

/** `push plugin <dir>` in one call: prepare, then push. */
export async function pushPlugin(
  client: Stigmer,
  dir: string,
  options: PushPluginOptions,
): Promise<PushPluginOutcome> {
  return pushPrepared(
    client,
    await preparePluginPush(dir, options.ignoreOptions),
    options,
  );
}

export interface RenderPushOptions {
  /** Where the archive came from when it was not a folder: the marketplace's name and source. */
  readonly installedFrom?: string;
  /** What the install leaves the user to do, from `nextSteps`. */
  readonly next?: readonly NextStep[];
}

/** One thing to do after an install: a sign-in or keys a server needs, then the two ways to use the plugin. */
export type NextStep =
  | { readonly kind: "sign-in"; readonly server: string; readonly command: string }
  | { readonly kind: "save-keys"; readonly variables: readonly string[]; readonly command: string }
  | { readonly kind: "run"; readonly command: string }
  | { readonly kind: "add-to-agent"; readonly plugin: string };

/**
 * What the install leaves the user to do, read from the plugin's status: a
 * sign-in for each server that takes one, the keys the plugin needs and
 * declares no value for (a signing-in server's login key is the sign-in's
 * to fill, so it is not asked), then `stigmer run --plugin` and an agent's
 * `plugins`. Pure: the status is the install's whole answer.
 */
export function nextSteps(plugin: Plugin): NextStep[] {
  const name = pluginName(plugin);
  const servers = plugin.status?.mcpServers ?? [];
  const steps: NextStep[] = [];
  const loginKeys = new Set<string>();
  for (const server of servers) {
    if (server.signIn === undefined) continue;
    if (server.transport.case === "http") {
      for (const value of Object.values(server.transport.value.headers)) {
        for (const match of value.matchAll(PLACEHOLDER_PATTERN)) loginKeys.add(match[1]);
      }
    }
    steps.push({
      kind: "sign-in",
      server: server.name,
      command: `stigmer connect plugin ${name}${servers.length > 1 ? ` --server ${server.name}` : ""}`,
    });
  }
  const variables = Object.entries(plugin.status?.env ?? {})
    .filter(([key, decl]) => !decl.optional && decl.value === "" && !loginKeys.has(key))
    .map(([key]) => key)
    .sort();
  if (variables.length > 0) {
    steps.push({
      kind: "save-keys",
      variables,
      command: variables.map((v) => `stigmer vault set-secret ${v} --mine`).join(" && "),
    });
  }
  steps.push({ kind: "run", command: `stigmer run --plugin ${name}` });
  steps.push({ kind: "add-to-agent", plugin: name });
  return steps;
}

function describeNextStep(step: NextStep): string {
  switch (step.kind) {
    case "sign-in":
      return `Sign in to ${step.server}:  ${step.command}`;
    case "save-keys":
      return `Save ${step.variables.join(", ")} in your vault:  ${step.command}`;
    case "run":
      return `Use it in a conversation:  ${step.command}`;
    case "add-to-agent":
      return `Give it to an agent: add '- slug: ${step.plugin}' under spec.plugins in the agent's YAML, or from the plugin's page in the console`;
    default: {
      const exhaustive: never = step;
      return exhaustive;
    }
  }
}

/** The install as the user reads it: what landed, what was skipped, what to know. */
export function renderPushOutcome(
  outcome: PushPluginOutcome,
  options: RenderPushOptions = {},
): CommandResult {
  const { plugin } = outcome;
  const status = plugin.status;
  const warnings = status?.warnings ?? [];
  const skills = status?.skills ?? [];
  const servers = status?.mcpServers ?? [];
  const agents = status?.agents ?? [];
  // Only the kinds the plugin holds are named, as the console's
  // `summariseInstall` names them: most catalogue plugins carry tools
  // alone, and "0 skills, 1 MCP server, 0 agents" reads as three facts.
  const named = (
    [
      [skills.length, "skill"],
      [servers.length, "MCP server"],
      [agents.length, "agent"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, noun]) => count(n, noun));
  const summary = named.length === 0 ? "nothing installed" : named.join(", ");
  const headline = `Installed plugin '${pluginName(plugin)}' (${summary})`;
  const result =
    warnings.length === 0
      ? CommandResult.success(headline)
      : CommandResult.warning(
          `${headline} with ${count(warnings.length, "warning")}`,
        );

  const about = result.addSection("Plugin");
  about.field("ID", plugin.metadata?.id ?? "");
  about.field("Slug", plugin.metadata?.slug ?? "");
  if (plugin.spec?.version) about.field("Version", plugin.spec.version);
  about.field("Digest", shortHash(status?.digest ?? ""));
  about.field(
    "Format",
    plugin.spec === undefined ? "" : dialectLabel(plugin.spec.dialect),
  );
  about.field("Size", formatBytes(outcome.archiveBytes));
  if (options.installedFrom !== undefined)
    about.field("Marketplace", options.installedFrom);

  const installed = result.addSection("Installed");
  if (skills.length > 0)
    installed.field("Skills", skills.map((s) => s.name).join(", "));
  if (servers.length > 0)
    installed.field(
      "MCP servers",
      servers.map((s) => `${s.name} (${serverTransport(s)})`).join(", "),
    );
  if (agents.length > 0)
    installed.field("Agents", agents.map((a) => a.name).join(", "));
  if (status?.hooks !== undefined && status.hooks.groups.length > 0)
    installed.field("Hooks", installedHooksSummary(status.hooks));
  if (warnings.length > 0) {
    const section = result.addSection("Warnings");
    for (const warning of warnings) section.item(warning.message);
  }
  const next = options.next ?? [];
  if (next.length > 0) {
    const section = result.addSection("Next");
    for (const step of next) section.item(describeNextStep(step));
  }
  return result.withData({
    plugin: toJson(PluginSchema, plugin),
    ...(options.next !== undefined && { next: options.next }),
  });
}

/** The name a plugin is addressed by: its slug, else its manifest name. */
function pluginName(plugin: Plugin): string {
  return plugin.metadata?.slug || plugin.spec?.name || "";
}

/** How a plugin's server is reached, as one word. */
export function serverTransport(server: McpServerEntry): string {
  switch (server.transport.case) {
    case "stdio":
      return "stdio";
    case "http":
      return "http";
    case undefined:
      return "unknown";
    default: {
      const exhaustive: never = server.transport;
      return String(exhaustive);
    }
  }
}

function dialectLabel(dialect: PluginDialectProto): string {
  switch (dialect) {
    case PluginDialectProto.AGENT_PLUGINS:
      return DIALECT_LABELS["agent-plugins"];
    case PluginDialectProto.CLAUDE:
      return DIALECT_LABELS.claude;
    case PluginDialectProto.CURSOR:
      return DIALECT_LABELS.cursor;
    case PluginDialectProto.CODEX:
      return DIALECT_LABELS.codex;
    case PluginDialectProto.UNSPECIFIED:
      return "";
    default: {
      const exhaustive: never = dialect;
      return String(exhaustive);
    }
  }
}
