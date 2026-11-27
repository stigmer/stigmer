// `stigmer mcp add`: one MCP server at an address, made into a plugin of its
// own, as Claude Code's `claude mcp add` adds one server.
//
// Outside an agent's own `mcp_servers`, an MCP server lives in a plugin, so
// a one-off server is a plugin holding nothing else: a Claude Code manifest
// naming the plugin and a `.mcp.json` naming the one server, both called
// `<name>`. The two documents are `@stigmer/plugin-package`'s
// `oneServerPluginDocuments`, the builder the console's "Add MCP server"
// writes with too, so the same name, address, headers and description make
// the same archive and the same digest from either surface: a second `mcp
// add` of an unchanged server changes nothing. The files go through the same
// shared tail every push runs (`preparePluginArchive`: read, validate, zip,
// digest), so the plugin is validated by the library the server installs
// with, and a refusal reads like any other plugin's. A header value may name
// a key in the caller's vault as `${NAME}`, which the plugin then declares,
// exactly as a hand-written `.mcp.json` would.
//
// Run again under a name already installed, it changes that plugin only when
// the plugin is itself one server and nothing else, read from the installed
// version's own files (never its status, which cannot see a README beside
// them, and never with an eval suite, which the served files leave out):
// anything pushed from a folder would be flattened into two files, so it is
// refused, naming what the plugin holds and the push that changes it. A
// change keeps what it does not name: the plugin's visibility and its
// description, unless given again.

import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import {
  hasOneServerPluginPaths,
  oneServerPluginDocuments,
  type OneServerPlugin,
  type PluginFiles,
  readOneServerPlugin,
} from "@stigmer/plugin-package";
import { preparePluginArchive } from "@stigmer/plugin-package/client";
import { isNotFound, type Stigmer } from "@stigmer/client";
import { UsageError } from "../../errors/index.js";
import { count, pluginRefusal, type PreparedPluginPush } from "../plugin.js";

/** Parse repeated `--header K=V` values; a name given twice is refused. */
export function parseHeaders(values: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const raw of values) {
    const eq = raw.indexOf("=");
    const key = eq < 0 ? "" : raw.slice(0, eq).trim();
    if (key === "") {
      throw new UsageError("invalid --header: expected NAME=VALUE, e.g. --header 'Authorization=Bearer ${API_TOKEN}'");
    }
    if (Object.hasOwn(headers, key)) throw new UsageError(`--header ${key} is given twice`);
    headers[key] = raw.slice(eq + 1);
  }
  return headers;
}

/**
 * Build and validate the one-server plugin, ready to push. Refused with the
 * library's own sentences when the name or the address is not one a plugin
 * may carry.
 */
export async function prepareServerPlugin(input: OneServerPlugin): Promise<PreparedPluginPush> {
  const files = documentFiles(oneServerPluginDocuments(input));
  const stats = {
    filesIncluded: files.entries.length,
    filesIgnored: 0,
    dirsSkipped: 0,
    totalSize: files.entries.reduce((sum, entry) => sum + entry.size, 0),
  };
  const outcome = await preparePluginArchive({ files, stats });
  if (!outcome.ok) throw pluginRefusal(`mcp add ${input.name}`, outcome.errors, outcome.warnings);
  return {
    dir: input.name,
    files: outcome.prepared.files,
    stats,
    plugin: outcome.prepared.plugin,
    warnings: outcome.prepared.warnings,
    archive: outcome.prepared.archive,
    digest: outcome.prepared.digest,
  };
}

/**
 * Documents held in memory as the file set the archive is read from: entries
 * sorted by path, and a read that refuses a path the set does not hold.
 */
