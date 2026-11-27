/**
 * A plugin of one HTTP server: the two documents both surfaces write, and
 * the reading that tells such a plugin apart from one pushed from a folder.
 *
 * The console's "Add MCP server" and the CLI's `stigmer mcp add` each make a
 * plugin holding nothing but one server at an address: a Claude Code
 * manifest naming the plugin and a `.mcp.json` naming the one server, both
 * called after the plugin. They write it through this one builder, so the
 * same name, address, headers and description make the same bytes, the same
 * archive and the same digest from either surface, and a change made on one
 * surface with nothing changed is a no-op on the other.
 *
 * Changing such a plugin's address rewrites both documents, which is safe
 * only while they are all the plugin holds. `readOneServerPlugin` answers
 * that from the plugin's own files, never from its status (which cannot see
 * a README beside them): the files must be exactly these two, the manifest
 * may carry only `name` and `description`, and `.mcp.json` must hold one
 * `http` server named as the plugin with only `type`, `url` and `headers`.
 * A served file list leaves a plugin's eval suite out, so a caller reading
 * served files must also require the plugin to have no eval suite.
 */

/** The paths of a one-server plugin's two documents, in path order. */
export const ONE_SERVER_PLUGIN_PATHS: readonly [string, string] = [".claude-plugin/plugin.json", ".mcp.json"];

/** What a one-server plugin is made from, and what reading one gives back. */
export interface OneServerPlugin {
  /** The plugin's name, which is also its one server's. */
  readonly name: string;
  /** The server's URL. */
  readonly url: string;
  /** Headers sent with every request; a value may name a variable as `${NAME}`. */
  readonly headers?: Readonly<Record<string, string>>;
  /** What the server is for, shown on the plugin's page; omitted when empty. */
  readonly description?: string;
}

/**
 * The two documents of a one-server plugin, by path. Every value is trimmed,
 * a header with an empty name is dropped, and the headers are written in
 * name order, so equal inputs always make equal bytes.
 */
export function oneServerPluginDocuments(input: OneServerPlugin): Map<string, string> {
  const name = input.name.trim();
  const description = input.description?.trim() ?? "";
  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {})
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key]) => key !== "")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const manifest = { name, ...(description !== "" && { description }) };
  const server = { type: "http", url: input.url.trim(), ...(Object.keys(headers).length > 0 && { headers }) };
  return new Map([
    [ONE_SERVER_PLUGIN_PATHS[0], `${JSON.stringify(manifest, null, 2)}\n`],
    [ONE_SERVER_PLUGIN_PATHS[1], `${JSON.stringify({ mcpServers: { [name]: server } }, null, 2)}\n`],
  ]);
}

/** Whether a version's file list is exactly a one-server plugin's two paths. */
export function hasOneServerPluginPaths(paths: readonly string[]): boolean {
  return paths.length === 2 && [...paths].sort().every((path, i) => path === ONE_SERVER_PLUGIN_PATHS[i]);
}

/**
 * The one server a plugin's documents describe, when the documents are
 * exactly a one-server plugin's; `undefined` for anything else (a third
 * file, a manifest field beyond `name` and `description`, a second server,
 * a server of another type or with fields beyond `type`, `url` and
 * `headers`, or a document that is not the JSON it should be).
 */
export function readOneServerPlugin(documents: ReadonlyMap<string, string>): OneServerPlugin | undefined {
  if (!hasOneServerPluginPaths([...documents.keys()])) return undefined;
  // Both paths are there: hasOneServerPluginPaths said so.
  const manifest = parseObject(documents.get(ONE_SERVER_PLUGIN_PATHS[0]) ?? "");
  const mcp = parseObject(documents.get(ONE_SERVER_PLUGIN_PATHS[1]) ?? "");
  if (manifest === undefined || mcp === undefined) return undefined;
  if (!onlyKeys(manifest, ["name", "description"]) || typeof manifest.name !== "string") return undefined;
  if (manifest.description !== undefined && typeof manifest.description !== "string") return undefined;
  if (!onlyKeys(mcp, ["mcpServers"])) return undefined;
  const servers = asObject(mcp.mcpServers);
  if (servers === undefined) return undefined;
  const entries = Object.entries(servers);
  if (entries.length !== 1) return undefined;
  const [serverName, raw] = entries[0]!;
  const server = asObject(raw);
  if (serverName !== manifest.name || server === undefined) return undefined;
  if (!onlyKeys(server, ["type", "url", "headers"]) || server.type !== "http" || typeof server.url !== "string") {
    return undefined;
  }
  let headers: Record<string, string> | undefined;
  if (server.headers !== undefined) {
    const given = asObject(server.headers);
    if (given === undefined || !Object.values(given).every((value) => typeof value === "string")) return undefined;
    headers = given as Record<string, string>;
  }
  return {
    name: manifest.name,
    url: server.url,
    ...(headers !== undefined && { headers }),
    ...(typeof manifest.description === "string" && manifest.description !== "" && { description: manifest.description }),
  };
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}
