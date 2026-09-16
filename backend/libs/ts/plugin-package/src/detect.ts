/**
 * Which manifests a package carries, which one gives it its identity, and
 * what they agree on.
 *
 * A root `plugin.json` (the open format) is the identity when present, and
 * any vendor manifests beside it contribute only their dialect data
 * (declared paths, variables, inline servers). Without a root manifest the
 * precedence is Claude, Cursor, Codex: the first present names the plugin.
 * Every present manifest is read, so a plugin that ships two dialects has
 * both honoured; a `name` present in two manifests with different values is
 * refused, because a plugin that is two plugins depending on who reads it
 * is exactly the drift Stigmer will not carry.
 *
 * The plugin name obeys the open format's rule in every dialect (1 to 64
 * characters of `a-z 0-9 - .`, alphanumeric at both ends, no `--` or `..`);
 * Cursor's published pattern is the same rule minus the repetition clause.
 * Slugging is the installer's, not the reader's.
 *
 * MCP configuration sources are resolved here too, because a default
 * location is a cross-manifest fact: `mcp.json` is read under the open
 * rules when a root manifest exists; a Claude or Codex manifest that
 * declares no `mcpServers` reads `.mcp.json` when present; Cursor reads
 * only what it declares. Sub-agent files (`agents/*.md`) are a vendor
 * component: they are read when any vendor manifest is present and recorded
 * as ignored otherwise, since the open format defines no such component.
 */

import { readClaudeManifest, CLAUDE_DEFAULT_MCP_CONFIG } from "./dialects/claude.js";
import { readCodexManifest } from "./dialects/codex.js";
import { readCursorManifest } from "./dialects/cursor.js";
import type { DialectManifest, McpConfigSource } from "./dialects/manifest.js";
import { readOpenManifest } from "./dialects/open.js";
import { type JsonObject, parseJsonObject, readText } from "./documents.js";
import type { PluginFileIndex } from "./files.js";
import { type Findings, MANIFEST_LOCATIONS } from "./messages.js";
import type { PluginDialect } from "./types.js";

/** The open format's `mcp.json`, a fixed location. */
export const OPEN_MCP_CONFIG = "mcp.json";

/** The vendor precedence when no root manifest exists. */
const VENDOR_PRECEDENCE: readonly Exclude<PluginDialect, "agent-plugins">[] = ["claude", "cursor", "codex"];

const NAME_MAX_LENGTH = 64;
const NAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

export interface ManifestSet {
  /** The dialect that gave the plugin its identity. */
  readonly dialect: PluginDialect;
  /** Identity first, then the others in location order. */
  readonly manifests: readonly DialectManifest[];
  /** The validated plugin name; `undefined` after a name finding. */
  readonly name: string | undefined;
  /** True when a vendor manifest is present, so `agents/*.md` is a component. */
  readonly readsAgents: boolean;
  readonly mcpSources: readonly McpConfigSource[];
}

/** True when the directory holds any of the four manifests; the CLI's routing test. */
export function hasPluginManifest(paths: Iterable<string>): boolean {
  const locations = new Set<string>(Object.values(MANIFEST_LOCATIONS));
  for (const path of paths) if (locations.has(path)) return true;
  return false;
}

/** Read every present manifest; `undefined` (after `no-manifest`) when there is none. */
export function detectManifests(index: PluginFileIndex, findings: Findings): ManifestSet | undefined {
  const manifests: DialectManifest[] = [];
  const present = (dialect: PluginDialect): DialectManifest | undefined => {
    const path = MANIFEST_LOCATIONS[dialect];
    if (!index.has(path)) return undefined;
    const object = readManifestObject(index, path, findings);
    // An unreadable manifest still counts as present: the finding already
    // says why, and an empty contribution keeps the read going.
    const manifest = object === undefined ? emptyManifest(dialect, path) : readDialect(dialect, object, path, findings);
    manifests.push(manifest);
    return manifest;
  };

  const root = present("agent-plugins");
  const vendors = VENDOR_PRECEDENCE.map(present).filter((m): m is DialectManifest => m !== undefined);
  if (manifests.length === 0) {
    findings.error("no-manifest");
    return undefined;
  }

  const identity = root ?? vendors[0];
  if (identity === undefined) {
    // Unreachable: manifests is non-empty, so root or vendors[0] exists.
    throw new Error("manifest set without an identity manifest");
  }
  const ordered = [identity, ...manifests.filter((m) => m !== identity)];
  const name = resolveName(identity, ordered, findings);

  return {
    dialect: identity.dialect,
    manifests: ordered,
    name,
    readsAgents: vendors.length > 0,
    mcpSources: resolveMcpSources(index, root, vendors),
  };
}