export function documentFiles(documents: ReadonlyMap<string, string>): PluginFiles {
  const encoder = new TextEncoder();
  const bytes = new Map([...documents].map(([path, text]) => [path, encoder.encode(text)]));
  const entries = [...bytes]
    .map(([path, content]) => ({ path, size: content.length }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    entries,
    read: (path) => {
      const content = bytes.get(path);
      if (content === undefined) throw new Error(`no file '${path}' in the plugin`);
      return content;
    },
  };
}

/** What is installed under the name `mcp add` was given. */
export type InstalledUnderName =
  /** Nothing: the plugin is created. */
  | { readonly kind: "none" }
  /** A plugin of this one server and nothing else, as its files read: it may be changed. */
  | { readonly kind: "one-server"; readonly plugin: Plugin; readonly server: OneServerPlugin }
  /** Anything else (pushed from a folder): changing it here would flatten it. */
  | { readonly kind: "other"; readonly plugin: Plugin };

/** The client surface the installed plugin is read through. */
export type InstalledPluginClient = Pick<Stigmer, "plugin">;

/**
 * Read what `org` holds under `name`: nothing, a one-server plugin (from the
 * installed version's own files), or any other plugin.
 */
export async function readInstalledUnderName(
  client: InstalledPluginClient,
  org: string,
  name: string,
): Promise<InstalledUnderName> {
  let plugin: Plugin;
  try {
    plugin = await client.plugin.getByReference({ org, slug: name });
  } catch (err) {
    if (isNotFound(err)) return { kind: "none" };
    throw err;
  }
  const status = plugin.status;
  const pluginId = plugin.metadata?.id ?? "";
  const digest = status?.digest ?? "";
  // The served files leave an eval suite out, so a plugin that has one is
  // never read as one server, whatever its other files say.
  if (status?.evals !== undefined || pluginId === "" || digest === "") return { kind: "other", plugin };
  const listed = await client.plugin.listFiles({ pluginId, digest });
  const paths = listed.files.map((file) => file.path);
  if (!hasOneServerPluginPaths(paths)) return { kind: "other", plugin };
  const decoder = new TextDecoder();
  const documents = new Map<string, string>();
  for (const path of paths) {
    const file = await client.plugin.readFile({ pluginId, digest, path });
    documents.set(path, decoder.decode(file.content));
  }
  const server = readOneServerPlugin(documents);
  if (server === undefined || server.name !== (plugin.metadata?.slug ?? name)) return { kind: "other", plugin };
  return { kind: "one-server", plugin, server };
}

/**
 * The refusal for a plugin `mcp add` did not make: what it holds, and the
 * way it changes.
 */
export function notOneServerRefusal(name: string, plugin: Plugin): UsageError {
  return new UsageError(
    `'${name}' was pushed from a folder and holds ${holdings(plugin)}; stigmer mcp add would replace all of it with one server.\n` +
      "Change its folder and run stigmer push plugin <folder>, or remove it first with " +
      `stigmer delete plugin ${name} and add the server again.`,
  );
}

// What a plugin holds, in words: its skills, servers, agents, hooks and evals.
function holdings(plugin: Plugin): string {
  const status = plugin.status;
  const parts: string[] = [];
  const skills = status?.skills.length ?? 0;
  const servers = status?.mcpServers.length ?? 0;
  const agents = status?.agents.length ?? 0;
  if (skills > 0) parts.push(count(skills, "skill"));
  if (servers > 0) parts.push(count(servers, "server"));
  if (agents > 0) parts.push(count(agents, "agent"));
  if ((status?.hooks?.groups.length ?? 0) > 0) parts.push("hooks");
  if (status?.evals !== undefined) parts.push("evals");
  if (skills === 0 && agents === 0 && servers <= 1 && parts.length === (servers > 0 ? 1 : 0)) parts.push("other files");
  return joinWords(parts);
}

function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * What changing a one-server plugin to `next` at `visibility` would change,
 * in words, for the dry run: its address (old and new), its headers, its
 * description, its visibility.
 */
export function describeChange(
  installed: Extract<InstalledUnderName, { kind: "one-server" }>,
  next: OneServerPlugin,
  visibility: ApiResourceVisibility | undefined,
): string {
  const was = installed.server;
  const url = next.url.trim();
  const parts: string[] = [];
  if (was.url !== url) parts.push(`its address (${was.url} → ${url})`);
  if (headersOf(was) !== headersOf(next)) parts.push("its headers");
  if ((was.description ?? "") !== (next.description?.trim() ?? "")) parts.push("its description");
  if (visibility !== undefined && visibility !== installed.plugin.metadata?.visibility) parts.push("its visibility");
  return parts.join(", ");
}

/** A server's headers in the builder's own normal form (trimmed, in name order), for comparing. */
function headersOf(server: OneServerPlugin): string {
  const documents = oneServerPluginDocuments({ ...server, name: "x" });
  const parsed = JSON.parse(documents.get(".mcp.json") ?? "{}") as { mcpServers?: { x?: { headers?: unknown } } };
  return JSON.stringify(parsed.mcpServers?.x?.headers ?? {});
}
