/**
 * The marketplace entry: a `PluginFiles` over a marketplace tree in, a
 * `MarketplaceReadOutcome` out.
 *
 * The read is a fixed sequence, like the plugin read: locate the marketplace
 * file (first present in the dialect precedence, and only that one is read;
 * a tree that carries two dialects' files describes one catalogue twice);
 * parse it under the marketplace cap; read the dialect's shape into the one
 * normalised shape; validate names and sources; drop the entries the tree
 * cannot install, each with its own warning. Findings are collected and the
 * read continues, so the outcome names every problem at once, and the
 * marketplace is returned only when nothing refused.
 *
 * A catalogue installs nothing by itself: a field a dialect uses to name
 * entries a client installs unasked (Codex's `INSTALLED_BY_DEFAULT` policy,
 * or a `defaults` list) is not read, so a file that still carries one reads
 * the same as a file without it.
 *
 * Sources. Every dialect names a plugin's directory relative to the
 * marketplace root (Claude and Codex with a `./` prefix, Cursor without,
 * Claude optionally under `metadata.pluginRoot`); the reader accepts both
 * spellings and refuses a path that escapes the root. A source that is not
 * such a directory (Claude's `github`, `url`, `npm` and `git-subdir` objects,
 * Codex's non-`local` sources, Cursor's remote URLs) is a form this reader
 * does not fetch: the entry is dropped with `entry-source-unsupported`, and
 * nothing is invented in its place.
 *
 * This reader does not open the plugins it lists. A consumer that wants an
 * entry's own description or version reads that directory with
 * `readPluginPackage`; a consumer that wants to install it hands the same
 * directory to the walker it already uses. Keeping the two reads apart is
 * what lets a catalogue of eighty entries be listed without eighty reads.
 *
 * `readMarketplaceFile` is the same read without the tree: what the file
 * declares, for a client that holds the file alone and asks only "does this
 * source offer a plugin called X" before it pays for the tree (the CLI's
 * bare-name search across GitHub sources fetches one small file per source
 * instead of a zipball each). Whether the tree holds an entry is still
 * `readMarketplace`'s to say, on the tree, before anything is installed.
 */

import { hasPluginManifest, isValidPluginName } from "../detect.js";
import { describeValue, isJsonObject, type JsonObject } from "../documents.js";
import { decodeUtf8, isContainedPath, PLUGIN_DOCUMENT_LIMITS, PluginFileIndex, type PluginFiles } from "../files.js";
import { MARKETPLACE_LOCATIONS, MarketplaceFindings } from "./messages.js";
import type { Marketplace, MarketplaceDialect, MarketplaceEntry, MarketplaceOwner, MarketplaceReadOutcome } from "./outcome.js";

/** The precedence the reader applies when a tree carries more than one marketplace file. */
const DIALECT_PRECEDENCE: readonly MarketplaceDialect[] = ["stigmer", "claude", "cursor", "codex"];

/** True when the tree holds any of the four marketplace files; the CLI's routing test. */
export function hasMarketplaceFile(paths: Iterable<string>): boolean {
  const locations = new Set<string>(Object.values(MARKETPLACE_LOCATIONS));
  for (const path of paths) if (locations.has(path)) return true;
  return false;
}

export function readMarketplace(files: PluginFiles): MarketplaceReadOutcome {
  return read(files, "tree");
}

/**
 * The marketplace file as declared, the tree unverified: every entry with a
 * readable source is offered, whether or not `files` holds its directory.
 * For a client that has fetched the file alone; never for an install.
 */
export function readMarketplaceFile(files: PluginFiles): MarketplaceReadOutcome {
  return read(files, "file");
}

/**
 * `tree`: entries whose directory the tree lacks, or holds without a plugin
 * manifest, are dropped with their warning. `file`: entries are taken as the
 * file declares them, and the tree is not consulted.
 */
function read(files: PluginFiles, verify: "tree" | "file"): MarketplaceReadOutcome {
  const findings = new MarketplaceFindings();
  const index = new PluginFileIndex(files);

  const located = locate(index);
  if (located === undefined) {
    findings.error("marketplace-not-found");
    return refused(findings);
  }
  const { dialect, path } = located;

  const object = readObject(index, path, findings);
  if (object === undefined) return refused(findings);

  const name = readName(object, path, findings);
  const raw = readEntries(object, dialect, path, findings);
  const entries = verify === "tree" ? offeredEntries(raw, index, path, findings) : declaredEntries(raw);

  if (findings.errors.length > 0 || name === undefined) return refused(findings);

  const description = readDescription(object, dialect);
  const owner = readOwner(object);
  const marketplace: Marketplace = {
    name,
    ...(description !== undefined && { description }),
    ...(owner !== undefined && { owner }),
    dialect,
    path,
    plugins: entries,
  };
  return { ok: true, marketplace, warnings: findings.warnings };
}

