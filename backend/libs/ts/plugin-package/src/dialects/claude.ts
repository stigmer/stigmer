/**
 * The Claude Code manifest (`.claude-plugin/plugin.json`), and the shape the
 * Codex compatibility manifest shares with it.
 *
 * Claude's manifest is optional in its own tool (without one, the directory
 * name is the plugin name) and `name` is its only required field. Path
 * fields are a string or an array of strings, `./`-prefixed: `skills` ADDS
 * to the default `skills/` scan and may name a directory that is itself a
 * skill; `agents` REPLACES the default `agents/` and its entries are files
 * or directories. `mcpServers` is a path, an inline object, or an array of
 * either, defaulting to `.mcp.json` at the plugin root. `userConfig`
 * declares the variables a user is prompted for. Hooks, LSP servers,
 * channels, output styles, workflows and the experimental components are
 * recorded as ignored.
 *
 * The reader is exported with its known-field set so the Codex dialect,
 * whose legacy manifest is this shape plus `apps` and `interface`, reuses it
 * rather than restating it.
 */

import type { JsonObject } from "../documents.js";
import type { Findings } from "../messages.js";
import type { PluginDialect } from "../types.js";
import {
  type DialectManifest,
  ignoredFieldComponents,
  readDeclaredPaths,
  readIdentity,
  readMcpSources,
  warnUnknownFields,
} from "./manifest.js";

export const CLAUDE_KNOWN_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "skills",
  "commands",
  "agents",
  "workflows",
  "hooks",
  "mcpServers",
  "outputStyles",
  "lspServers",
  "experimental",
  "userConfig",
  "channels",
  "dependencies",
  "defaultEnabled",
]);

/** The default MCP configuration file when the manifest declares none. */
export const CLAUDE_DEFAULT_MCP_CONFIG = ".mcp.json";

export function readClaudeManifest(object: JsonObject, path: string, findings: Findings): DialectManifest {
  return readClaudeShapedManifest(object, path, "claude", CLAUDE_KNOWN_FIELDS, findings);
}

/** The Claude shape under a given dialect and known-field set (Codex reuses it). */
export function readClaudeShapedManifest(
  object: JsonObject,
  path: string,
  dialect: PluginDialect,
  known: ReadonlySet<string>,
  findings: Findings,
): DialectManifest {
  warnUnknownFields(object, known, path, findings);
  const identity = readIdentity(object, path, findings);
  const skillPaths = readDeclaredPaths(object, "skills", path, findings) ?? [];
  const agentPaths = readDeclaredPaths(object, "agents", path, findings);
  const declaredMcp = readMcpSources(object, "mcpServers", path, dialect, findings);
  const manifest: { -readonly [K in keyof DialectManifest]: DialectManifest[K] } = {
    dialect,
    path,
    identity,
    skillPaths,
    mcpConfigs: declaredMcp,
    ignored: ignoredFieldComponents(object, path),
  };
  if (agentPaths !== undefined) manifest.agentPaths = agentPaths;
  if (object["userConfig"] !== undefined) {
    manifest.variables = { dialect: "claude", value: object["userConfig"], manifest: path };
  }
  return manifest;
}
