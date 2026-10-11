// Plugin fixtures for the conformance suite: the library's own dialect
// builders (`@stigmer/plugin-package/testing`) produce the file layout each
// tool writes, and one deterministic zipper turns the map into the archive
// PushPlugin takes. Same map, same bytes, same digest — the content hash is
// the contract, so the zipper pins its mtime exactly as the skill fixtures
// do (see skills.ts).
//
// A plugin is the only home of an MCP server: a tool-using arm pushes a
// plugin whose one server is the harness's fixture (`oneServerPlugin`,
// `pushPlugin`), lists it on the agent or the conversation (`plugins`), and
// reads the names a turn gives the server's parts: the server segment
// `plugin_<plugin>_<server>` (`toolServerSegment`), its tools
// `mcp__plugin_<plugin>_<server>__<tool>` (`pluginToolName`), the run-values
// declarer `plugin:<plugin>:<server>` (`pluginToolDeclarer`), a skill
// `<plugin>:<skill>`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  claudePlugin,
  cursorPlugin,
  openPlugin,
  withFile,
} from "@stigmer/plugin-package/testing";
import type { AgentFixture, PluginFixture, SkillFixture } from "@stigmer/plugin-package/testing";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ConformanceClients } from "../harness/clients";
import type { FixtureTracker } from "../harness/fixtures";
import type { InitShape } from "./init-shape";
import { zipFiles } from "./skills";

export { claudePlugin, cursorPlugin, openPlugin, withFile };
export type { AgentFixture, PluginFixture, SkillFixture };

/** A fixture map as the archive `PushPlugin` takes. */
export function pluginArchive(fixture: PluginFixture): Uint8Array {
  const files: Record<string, Uint8Array | string> = {};
  for (const [path, content] of fixture) {
    files[path] = content;
  }
  return zipFiles(files);
}

export interface ThermosOptions {
  /** The one skill's name; defaults to `<name>-review`. */
  readonly skill?: string;
  /** A second skill, for the upgrade arm. */
  readonly extraSkill?: string;
}

/**
 * The thermos shape: a Cursor plugin with a skill, an agent naming a model,
 * and an HTTP MCP server (`github`) referencing one declared variable. Its
 * status lists every part a plugin can carry but hooks.
 */
export function thermosLike(
  name: string,
  options: ThermosOptions = {},
): PluginFixture {
  const skill = options.skill ?? `${name}-review`;
  return cursorPlugin({
    name,
    version: "1.2.0",
    description: "Code review with a thermonuclear standard",
    skills: [
      {
        name: skill,
        description: "Review code thoroughly",
        body: "# Review\nRead everything.",
      },
      ...(options.extraSkill === undefined
        ? []
        : [
            {
              name: options.extraSkill,
              description: "Another skill",
              body: "# More\nAnd more.",
            },
          ]),
    ],
    agents: [
      {
        file: "reviewer",
        frontmatter: {
          name: "reviewer",
          description: "Reviews pull requests",
          model: "sonnet",
          skills: [skill],
        },
        body: "You review pull requests with care and name every risk you see.",
      },
    ],
    mcpServers: {
      github: {
        type: "http",
        url: "https://api.github.test/mcp/",
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      },
    },
    variables: {
      GITHUB_TOKEN: {
        type: "string",
        title: "GitHub token",
        description: "A personal access token",
      },
    },
    required: ["GITHUB_TOKEN"],
  });
}

/** An MCP-only plugin in the open format: one streamable-http server, one inferred variable. */
export function mcpOnly(name: string): PluginFixture {
  return openPlugin({
    name,
    version: "0.1.0",
    mcpServers: {
      api: {
        type: "streamable-http",
        url: "https://mcp.vendor.test/mcp",
        headers: { Authorization: "Bearer ${TOKEN}" },
      },
    },
  });
}

/**
 * A Claude Code plugin: `userConfig` variables and an `npx` stdio server that
 * references one of them, plus a skill. The stdio transport is the arm the
 * Cursor shape does not reach.
 */
export function claudeLike(name: string): PluginFixture {
  return claudePlugin({
    name,
    version: "0.3.0",
    description: "Notes with a local server",
    userConfig: {
      NOTES_TOKEN: {
        type: "string",
        description: "Token for the notes server",
        sensitive: true,
        required: true,
      },
    },
    skills: [
      {
        name: `${name}-notes`,
        description: "Keep notes",
        body: "# Notes\nWrite them down.",
      },
    ],
    mcpServers: {
      notes: {
        command: "npx",
        args: ["-y", "notes-mcp"],
        env: { NOTES_TOKEN: "${NOTES_TOKEN}" },
      },
    },
  });
}

// ─── one-server plugins: the only home of an MCP server ─────────────────

/** The server name every one-server fixture plugin gives its MCP server. */
export const FIXTURE_SERVER = "tools";

