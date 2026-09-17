// A plugin directory as the reader's input, and the reader's outcome as
// something the CLI can print.
//
// `@stigmer/plugin-package` is pure over a `PluginFiles` list; this module is
// the CLI's edge for it. The walk is the skill packager's discipline
// (`createSkillZip`): sorted entries, symlinks never followed, the same
// gitignore-compatible matcher deciding inclusion, so what `validate` reads
// is exactly what a push of the same directory would package. Sizes come
// from `stat` so the library can refuse an over-cap document before reading
// it; the library re-checks the bytes it gets back.
//
// `describePlugin` is the JSON projection for `--json`: the normalised
// package with overlay documents reduced to their paths (the bytes are the
// user's own files, and a byte array serialises badly).
//
// The push half is two steps with a value between them: `preparePluginPush`
// (the same walked file list, zipped the way the skill packager zips, so the
// bytes and their SHA-256 are a function of content alone) and
// `pushPrepared` (the SDK's routed plugin client, then the members read back
// for the install summary). The value in between is what `push plugin
// --dry-run` prints, what `stigmer install` pushes from a marketplace entry,
// and what `stigmer up` compares with the server's digest before deciding
// to push. `validate -f`, `push plugin --dry-run` and `push plugin` share one
// description renderer so the author reads one vocabulary at every step.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { create, toJson } from "@bufbuild/protobuf";
import { zipSync } from "fflate";
import {
  MANIFEST_LOCATIONS,
  readPluginPackage,
  type PluginDialect,
  type PluginFileEntry,
  type PluginFiles,
  type PluginFinding,
  type PluginPackage,
} from "@stigmer/plugin-package";
import {
  PluginSchema,
  type Plugin,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  PluginMemberSchema,
  PushPluginRequestSchema,
  type PluginMember,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginDialect as PluginDialectProto } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { createMatcher } from "./ignore/index.js";
import {
  DETERMINISTIC_ZIP_MTIME,
  formatBytes,
  shortHash,
  type IgnoreOptions,
  type ZipStats,
} from "./skill.js";

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

/** Walk `dir` through the ignore matcher into a `PluginFiles`. */
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
  const stats: ZipStats = {
    filesIncluded: 0,
    filesIgnored: 0,
    dirsSkipped: 0,
    totalSize: 0,
  };
  const entries: PluginFileEntry[] = [];

  const walk = (currentDir: string, prefix: string): void => {
    const dirents = readdirSync(currentDir, { withFileTypes: true }).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
    for (const dirent of dirents) {
      const relPath = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
      const full = join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        if (matcher.matchWithReason(relPath, true).ignored) {
          stats.dirsSkipped++;
          continue;
        }
        walk(full, relPath);
        continue;
      }
      // Symlinks are neither files nor directories here and are never followed.
      if (!dirent.isFile()) continue;
      if (matcher.matchWithReason(relPath, false).ignored) {
        stats.filesIgnored++;
        continue;
      }
      const size = statSync(full).size;
      entries.push({ path: relPath, size });
      stats.filesIncluded++;
      stats.totalSize += size;
    }
  };
  walk(dir, "");

  return {
    files: {
      entries,
      read: (path) =>
        new Uint8Array(readFileSync(join(dir, ...path.split("/")))),
    },
    stats,
  };
}

/** The `--json` payload: the package with overlay documents as paths, plus the findings. */
export interface PluginDescription {
  readonly plugin: Omit<PluginPackage, "overlay"> & {
    readonly overlay: {
      readonly agent?: string;
      readonly workflows: readonly {
        readonly name: string;
        readonly path: string;
      }[];
      readonly mcpServers: readonly {
        readonly server: string;
        readonly path: string;
      }[];
    };
  };
  readonly warnings: readonly PluginFinding[];
  readonly excludedFiles: number;
}

export function describePlugin(
  plugin: PluginPackage,
  warnings: readonly PluginFinding[],
  stats: ZipStats,
): PluginDescription {
  const { overlay, ...rest } = plugin;
  return {
    plugin: {
      ...rest,
      overlay: {
        ...(overlay.agent !== undefined && { agent: overlay.agent.path }),
        workflows: overlay.workflows.map((w) => ({
          name: w.name,
          path: w.path,
        })),
        mcpServers: overlay.mcpServers.map((s) => ({
          server: s.server,
          path: s.path,
        })),
      },
    },
    warnings,
    excludedFiles: stats.filesIgnored,
  };
}

// ─── Rendering, shared by `validate -f <dir>` and `push plugin --dry-run` ────

