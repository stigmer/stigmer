/**
 * MCP server entries, from every configuration source, into the two shapes
 * `McpServerSpec` takes.
 *
 * The open format and the vendor dialects differ on strictness and the
 * source's dialect decides: an open `mcp.json` requires `type` and closes
 * each transport's field set (an unknown field refuses the entry), while a
 * vendor `.mcp.json` infers the transport from `command` or `url` and
 * carries fields Stigmer does not read as warnings (Cursor's undocumented
 * `auth` block has its own, because OAuth on Stigmer has its own home in the
 * `ai.stigmer/` overlay). `streamable-http` and `http` are one transport;
 * the legacy `sse` maps to it with a warning, because the runner connects
 * both with Streamable HTTP and its adapter falls back to SSE when the
 * server rejects that.
 *
 * Four refusals are facts about the runner, not preferences: it mounts no
 * plugin files (so a `./`-relative command, any plugin-root placeholder,
 * and any `cwd` can never resolve); it sends a server's `url` as written
 * (so a `${VAR}` there would be sent literally); and it hands a stdio
 * subprocess exactly the variables the spec declares, by name (so an `env`
 * entry is representable only as `KEY: "${KEY}"`).
 *
 * Every `${VAR}` in a header, an argument, an `env` value or an `auth` value
 * is a reference to the caller's Environment, listed on the server's `env`;
 * the variables module declares the undeclared ones. Claude's
 * `${user_config.KEY}` is rewritten to `${KEY}` before anything is scanned.
 */

import type { McpConfigSource } from "../dialects/manifest.js";
import {
  describeValue,
  fields,
  isJsonObject,
  isStringArray,
  isStringRecord,
  type JsonObject,
  parseJsonObject,
  readText,
} from "../documents.js";
import type { PluginFileIndex } from "../files.js";
import { AGENT_PLUGINS_MCP_SCHEMA, type Findings } from "../messages.js";
import {
  findPluginRootPlaceholder,
  PLUGIN_ROOT_ENV_NAMES,
  referencedVariables,
  rewriteUserConfig,
  singlePlaceholderName,
  VARIABLE_NAME_PATTERN,
} from "../placeholders.js";
import type { PluginMcpServer } from "../types.js";

const OPEN_CONFIG_FIELDS: ReadonlySet<string> = new Set(["$schema", "mcpServers"]);
const OPEN_STDIO_FIELDS: ReadonlySet<string> = new Set(["type", "command", "args", "env", "cwd"]);
const OPEN_HTTP_FIELDS: ReadonlySet<string> = new Set(["type", "url", "headers"]);
const VENDOR_STDIO_FIELDS: ReadonlySet<string> = new Set(["type", "command", "args", "env", "cwd"]);
const VENDOR_HTTP_FIELDS: ReadonlySet<string> = new Set(["type", "url", "headers"]);

// RFC 9110 token characters, the set a header field name may use.
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

type Transport = "stdio" | "http";

export interface McpServersResult {
  readonly servers: readonly PluginMcpServer[];
  /**
   * How many entries were refused. The variables stage reads it: a refused
   * server's references are unknown, so "declared but unreferenced" would be
   * a consequence of the refusal rather than advice, and is not warned.
   */
  readonly refused: number;
  /**
   * Every server name the sources declared, accepted or refused. The overlay
   * checks against this, so a refused server's overlay is not a second refusal.
   */
  readonly declaredNames: ReadonlySet<string>;
}

export function normaliseMcpServers(index: PluginFileIndex, sources: readonly McpConfigSource[], findings: Findings): McpServersResult {
  const servers: PluginMcpServer[] = [];
  const seen = new Set<string>();
  let refused = 0;
  for (const source of sources) {
    const entries = readSource(index, source, findings);
    if (entries === undefined) {
      refused++;
      continue;
    }
    for (const [name, raw] of fields(entries.servers)) {
      if (seen.has(name)) {
        findings.error("mcp-server-name-duplicate", { subject: name, path: entries.path });
        refused++;
        continue;
      }
      seen.add(name);
      const server = readServer(name, raw, entries.path, source.dialect === "agent-plugins", findings);
      if (server !== undefined) servers.push(server);
      else refused++;
    }
  }
  return { servers, refused, declaredNames: seen };
}

interface ServerEntries {
  readonly path: string;
  readonly servers: JsonObject;
}