function readManifestObject(index: PluginFileIndex, path: string, findings: Findings): JsonObject | undefined {
  const text = readText(index, path, "manifest", findings);
  return text === undefined ? undefined : parseJsonObject(text, path, "manifest-unreadable", findings);
}

function readDialect(dialect: PluginDialect, object: JsonObject, path: string, findings: Findings): DialectManifest {
  switch (dialect) {
    case "agent-plugins":
      return readOpenManifest(object, path, findings);
    case "claude":
      return readClaudeManifest(object, path, findings);
    case "cursor":
      return readCursorManifest(object, path, findings);
    case "codex":
      return readCodexManifest(object, path, findings);
    default: {
      const exhaustive: never = dialect;
      throw new Error(`unknown dialect ${String(exhaustive)}`);
    }
  }
}

function emptyManifest(dialect: PluginDialect, path: string): DialectManifest {
  return { dialect, path, identity: {}, skillPaths: [], mcpConfigs: [], ignored: [] };
}

function resolveName(identity: DialectManifest, all: readonly DialectManifest[], findings: Findings): string | undefined {
  const name = identity.identity.name;
  if (name === undefined) {
    // An unreadable identity manifest already reported itself; a second
    // finding about its missing name would blame the author twice.
    if (findings.errors.some((f) => f.kind === "manifest-unreadable" && f.path === identity.path)) return undefined;
    findings.error("manifest-name-missing", { path: identity.path });
    return undefined;
  }
  let valid = true;
  if (!isValidPluginName(name)) {
    findings.error("manifest-name-invalid", { path: identity.path, subject: name });
    valid = false;
  }
  for (const other of all) {
    if (other === identity) continue;
    const otherName = other.identity.name;
    if (otherName !== undefined && otherName !== name) {
      findings.error("manifest-name-conflict", {
        path: identity.path,
        subject: name,
        detail: `'${otherName}' in '${other.path}'`,
      });
      valid = false;
    }
  }
  return valid ? name : undefined;
}

/** The open format's name rule, applied in every dialect. */
export function isValidPluginName(name: string): boolean {
  return name.length <= NAME_MAX_LENGTH && NAME_PATTERN.test(name) && !name.includes("--") && !name.includes("..");
}

function resolveMcpSources(
  index: PluginFileIndex,
  root: DialectManifest | undefined,
  vendors: readonly DialectManifest[],
): readonly McpConfigSource[] {
  const sources: McpConfigSource[] = [];
  if (root !== undefined && index.has(OPEN_MCP_CONFIG)) {
    sources.push({ kind: "file", path: OPEN_MCP_CONFIG, dialect: "agent-plugins", manifest: root.path });
  }
  for (const vendor of vendors) {
    if (vendor.mcpConfigs.length > 0) {
      sources.push(...vendor.mcpConfigs);
    } else if (vendor.dialect !== "cursor" && index.has(CLAUDE_DEFAULT_MCP_CONFIG)) {
      sources.push({ kind: "file", path: CLAUDE_DEFAULT_MCP_CONFIG, dialect: vendor.dialect, manifest: vendor.path });
    }
  }
  // Two manifests may name the same file (Claude and Codex both defaulting
  // to `.mcp.json`); reading it twice would report every server twice.
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (source.kind === "inline") return true;
    if (seen.has(source.path)) return false;
    seen.add(source.path);
    return true;
  });
}
