// `stigmer mcp add`: one MCP server at an address, made into a plugin of its
// own, as Claude Code's `claude mcp add` adds one server.
//
// An MCP server lives only in a plugin, so a one-off server is a plugin
// holding nothing else: a Claude Code manifest naming the plugin and a
// `.mcp.json` naming the one server, both called `<name>`. The files are
// built in memory and go through the same shared tail every push runs
// (`preparePluginArchive`: read, validate, zip, digest), so the plugin is
// validated by the library the server installs with, and a refusal reads
// like any other plugin's. The headers are written as given; a value may
// name a key in the caller's vault as `${NAME}`, which the plugin then
// declares, exactly as a hand-written `.mcp.json` would.
//
// The JSON is serialized with sorted keys, so the same name, address and
// headers always make the same archive and the same digest: a second
// `mcp add` of an unchanged server changes nothing.

import type { PluginFiles } from "@stigmer/plugin-package";
import { preparePluginArchive } from "@stigmer/plugin-package/client";
import { UsageError } from "../../errors/index.js";
import { pluginRefusal, type PreparedPluginPush } from "../plugin.js";

/** The two documents of a one-server plugin, by path. */
export function serverPluginDocuments(
  name: string,
  url: string,
  headers: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  const server: Record<string, unknown> = { type: "http", url };
  if (Object.keys(headers).length > 0) server.headers = sortedRecord(headers);
  return new Map([
    [".claude-plugin/plugin.json", `${JSON.stringify({ name }, null, 2)}\n`],
    [".mcp.json", `${JSON.stringify({ mcpServers: { [name]: server } }, null, 2)}\n`],
  ]);
}

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
export async function prepareServerPlugin(
  name: string,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<PreparedPluginPush> {
  const documents = serverPluginDocuments(name, url, headers);
  const encoder = new TextEncoder();
  const bytes = new Map([...documents].map(([path, text]) => [path, encoder.encode(text)]));
  const entries = [...bytes]
    .map(([path, content]) => ({ path, size: content.length }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files: PluginFiles = {
    entries,
    read: (path) => {
      const content = bytes.get(path);
      if (content === undefined) throw new Error(`no file '${path}' in the plugin`);
      return content;
    },
  };
  const stats = {
    filesIncluded: entries.length,
    filesIgnored: 0,
    dirsSkipped: 0,
    totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
  const outcome = await preparePluginArchive({ files, stats });
  if (!outcome.ok) throw pluginRefusal(`mcp add ${name}`, outcome.errors, outcome.warnings);
  return {
    dir: name,
    files: outcome.prepared.files,
    stats,
    plugin: outcome.prepared.plugin,
    warnings: outcome.prepared.warnings,
    archive: outcome.prepared.archive,
    digest: outcome.prepared.digest,
  };
}

function sortedRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
