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
// package with overlay documents reduced to their paths (the bytes are the
// user's own files, and a byte array serialises badly).
//
// The push half is two steps with a value between them: `preparePluginPush`
// (the same selected file list, archived and digested by the shared module,
// so the bytes and their SHA-256 are a function of content alone and equal
// what the console computes for the same tree) and `pushPrepared` (the SDK's
// routed plugin client, then the members read back for the install summary). The value in between is what `push plugin
// --dry-run` prints, what `stigmer install` pushes from a marketplace entry,
// and what `stigmer up` compares with the server's digest before deciding
// to push. `validate -f`, `push plugin --dry-run` and `push plugin` share one
// description renderer so the author reads one vocabulary at every step.
//
// `readNextSteps` is what the install leaves the user to do, read from the
// servers the push produced: a sign-in an OAuth server needs (`stigmer
// connect mcp-server` runs it), the variables an API-key server wants and
// where they are asked, and, for a plugin that installed tools and no
// agent, the agent the tools still need. Best-effort by design: a server
// or a grant the CLI cannot read yields no line rather than a failed
// install, because the install itself succeeded. `stigmer up` does not
// read them: its plugin is the built-in assistant, not a user's act.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { create, toJson } from "@bufbuild/protobuf";
import {
  MANIFEST_LOCATIONS,
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
import {
  PluginMemberSchema,
  PushPluginRequestSchema,
  type PluginMember,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import {
  GetOAuthGrantStatusInputSchema,
  OAuthConnectionHealth,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { PluginDialect as PluginDialectProto } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
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
    await preparePluginPush(dir, options.ignoreOptions),
    options,
  );
}

export interface RenderPushOptions {
  /** Where the archive came from when it was not a folder: the marketplace's name and source. */
  readonly installedFrom?: string;
  /** What the install leaves the user to do, from `readNextSteps`. */
  readonly next?: readonly NextStep[];
}

/** One thing standing between an installed MCP server and its first tool call, or the agent the tools still need. */
export type NextStep =
  | { readonly kind: "sign-in"; readonly server: string; readonly command: string }
  | { readonly kind: "signed-in"; readonly server: string }
  | {
      readonly kind: "api-key";
      readonly server: string;
      readonly variables: readonly string[];
      /** Where the variables are asked: the agent's first session, or `stigmer connect mcp-server --env`. */
      readonly askedAt: "agent" | "connect";
      readonly command?: string;
    }
  | { readonly kind: "add-to-agent"; readonly servers: readonly string[] };

/**
 * What the install leaves the user to do, read from each MCP server the
 * push produced. Best-effort: a server or grant this CLI cannot read yields
 * no step, never a failure, because the install itself succeeded.
 */
export async function readNextSteps(
  client: Stigmer,
  org: string,
  members: readonly PluginMember[],
): Promise<NextStep[]> {
  const servers = members.filter((m) => m.kind === ApiResourceKind.mcp_server);
  const hasAgent = members.some((m) => m.kind === ApiResourceKind.agent);
  const steps: NextStep[] = [];
  for (const member of servers) {
    try {
      const server = await client.mcpServer.getByReference({
        org,
        slug: member.slug,
      });
      const auth = server.spec?.auth;
      const variables = Object.keys(server.spec?.env ?? {});
      if (auth?.targetEnvVar) {
        let connected = false;
        try {
          const grant = await client.mcpServer.getOAuthGrantStatus(
            create(GetOAuthGrantStatusInputSchema, {
              resourceId: server.metadata?.id ?? "",
              org,
            }),
          );
          connected =
            grant.connected &&
            grant.connectionHealth !==
              OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED;
        } catch {
          // Fail closed: a grant the CLI cannot read is a sign-in still owed.
        }
        steps.push(
          connected
            ? { kind: "signed-in", server: member.slug }
            : {
                kind: "sign-in",
                server: member.slug,
                command: `stigmer connect mcp-server ${member.slug}`,
              },
        );
      } else if (variables.length > 0) {
        steps.push({
          kind: "api-key",
          server: member.slug,
          variables,
          askedAt: hasAgent ? "agent" : "connect",
          ...(hasAgent
            ? {}
            : {
                command: `stigmer connect mcp-server ${member.slug} --env ${variables.map((v) => `${v}=...`).join(" --env ")}`,
              }),
        });
      }
    } catch {
      // A server the CLI cannot read has no line; the Installed section still names it.
    }
  }
  if (!hasAgent && servers.length > 0) {
    steps.push({
      kind: "add-to-agent",
      servers: servers.map((m) => m.slug),
    });
  }
  return steps;
}

function describeNextStep(step: NextStep): string {
  switch (step.kind) {
    case "sign-in":
      return `Sign in to ${step.server}:  ${step.command}`;
    case "signed-in":
      return `${step.server}: signed in`;
    case "api-key":
      return step.askedAt === "agent"
        ? `${step.server} needs ${step.variables.join(", ")}; the agent asks at its first session`
        : `${step.server} needs ${step.variables.join(", ")}; set them when you connect:  ${step.command ?? ""}`;
    case "add-to-agent":
      return `Add these tools to an agent: list ${step.servers.map((s) => `'${s}'`).join(", ")} under mcp_server_usages in an agent's YAML, or from the plugin's page in the console`;
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
  const { plugin, members } = outcome;
  const warnings = plugin.status?.warnings ?? [];
  const counts = plugin.status?.materialized;
  // Only the kinds the plugin installed are named, as the console's
  // `summariseInstall` names them: most catalogue plugins install tools
  // alone, and "0 skills, 1 MCP server, 0 agents" reads as three facts.
  const named = (
    [
      [counts?.skills ?? 0, "skill"],
      [counts?.mcpServers ?? 0, "MCP server"],
      [counts?.agents ?? 0, "agent"],
      [counts?.workflows ?? 0, "workflow"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, noun]) => count(n, noun));
  const summary = named.length === 0 ? "nothing installed" : named.join(", ");
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
  if (options.installedFrom !== undefined)
    about.field("Marketplace", options.installedFrom);

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
  const next = options.next ?? [];
  if (next.length > 0) {
    const section = result.addSection("Next");
    for (const step of next) section.item(describeNextStep(step));
  }
  return result.withData({
    plugin: toJson(PluginSchema, plugin),
    members: members.map((m) => toJson(PluginMemberSchema, m)),
    ...(options.next !== undefined && { next: options.next }),
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
