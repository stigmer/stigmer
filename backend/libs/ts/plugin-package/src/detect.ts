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
 * only what it declares. Hooks sources resolve the same way: every vendor
 * manifest's declared sources, then `hooks/hooks.json` when it exists (the
 * default Claude Code, Cursor and Codex all read, merged with what is
 * declared), each file read once and tagged with the hook formats of the
 * manifests that reach it. Sub-agent files (`agents/*.md`) are a vendor
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
import type { HookFormat, PluginDialect } from "./types.js";

/** The open format's `mcp.json`, a fixed location. */
export const OPEN_MCP_CONFIG = "mcp.json";

/** The hooks file every vendor reads by default. */
export const DEFAULT_HOOKS_FILE = "hooks/hooks.json";

/**
 * A hooks source after resolution. A file carries every format a manifest
 * reaching it reads, so a file whose shape is none of them is refused; an
 * inline object has the one format of the manifest that holds it.
 */
export type ResolvedHookSource =
  | { readonly kind: "file"; readonly path: string; readonly formats: readonly HookFormat[]; readonly manifest: string }
  | { readonly kind: "inline"; readonly manifest: string; readonly value: JsonObject; readonly format: HookFormat };

/** The hook format a vendor dialect reads; Codex reads Claude Code's. */
export function hookFormatOf(dialect: Exclude<PluginDialect, "agent-plugins">): HookFormat {
  return dialect === "cursor" ? "cursor" : "claude-code";
}

/** The vendor precedence when no root manifest exists. */
const VENDOR_PRECEDENCE: readonly Exclude<PluginDialect, "agent-plugins">[] = ["claude", "cursor", "codex"];

/**
 * Every manifest location in the order that names a plugin: the root
 * manifest, then the vendors. The one precedence the reader applies,
 * exported so a partial read (`presentation.ts`) cannot rank the manifests
 * differently from the full one.
 */
export const MANIFEST_PRECEDENCE: readonly PluginDialect[] = ["agent-plugins", ...VENDOR_PRECEDENCE];

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
  readonly hookSources: readonly ResolvedHookSource[];
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
    hookSources: resolveHookSources(index, vendors),
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
  return { dialect, path, identity: {}, skillPaths: [], mcpConfigs: [], hookSources: [], ignored: [] };
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

function resolveHookSources(index: PluginFileIndex, vendors: readonly DialectManifest[]): readonly ResolvedHookSource[] {
  const sources: ResolvedHookSource[] = [];
  const files = new Map<string, { path: string; formats: HookFormat[]; manifest: string }>();
  const addFile = (path: string, format: HookFormat, manifest: string): void => {
    const existing = files.get(path);
    if (existing !== undefined) {
      if (!existing.formats.includes(format)) existing.formats.push(format);
      return;
    }
    const entry = { path, formats: [format], manifest };
    files.set(path, entry);
    sources.push({ kind: "file", path, formats: entry.formats, manifest });
  };
  for (const vendor of vendors) {
    if (vendor.dialect === "agent-plugins") continue;
    const format = hookFormatOf(vendor.dialect);
    for (const source of vendor.hookSources) {
      if (source.kind === "inline") sources.push({ kind: "inline", manifest: source.manifest, value: source.value, format });
      else addFile(source.path, format, source.manifest);
    }
    if (index.has(DEFAULT_HOOKS_FILE)) addFile(DEFAULT_HOOKS_FILE, format, vendor.path);
  }
  return sources;
}