/** An MCP server at an address, as `.mcp.json` writes it. */
export interface FixtureHttpServer {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A local program, as `.mcp.json` writes it; `env` values are `${VAR}` references. */
export interface FixtureStdioServer {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface OneServerPluginOptions {
  /** The plugin's name; its slug is derived from it. */
  readonly name: string;
  /** The server's name inside the plugin; defaults to {@link FIXTURE_SERVER}. */
  readonly serverName?: string;
  readonly server: FixtureHttpServer | FixtureStdioServer;
  readonly version?: string;
  /** Claude Code `userConfig` declarations (variables the server reads). */
  readonly userConfig?: Readonly<Record<string, unknown>>;
  readonly skills?: readonly SkillFixture[];
  readonly agents?: readonly AgentFixture[];
  /** The `hooks/hooks.json` event map, in Claude Code's format. */
  readonly hooks?: Readonly<Record<string, unknown>>;
  /** Extra files anywhere in the plugin (a hook's script). */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
}

function isStdio(server: FixtureHttpServer | FixtureStdioServer): server is FixtureStdioServer {
  return "command" in server;
}

/**
 * A Claude Code plugin whose one MCP server is `server`:
 * `.claude-plugin/plugin.json` plus `.mcp.json`, with any skills, agents,
 * hooks and files the arm needs beside it.
 */
export function oneServerPlugin(opts: OneServerPluginOptions): PluginFixture {
  const server = opts.server;
  const entry: Record<string, unknown> = isStdio(server)
    ? {
        command: server.command,
        args: [...(server.args ?? [])],
        ...(server.env !== undefined ? { env: { ...server.env } } : {}),
      }
    : {
        type: "http",
        url: server.url,
        ...(server.headers !== undefined ? { headers: { ...server.headers } } : {}),
      };
  return claudePlugin({
    name: opts.name,
    version: opts.version ?? "0.1.0",
    description: "conformance one-server plugin",
    mcpServers: { [opts.serverName ?? FIXTURE_SERVER]: entry },
    ...(opts.userConfig !== undefined ? { userConfig: opts.userConfig } : {}),
    ...(opts.skills !== undefined ? { skills: opts.skills } : {}),
    ...(opts.agents !== undefined ? { agents: opts.agents } : {}),
    ...(opts.hooks !== undefined ? { hooks: opts.hooks } : {}),
    ...(opts.files !== undefined ? { files: opts.files } : {}),
  });
}

export interface PushPluginOptions {
  readonly visibility?: ApiResourceVisibility;
}

/**
 * Installs `fixture` (a file map or an archive already zipped) in `org` and
 * defers its delete on the caller's tracker, best-effort: a plugin already
 * gone, or one an agent the arm left behind still lists, is a clean fixture.
 * Agents an arm creates after the push are deleted first (the tracker runs
 * in reverse), so the plugin's own delete guard never holds it.
 */
export async function pushPlugin(
  clients: Pick<ConformanceClients, "pluginCommand">,
  fixtures: FixtureTracker,
  org: string,
  fixture: PluginFixture | Uint8Array,
  opts: PushPluginOptions = {},
): Promise<Plugin> {
  const artifact = fixture instanceof Uint8Array ? fixture : pluginArchive(fixture);
  const plugin = await clients.pluginCommand.push({
    org,
    artifact,
    ...(opts.visibility !== undefined ? { visibility: opts.visibility } : {}),
  });
  const id = plugin.metadata?.id ?? "";
  fixtures.defer(() =>
    clients.pluginCommand.delete({ value: id }).then(
      () => undefined,
      () => undefined,
    ),
  );
  return plugin;
}

/** The reference an agent's or a conversation's `plugins` carries for a pushed plugin. */
export function pluginRefOf(plugin: Plugin, version?: string): InitShape<typeof ApiResourceReferenceSchema> {
  const org = plugin.metadata?.org ?? "";
  const slug = plugin.metadata?.slug ?? "";
  if (org === "" || slug === "") {
    throw new Error("pluginRefOf needs a plugin the server returned (org and slug set)");
  }
  return { kind: ApiResourceKind.plugin, org, slug, ...(version !== undefined ? { version } : {}) };
}

/** One name part as Claude Code writes it: every character outside `A-Za-z0-9_-` as `_`. */
function claudeNamePart(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * `plugin_<plugin>_<server>`: the server part of a plugin tool's name, the
 * `mcp_server_slug` a tool call and a pending approval carry.
 */
export function toolServerSegment(pluginName: string, serverName: string = FIXTURE_SERVER): string {
  return `plugin_${claudeNamePart(pluginName)}_${claudeNamePart(serverName)}`;
}

/** `mcp__plugin_<plugin>_<server>__<tool>`: a plugin tool in an agent's tool lists. */
export function pluginToolName(pluginName: string, serverName: string, tool: string): string {
  return `mcp__${toolServerSegment(pluginName, serverName)}__${tool}`;
}

/** `plugin:<plugin>:<server>`: the declarer a run's values and its refusals name a plugin's server by. */
export function pluginToolDeclarer(pluginName: string, serverName: string = FIXTURE_SERVER): string {
  return `plugin:${pluginName}:${serverName}`;
}

/**
 * The six plugins vendored from `cursor/plugins` into the library's fixtures,
 * read from disk as the CLI would read them: every file, ignore rules the
 * library's reader applies itself. `salesforce` is the one the library
 * refuses (a variable in a server `url`), so it is the refusal arm of the
 * six, not an install.
 */
export const VENDORED_CURSOR_PLUGINS = [
  "thermos",
  "github",
  "xero",
  "playwright",
  "advisor",
  "salesforce",
] as const;

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const VENDORED_ROOT = join(
  REPO_ROOT,
  "backend/libs/ts/plugin-package/src/__tests__/fixtures/cursor-plugins",
);

export function vendoredPlugin(
  name: (typeof VENDORED_CURSOR_PLUGINS)[number],
): PluginFixture {
  const root = join(VENDORED_ROOT, name);
  const files: PluginFixture = new Map();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.set(
          relative(root, full).split("\\").join("/"),
          readFileSync(full),
        );
      }
    }
  };
  walk(root);
  return files;
}