function readSource(index: PluginFileIndex, source: McpConfigSource, findings: Findings): ServerEntries | undefined {
  const open = source.dialect === "agent-plugins";
  if (source.kind === "inline") {
    // An inline value is either the whole configuration shape or the
    // server map itself; both are seen in the wild and both mean one thing.
    const wrapped = isJsonObject(source.servers) ? source.servers["mcpServers"] : undefined;
    const servers = isJsonObject(wrapped) ? wrapped : source.servers;
    if (!isJsonObject(servers)) {
      findings.error("mcp-config-shape", { path: source.manifest });
      return undefined;
    }
    return { path: source.manifest, servers };
  }

  if (!index.has(source.path)) {
    findings.warn("path-missing", { path: source.manifest, subject: `./${source.path}` });
    return undefined;
  }
  const text = readText(index, source.path, "mcpConfig", findings);
  if (text === undefined) return undefined;
  const object = parseJsonObject(text, source.path, "mcp-config-unreadable", findings);
  if (object === undefined) return undefined;

  if (open) {
    const schema = object["$schema"];
    if (schema === undefined) {
      findings.error("mcp-config-schema-missing", { path: source.path });
    } else if (schema !== AGENT_PLUGINS_MCP_SCHEMA) {
      findings.error("mcp-config-schema-unsupported", { path: source.path, detail: describeValue(schema) });
    }
  }
  for (const [name] of fields(object)) {
    if (OPEN_CONFIG_FIELDS.has(name)) continue;
    if (open) findings.error("mcp-config-field-unknown", { path: source.path, subject: name });
    else findings.warn("mcp-config-field-ignored", { path: source.path, subject: name });
  }
  const servers = object["mcpServers"];
  if (!isJsonObject(servers)) {
    findings.error("mcp-config-shape", { path: source.path });
    return undefined;
  }
  return { path: source.path, servers };
}

function readServer(name: string, raw: unknown, path: string, open: boolean, findings: Findings): PluginMcpServer | undefined {
  const ctx = { subject: name, path };
  if (!isJsonObject(raw)) {
    findings.error("mcp-server-shape", ctx);
    return undefined;
  }
  const transport = resolveTransport(raw, ctx, open, findings);
  if (transport === undefined) return undefined;

  const known = transport === "stdio" ? (open ? OPEN_STDIO_FIELDS : VENDOR_STDIO_FIELDS) : open ? OPEN_HTTP_FIELDS : VENDOR_HTTP_FIELDS;
  const references = new Set<string>();
  let valid = true;
  for (const [field, value] of fields(raw)) {
    if (known.has(field)) continue;
    if (open) {
      findings.error("mcp-server-field-unknown", { ...ctx, detail: field });
      valid = false;
    } else if (field === "auth") {
      findings.warn("mcp-server-auth-ignored", ctx);
      for (const text of stringsWithin(value)) collectReferences(text, references);
    } else {
      findings.warn("mcp-server-field-ignored", { ...ctx, detail: field });
    }
  }
  if (!valid) return undefined;

  return transport === "stdio" ? readStdio(name, raw, ctx, references, findings) : readHttp(name, raw, ctx, references, findings);
}

interface Ctx {
  readonly subject: string;
  readonly path: string;
}

function resolveTransport(raw: JsonObject, ctx: Ctx, open: boolean, findings: Findings): Transport | undefined {
  const type = raw["type"];
  if (type !== undefined && typeof type !== "string") {
    findings.error("mcp-server-field-type", { ...ctx, detail: "type" });
    return undefined;
  }
  if (type === undefined) {
    if (open) {
      findings.error("mcp-server-type-missing", ctx);
      return undefined;
    }
    const hasCommand = raw["command"] !== undefined;
    const hasUrl = raw["url"] !== undefined;
    if (hasCommand && hasUrl) {
      findings.error("mcp-server-type-ambiguous", ctx);
      return undefined;
    }
    if (hasCommand) return "stdio";
    if (hasUrl) return "http";
    findings.error("mcp-server-transport-unknown", ctx);
    return undefined;
  }
  switch (type) {
    case "stdio":
      return "stdio";
    case "streamable-http":
      return "http";
    case "http":
      if (open) {
        findings.error("mcp-server-type-unknown", { ...ctx, detail: type });
        return undefined;
      }
      return "http";
    case "sse":
      findings.warn("mcp-server-sse-mapped", ctx);
      return "http";
    default:
      findings.error("mcp-server-type-unknown", { ...ctx, detail: type });
      return undefined;
  }
}