/** Human labels for the four dialects, in the vocabulary the docs use. */
export const DIALECT_LABELS: Readonly<Record<PluginDialect, string>> = {
  "agent-plugins": "Agent Plugins 1.0",
  claude: "Claude Code plugin",
  cursor: "Cursor plugin",
  codex: "Codex plugin",
};

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
  contents.field("Sub-agents", named(plugin.subAgents.map((a) => a.name)));
  contents.field(
    "Variables",
    named(
      plugin.variables.map(
        (v) =>
          `${v.name}${v.optional ? " (optional)" : ""}${v.declaredBy === "inferred" ? " (inferred)" : ""}`,
      ),
    ),
  );
  const overlay = [
    ...(plugin.overlay.agent !== undefined ? ["agent"] : []),
    ...plugin.overlay.workflows.map((w) => `workflow ${w.name}`),
    ...plugin.overlay.mcpServers.map((s) => `server overlay ${s.server}`),
  ];
  if (overlay.length > 0) contents.field("Stigmer overlay", overlay.join(", "));

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

// ─── Push ────────────────────────────────────────────────────────────────

/**
 * The archive a push sends: the SAME file list `validate` read, zipped
 * deterministically (sorted entries, one DOS-epoch mtime, the skill
 * packager's level), so the digest the server records is a pure function
 * of the plugin's content and a second push of an unchanged directory is
 * the server's no-op.
 */
export function zipPluginFiles(files: PluginFiles): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const entry of files.entries) {
    tree[entry.path] = files.read(entry.path);
  }
  return zipSync(tree, { level: 6, mtime: DETERMINISTIC_ZIP_MTIME });
}

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
export function preparePluginPush(
  dir: string,
  ignoreOptions: IgnoreOptions = DEFAULT_IGNORE_OPTIONS,
): PreparedPluginPush {
  const directory = readPluginDirectory(dir, ignoreOptions);
  const outcome = readPluginPackage(directory.files);
  if (!outcome.ok) {
    throw pluginRefusal(dir, outcome.errors, outcome.warnings);
  }
  const archive = zipPluginFiles(directory.files);
  return {
    dir,
    files: directory.files,
    stats: directory.stats,
    plugin: outcome.plugin,
    warnings: outcome.warnings,
    archive,
    digest: createHash("sha256").update(archive).digest("hex"),
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
  readonly members: readonly PluginMember[];
  readonly archiveBytes: number;
}

/** Push a prepared archive, then read the members back for the install summary. */
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
  const members = (await client.plugin.listMembers(plugin.metadata?.id ?? ""))
    .members;
  return { plugin, members, archiveBytes: prepared.archive.length };
}

/** `push plugin <dir>` in one call: prepare, then push. */
export async function pushPlugin(
  client: Stigmer,
  dir: string,
  options: PushPluginOptions,
): Promise<PushPluginOutcome> {
  return pushPrepared(
    client,
    preparePluginPush(dir, options.ignoreOptions),
    options,
  );
}

/** The install as the user reads it: what landed, what was skipped, what to know. */
export function renderPushOutcome(outcome: PushPluginOutcome): CommandResult {
  const { plugin, members } = outcome;
  const warnings = plugin.status?.warnings ?? [];
  const counts = plugin.status?.materialized;
  const summary = [
    count(counts?.skills ?? 0, "skill"),
    count(counts?.mcpServers ?? 0, "MCP server"),
    count(counts?.agents ?? 0, "agent"),
    ...(counts !== undefined && counts.workflows > 0
      ? [count(counts.workflows, "workflow")]
      : []),
  ].join(", ");
  const headline = `Installed plugin '${plugin.metadata?.slug ?? plugin.spec?.name ?? ""}' (${summary})`;
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
  about.field("Digest", shortHash(plugin.status?.digest ?? ""));
  about.field(
    "Format",
    plugin.spec === undefined ? "" : dialectLabel(plugin.spec.dialect),
  );
  about.field("Size", formatBytes(outcome.archiveBytes));

  const installed = result.addSection("Installed");
  for (const kind of [
    ApiResourceKind.skill,
    ApiResourceKind.mcp_server,
    ApiResourceKind.agent,
    ApiResourceKind.workflow,
  ]) {
    const slugs = members.filter((m) => m.kind === kind).map((m) => m.slug);
    if (slugs.length > 0)
      installed.field(
        MEMBER_KIND_LABELS[kind] ?? ApiResourceKind[kind],
        slugs.join(", "),
      );
  }
  if (warnings.length > 0) {
    const section = result.addSection("Warnings");
    for (const warning of warnings) section.item(warning.message);
  }
  return result.withData({
    plugin: toJson(PluginSchema, plugin),
    members: members.map((m) => toJson(PluginMemberSchema, m)),
  });
}

const MEMBER_KIND_LABELS: Partial<Record<ApiResourceKind, string>> = {
  [ApiResourceKind.skill]: "Skills",
  [ApiResourceKind.mcp_server]: "MCP servers",
  [ApiResourceKind.agent]: "Agents",
  [ApiResourceKind.workflow]: "Workflows",
};

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