function refused(findings: MarketplaceFindings): MarketplaceReadOutcome {
  return { ok: false, errors: findings.errors, warnings: findings.warnings };
}

function locate(index: PluginFileIndex): { dialect: MarketplaceDialect; path: string } | undefined {
  for (const dialect of DIALECT_PRECEDENCE) {
    const path = MARKETPLACE_LOCATIONS[dialect];
    if (index.has(path)) return { dialect, path };
  }
  return undefined;
}

function readObject(index: PluginFileIndex, path: string, findings: MarketplaceFindings): JsonObject | undefined {
  const limit = PLUGIN_DOCUMENT_LIMITS.marketplace;
  const entry = index.entry(path);
  if (entry === undefined) {
    throw new Error(`marketplace file '${path}' is not listed`);
  }
  if (entry.size > limit) {
    findings.error("marketplace-too-large", { path, subject: String(entry.size), detail: String(limit) });
    return undefined;
  }
  const bytes = index.files.read(path);
  if (bytes.length > limit) {
    findings.error("marketplace-too-large", { path, subject: String(bytes.length), detail: String(limit) });
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(bytes));
  } catch (error) {
    findings.error("marketplace-unreadable", { path, detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
  if (!isJsonObject(value)) {
    findings.error("marketplace-unreadable", { path, detail: "the document is not a JSON object" });
    return undefined;
  }
  return value;
}

/** The marketplace's own name, validated under the plugin name rule (the same characters an install ref can carry). */
function readName(object: JsonObject, path: string, findings: MarketplaceFindings): string | undefined {
  const value = object["name"];
  if (value === undefined) {
    findings.error("marketplace-name-missing", { path });
    return undefined;
  }
  if (typeof value !== "string") {
    findings.error("marketplace-field-type", { path, subject: "name", detail: "a string" });
    return undefined;
  }
  if (!isValidPluginName(value)) {
    findings.error("marketplace-name-invalid", { path, subject: value });
    return undefined;
  }
  return value;
}

function readDescription(object: JsonObject, dialect: MarketplaceDialect): string | undefined {
  switch (dialect) {
    case "stigmer":
      return optionalStringOf(object, "description");
    case "claude":
    case "cursor": {
      const metadata = object["metadata"];
      return isJsonObject(metadata) ? optionalStringOf(metadata, "description") : undefined;
    }
    case "codex":
      // Codex's `interface.displayName` is a label for a picker, not a description.
      return undefined;
    default: {
      const exhaustive: never = dialect;
      return exhaustive;
    }
  }
}

function readOwner(object: JsonObject): MarketplaceOwner | undefined {
  const value = object["owner"];
  if (!isJsonObject(value)) return undefined;
  const name = optionalStringOf(value, "name");
  const email = optionalStringOf(value, "email");
  const url = optionalStringOf(value, "url");
  if (name === undefined && email === undefined && url === undefined) return undefined;
  return {
    ...(name !== undefined && { name }),
    ...(email !== undefined && { email }),
    ...(url !== undefined && { url }),
  };
}

/** A string field or `undefined`; a field of another type is treated as absent (metadata never refuses a catalogue). */
function optionalStringOf(object: JsonObject, field: string): string | undefined {
  const value = object[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * One entry as the file states it, before the tree is consulted. `dir` is
 * the resolved marketplace-relative directory, or `undefined` when the
 * source is a form this reader does not fetch (the warning is recorded here
 * so the entry's order in the file is kept for the sentence).
 */
interface RawEntry {
  readonly name: string;
  readonly dir: string | undefined;
  readonly description?: string;
}

function readEntries(object: JsonObject, dialect: MarketplaceDialect, path: string, findings: MarketplaceFindings): readonly RawEntry[] {
  const list = object["plugins"];
  if (list === undefined) {
    findings.error("marketplace-plugins-missing", { path });
    return [];
  }
  if (!Array.isArray(list)) {
    findings.error("marketplace-field-type", { path, subject: "plugins", detail: "an array" });
    return [];
  }
  const pluginRoot = dialect === "claude" ? claudePluginRoot(object) : "";

  const entries: RawEntry[] = [];
  const seen = new Set<string>();
  list.forEach((item: unknown, position: number) => {
    if (!isJsonObject(item)) {
      findings.error("entry-shape", { path, subject: String(position) });
      return;
    }
    const name = item["name"];
    if (name === undefined) {
      findings.error("entry-name-missing", { path, subject: String(position) });
      return;
    }
    if (typeof name !== "string" || !isValidPluginName(name)) {
      findings.error("entry-name-invalid", { path, subject: describeValue(name) });
      return;
    }
    if (seen.has(name)) {
      findings.error("entry-name-duplicate", { path, subject: name });
      return;
    }
    seen.add(name);

    const description = optionalStringOf(item, "description");
    entries.push({
      name,
      dir: resolveSource(item["source"], name, pluginRoot, path, findings),
      ...(description !== undefined && { description }),
    });
  });
  return entries;
}

/** Claude's `metadata.pluginRoot`, prepended to every relative source; the empty string when absent or unusable. */
function claudePluginRoot(object: JsonObject): string {
  const metadata = object["metadata"];
  if (!isJsonObject(metadata)) return "";
  const root = optionalStringOf(metadata, "pluginRoot");
  if (root === undefined) return "";
  const resolved = relativeDirectory(root);
  return resolved.ok ? resolved.dir : "";
}

/**
 * A source becomes a marketplace-relative directory or nothing. A string is
 * a relative directory (with or without `./`) unless it is a URL; Codex's
 * `{source: "local", path}` object is the same directory; every other
 * object form is a remote this reader does not fetch.
 */
function resolveSource(
  source: unknown,
  entryName: string,
  pluginRoot: string,
  path: string,
  findings: MarketplaceFindings,
): string | undefined {
  if (source === undefined) {
    findings.error("entry-source-missing", { path, subject: entryName });
    return undefined;
  }
  let candidate: string | undefined;
  if (typeof source === "string") {
    if (isUrl(source)) {
      findings.warn("entry-source-unsupported", { path, subject: entryName, detail: source });
      return undefined;
    }
    candidate = source;
  } else if (isJsonObject(source) && source["source"] === "local" && typeof source["path"] === "string") {
    candidate = source["path"];
  } else {
    findings.warn("entry-source-unsupported", { path, subject: entryName, detail: describeSource(source) });
    return undefined;
  }

  const resolved = relativeDirectory(candidate);
  if (!resolved.ok) {
    findings.error("entry-source-escapes-root", { path, subject: entryName, detail: candidate });
    return undefined;
  }
  return joinDirectories(pluginRoot, resolved.dir);
}

/** The `source` discriminator of a remote object, or the whole value, for the sentence. */
function describeSource(source: unknown): string {
  if (isJsonObject(source) && typeof source["source"] === "string") return source["source"];
  return describeValue(source);
}

function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

type RelativeDirectory = { readonly ok: true; readonly dir: string } | { readonly ok: false };

/**
 * `./thermos`, `thermos`, `third_party/github/`, `.` and `./` all name a
 * directory inside the root (the root itself is the empty string); an
 * absolute path, a backslash, or a `..` segment does not.
 */
function relativeDirectory(value: string): RelativeDirectory {
  let trimmed = value;
  if (trimmed === "." || trimmed === "./") return { ok: true, dir: "" };
  if (trimmed.startsWith("./")) trimmed = trimmed.slice(2);
  trimmed = trimmed.replace(/\/+$/, "");
  if (trimmed === "") return { ok: true, dir: "" };
  return isContainedPath(trimmed) ? { ok: true, dir: trimmed } : { ok: false };
}

function joinDirectories(root: string, dir: string): string {
  if (root === "") return dir;
  return dir === "" ? root : `${root}/${dir}`;
}

/** The entries the tree can install: a directory that exists and holds a plugin manifest at its root. */
function offeredEntries(
  raw: readonly RawEntry[],
  index: PluginFileIndex,
  path: string,
  findings: MarketplaceFindings,
): readonly MarketplaceEntry[] {
  const offered: MarketplaceEntry[] = [];
  for (const entry of raw) {
    if (entry.dir === undefined) continue;
    if (!index.isDirectory(entry.dir)) {
      findings.warn("entry-directory-missing", { path, subject: entry.name, detail: entry.dir === "" ? "." : entry.dir });
      continue;
    }
    if (!hasPluginManifest(childFilesOf(index, entry.dir))) {
      findings.warn("entry-not-a-plugin", { path, subject: entry.name, detail: entry.dir === "" ? "." : entry.dir });
      continue;
    }
    offered.push({
      name: entry.name,
      dir: entry.dir,
      ...(entry.description !== undefined && { description: entry.description }),
    });
  }
  return offered;
}

/** Every entry with a readable source, as the file declares it; the tree is not asked. */
function declaredEntries(raw: readonly RawEntry[]): readonly MarketplaceEntry[] {
  const declared: MarketplaceEntry[] = [];
  for (const entry of raw) {
    if (entry.dir === undefined) continue;
    declared.push({
      name: entry.name,
      dir: entry.dir,
      ...(entry.description !== undefined && { description: entry.description }),
    });
  }
  return declared;
}

/** The files under `dir` as plugin-relative paths, so `hasPluginManifest` reads them as it reads a plugin's own listing. */
function childFilesOf(index: PluginFileIndex, dir: string): readonly string[] {
  const prefix = dir === "" ? "" : `${dir}/`;
  return index.filesUnder(dir).map((file) => file.slice(prefix.length));
}