function readStdio(name: string, raw: JsonObject, ctx: Ctx, references: Set<string>, findings: Findings): PluginMcpServer | undefined {
  let valid = true;
  const fail = (): void => {
    valid = false;
  };

  const command = raw["command"];
  if (command === undefined) {
    findings.error("mcp-server-command-missing", ctx);
    fail();
  } else if (typeof command !== "string") {
    findings.error("mcp-server-field-type", { ...ctx, detail: "command" });
    fail();
  } else {
    const root = findPluginRootPlaceholder(command);
    if (root !== undefined) {
      findings.error("mcp-server-plugin-root-reference", { ...ctx, detail: root });
      fail();
    } else if (command.startsWith("./")) {
      findings.error("mcp-server-command-relative", { ...ctx, detail: command });
      fail();
    } else if (command === "" || /\s/.test(command) || command.includes("/")) {
      findings.error("mcp-server-command-invalid", ctx);
      fail();
    }
  }

  const args: string[] = [];
  const rawArgs = raw["args"];
  if (rawArgs !== undefined) {
    if (!isStringArray(rawArgs)) {
      findings.error("mcp-server-field-type", { ...ctx, detail: "args" });
      fail();
    } else {
      for (const arg of rawArgs) {
        const rewritten = rewriteUserConfig(arg);
        const root = findPluginRootPlaceholder(rewritten);
        if (root !== undefined) {
          findings.error("mcp-server-plugin-root-reference", { ...ctx, detail: root });
          fail();
          continue;
        }
        collectReferences(rewritten, references);
        args.push(rewritten);
      }
    }
  }

  const rawEnv = raw["env"];
  if (rawEnv !== undefined) {
    if (!isStringRecord(rawEnv)) {
      findings.error("mcp-server-field-type", { ...ctx, detail: "env" });
      fail();
    } else {
      for (const [key, value] of Object.entries(rawEnv)) {
        if (PLUGIN_ROOT_ENV_NAMES.has(key)) {
          findings.error("mcp-server-plugin-root-reference", { ...ctx, detail: key });
          fail();
          continue;
        }
        if (!VARIABLE_NAME_PATTERN.test(key)) {
          findings.error("variable-name-invalid", { subject: key, path: ctx.path });
          fail();
          continue;
        }
        const rewritten = rewriteUserConfig(value);
        const root = findPluginRootPlaceholder(rewritten);
        if (root !== undefined) {
          findings.error("mcp-server-plugin-root-reference", { ...ctx, detail: root });
          fail();
          continue;
        }
        const referenced = singlePlaceholderName(rewritten);
        if (referenced === undefined) {
          findings.error("mcp-server-env-literal", { ...ctx, detail: key });
          fail();
        } else if (referenced !== key) {
          findings.error("mcp-server-env-rename", { ...ctx, detail: key });
          fail();
        } else {
          references.add(key);
        }
      }
    }
  }

  if (raw["cwd"] !== undefined) {
    findings.error("mcp-server-cwd-unsupported", ctx);
    fail();
  }

  if (!valid || typeof command !== "string") return undefined;
  return { name, transport: "stdio", command, args, env: [...references].sort() };
}

function readHttp(name: string, raw: JsonObject, ctx: Ctx, references: Set<string>, findings: Findings): PluginMcpServer | undefined {
  let valid = true;
  const fail = (): void => {
    valid = false;
  };

  let url: string | undefined;
  const rawUrl = raw["url"];
  if (rawUrl === undefined) {
    findings.error("mcp-server-url-missing", ctx);
    fail();
  } else if (typeof rawUrl !== "string") {
    findings.error("mcp-server-field-type", { ...ctx, detail: "url" });
    fail();
  } else {
    url = rewriteUserConfig(rawUrl);
    const root = findPluginRootPlaceholder(url);
    if (root !== undefined) {
      findings.error("mcp-server-plugin-root-reference", { ...ctx, detail: root });
      fail();
    } else if (referencedVariables(url).length > 0) {
      findings.error("mcp-server-url-variable", ctx);
      fail();
    } else if (!isAcceptableServerUrl(url)) {
      findings.error("mcp-server-url-invalid", { ...ctx, detail: url });
      fail();
    }
  }

  // Collected as pairs and materialised with `Object.fromEntries`, which
  // defines own properties: a header literally named `__proto__` (a valid
  // token) must become a key, never a prototype assignment.
  const headers: [string, string][] = [];
  const rawHeaders = raw["headers"];
  if (rawHeaders !== undefined) {
    if (!isStringRecord(rawHeaders)) {
      findings.error("mcp-server-field-type", { ...ctx, detail: "headers" });
      fail();
    } else {
      const lowered = new Set<string>();
      for (const [header, value] of Object.entries(rawHeaders)) {
        if (!HEADER_NAME_PATTERN.test(header)) {
          findings.error("mcp-server-header-invalid", { ...ctx, detail: header });
          fail();
          continue;
        }
        const key = header.toLowerCase();
        if (lowered.has(key)) {
          findings.error("mcp-server-header-duplicate", { ...ctx, detail: header });
          fail();
          continue;
        }
        lowered.add(key);
        const rewritten = rewriteUserConfig(value);
        const root = findPluginRootPlaceholder(rewritten);
        if (root !== undefined) {
          findings.error("mcp-server-plugin-root-reference", { ...ctx, detail: root });
          fail();
          continue;
        }
        collectReferences(rewritten, references);
        headers.push([header, rewritten]);
      }
    }
  }

  if (!valid || url === undefined) return undefined;
  return { name, transport: "http", url, headers: Object.fromEntries(headers), env: [...references].sort() };
}

/**
 * The open format's URL rule: absolute HTTP(S), no user information, no
 * fragment, HTTPS unless the host is loopback. Applied in every dialect
 * because the runner's `HttpServerConfig.url` must be a URI and a plugin
 * that fails here would fail there.
 */
function isAcceptableServerUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") return false;
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return isLoopbackHost(url.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function collectReferences(text: string, into: Set<string>): void {
  for (const name of referencedVariables(text)) into.add(name);
}

/** Every string nested anywhere in a JSON value (the `auth` block's values). */
function stringsWithin(value: unknown): readonly string[] {
  if (typeof value === "string") return [rewriteUserConfig(value)];
  if (Array.isArray(value)) return value.flatMap(stringsWithin);
  if (isJsonObject(value)) return Object.values(value).flatMap(stringsWithin);
  return [];
}
