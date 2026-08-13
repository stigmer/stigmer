// `push skill`: package a skill directory into a ZIP artifact and upload it.
//
// The directory must contain a SKILL.md with YAML frontmatter naming the skill.
// Files are filtered through the gitignore-compatible ignore engine, zipped with
// fflate, and uploaded inline via the Skill push RPC. Git provenance is
// auto-detected (local) or recorded from the clone (remote --git-url).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { create } from "@bufbuild/protobuf";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { PushSkillRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { GitProvenanceSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import { UsageError } from "../errors/index.js";
import { getGitBranchName, getGitCommit, getGitRemoteUrl, getGitRepoRoot } from "./git.js";
import { createMatcher, REASON_TEXT, type Reason } from "./ignore/index.js";

export const SKILL_FILE = "SKILL.md";

// A skill version's identity is the server-side SHA-256 of the uploaded zip
// bytes, so packaging must be a pure function of content — otherwise
// re-pushing unchanged content registers a new version and the server's
// unchanged-content no-op never fires (stigmer/stigmer#671). fflate stamps
// zip-creation time into every entry when no mtime is given; pinning the DOS
// epoch (the earliest representable zip timestamp) removes the only
// byte-level variance. Local-field Date construction is deliberate: DOS
// timestamps store wall-clock fields, so this encodes identically in every
// timezone.
const DETERMINISTIC_ZIP_MTIME = new Date(1980, 0, 1);
// Kebab-case, optionally scoped with dot-separated namespaces (e.g.
// "platform.planton-architecture"). Every segment must be alphanumeric, so no
// leading/trailing/consecutive separators. The derived slug renders dots as hyphens.
const SKILL_NAME_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

export interface IgnoreOptions {
  readonly respectGitignore: boolean;
  readonly extraIgnore: readonly string[];
  readonly extraInclude: readonly string[];
}

export interface ZipStats {
  filesIncluded: number;
  filesIgnored: number;
  dirsSkipped: number;
  totalSize: number;
}

export interface PushResult {
  readonly id: string;
  readonly skillName: string;
  readonly slug: string;
  readonly versionHash: string;
  readonly tag: string;
  readonly message: string;
  readonly artifactSize: number;
  readonly isNewResource: boolean;
  readonly versionChanged: boolean;
  /**
   * The visibility the SKILL.md declared and that was applied after push, if
   * any. `undefined` means the skill left visibility unspecified and the
   * server-side value was left untouched (push never silently downgrades).
   */
  readonly visibility?: ApiResourceVisibility;
}

export interface DryRunAnalysis {
  readonly stats: ZipStats;
  readonly patternSources: readonly string[];
  readonly sampleIgnored: readonly string[];
  readonly sampleIncluded: readonly string[];
}

/** A callback for --verbose ignore-decision lines (INCLUDE/IGNORE/SKIP DIR). */
export type DecisionSink = (line: string) => void;

function safeReaddir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
}

export function hasSkillFile(dir: string): boolean {
  try {
    return statSync(join(dir, SKILL_FILE)).isFile();
  } catch {
    return false;
  }
}

interface SkillMetadata {
  readonly name: string;
  /**
   * Declared access level, parsed from the optional `visibility:` frontmatter
   * key. `undefined` when omitted — the skill keeps whatever the server already
   * has (default PRIVATE for new skills). This is the declarative replacement
   * for the Go CLI's `--public-skills` flag.
   */
  readonly visibility?: ApiResourceVisibility;
}

/** Parse SKILL.md YAML frontmatter and validate the skill name (kebab-case, optionally dot-scoped). */
export function parseSkillMetadata(dir: string): SkillMetadata {
  let content: string;
  try {
    content = readFileSync(join(dir, SKILL_FILE), "utf8");
  } catch (err) {
    throw new Error(`failed to read ${SKILL_FILE}: ${(err as Error).message}`);
  }
  return parseSkillMetadataContent(content);
}

/**
 * Parse SKILL.md content directly — the shared core behind the directory
 * path (`parseSkillMetadata`) and the pre-packaged archive path
 * (`pushSkillFromArchive`), where the content comes out of a zip entry
 * rather than the filesystem.
 */
export function parseSkillMetadataContent(content: string): SkillMetadata {
  const frontmatter = extractFrontmatter(content);
  const parsed = (parseYaml(frontmatter) ?? {}) as Record<string, unknown>;
  const name = typeof parsed.name === "string" ? parsed.name : "";

  if (name === "") {
    throw new UsageError(
      `${SKILL_FILE} is missing required 'name' field in YAML frontmatter\n\n` +
        "Expected format:\n---\nname: my-skill-name\n---\n\n" +
        "The name must be kebab-case (lowercase letters, numbers, and hyphens), " +
        "optionally scoped with dots (e.g. 'platform.my-skill')",
    );
  }
  if (!SKILL_NAME_RE.test(name)) {
    throw new UsageError(
      `invalid skill name '${name}' in ${SKILL_FILE}\n\n` +
        "Skill names must be kebab-case (a-z, 0-9, hyphens), optionally scoped with\n" +
        "dot-separated namespaces. Every segment must be alphanumeric (no leading,\n" +
        "trailing, or consecutive separators).\n" +
        "Examples: 'calculator', 'web-scraper', 'math-utils', 'platform.planton-architecture'",
    );
  }
  return { name, visibility: parseVisibility(parsed.visibility, SKILL_FILE) };
}

// Friendly frontmatter spellings → proto enum. Both the short form (`public`)
// and the canonical enum name (`visibility_public`) are accepted so authors can
// copy either from docs or from generated YAML. `unspecified`/empty is treated
// as "not declared" (returns undefined) so we never emit a no-op update.
const VISIBILITY_ALIASES: ReadonlyMap<string, ApiResourceVisibility> = new Map([
  ["private", ApiResourceVisibility.visibility_private],
  ["visibility_private", ApiResourceVisibility.visibility_private],
  ["public", ApiResourceVisibility.visibility_public],
  ["visibility_public", ApiResourceVisibility.visibility_public],
  ["org", ApiResourceVisibility.visibility_org],
  ["visibility_org", ApiResourceVisibility.visibility_org],
  ["platform", ApiResourceVisibility.visibility_platform],
  ["visibility_platform", ApiResourceVisibility.visibility_platform],
]);

/**
 * Map an optional `visibility` frontmatter value to the proto enum. Returns
 * undefined when omitted or explicitly unspecified; throws on an unknown value
 * (a typo should fail loudly rather than silently leave a skill private).
 */
export function parseVisibility(value: unknown, source = SKILL_FILE): ApiResourceVisibility | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new UsageError(`invalid 'visibility' in ${source}: expected a string, got ${typeof value}`);
  }
  const key = value.trim().toLowerCase();
  if (key === "" || key === "unspecified" || key === "api_resource_visibility_unspecified") return undefined;
  const mapped = VISIBILITY_ALIASES.get(key);
  if (mapped === undefined) {
    throw new UsageError(
      `invalid 'visibility' value '${value}' in ${source}\n\n` +
        "Valid values: private, public, org, platform.",
    );
  }
  return mapped;
}

function extractFrontmatter(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") {
    throw new UsageError(`${SKILL_FILE} must start with YAML frontmatter (---)`);
  }
  const collected: string[] = [];
  let closed = false;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closed = true;
      break;
    }
    collected.push(lines[i]);
  }
  if (!closed) throw new UsageError(`${SKILL_FILE} frontmatter is not closed (missing closing ---)`);
  if (collected.length === 0) throw new UsageError(`${SKILL_FILE} has empty frontmatter`);
  return collected.join("\n");
}

/** Walk `dir`, filter through the ignore matcher, and zip the survivors. */
export function createSkillZip(
  dir: string,
  options: IgnoreOptions,
  onDecision?: DecisionSink,
): { bytes: Uint8Array; stats: ZipStats } {
  const matcher = createMatcher({
    rootDir: dir,
    respectGitignore: options.respectGitignore,
    includeDefaults: true,
    extraIgnore: options.extraIgnore,
    extraInclude: options.extraInclude,
  });

  const stats: ZipStats = { filesIncluded: 0, filesIgnored: 0, dirsSkipped: 0, totalSize: 0 };
  const files: Record<string, Uint8Array> = {};

  const walk = (currentDir: string, prefix: string): void => {
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relPath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        const result = matcher.matchWithReason(relPath, true);
        if (result.ignored) {
          stats.dirsSkipped++;
          onDecision?.(`  SKIP DIR  ${relPath}/ (${REASON_TEXT[result.reason as Reason]})`);
          continue;
        }
        walk(full, relPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const result = matcher.matchWithReason(relPath, false);
      if (result.ignored) {
        stats.filesIgnored++;
        onDecision?.(`  IGNORE    ${relPath} (${REASON_TEXT[result.reason as Reason]})`);
        continue;
      }
      onDecision?.(`  INCLUDE   ${relPath}`);
      const data = readFileSync(full);
      files[relPath] = new Uint8Array(data);
      stats.filesIncluded++;
      stats.totalSize += data.length;
    }
  };
  walk(dir, "");

  const bytes = zipSync(files, { level: 6, mtime: DETERMINISTIC_ZIP_MTIME });
  return { bytes, stats };
}

/** Dry-run: report what would be included/ignored without zipping. */
export function analyzeDryRun(dir: string, options: IgnoreOptions): DryRunAnalysis {
  const matcher = createMatcher({
    rootDir: dir,
    respectGitignore: options.respectGitignore,
    includeDefaults: true,
    extraIgnore: options.extraIgnore,
    extraInclude: options.extraInclude,
  });

  const stats: ZipStats = { filesIncluded: 0, filesIgnored: 0, dirsSkipped: 0, totalSize: 0 };
  const sampleIgnored: string[] = [];
  const sampleIncluded: string[] = [];

  const walk = (currentDir: string, prefix: string): void => {
    const entries = safeReaddir(currentDir);
    if (entries === undefined) return; // Skip unreadable directories gracefully (dry-run is best-effort).
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relPath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        const result = matcher.matchWithReason(relPath, true);
        if (result.ignored) {
          stats.dirsSkipped++;
          if (sampleIgnored.length < 10) sampleIgnored.push(`${relPath}/ (${REASON_TEXT[result.reason as Reason]})`);
          continue;
        }
        walk(full, relPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const result = matcher.matchWithReason(relPath, false);
      if (result.ignored) {
        stats.filesIgnored++;
        if (sampleIgnored.length < 10) sampleIgnored.push(`${relPath} (${REASON_TEXT[result.reason as Reason]})`);
      } else {
        stats.filesIncluded++;
        try {
          stats.totalSize += statSync(full).size;
        } catch {
          // size unknown; ignore
        }
        if (sampleIncluded.length < 10) sampleIncluded.push(relPath);
      }
    }
  };
  walk(dir, "");

  const sourceCounts = new Map<string, number>();
  for (const p of matcher.patterns()) {
    const end = p.indexOf("]");
    if (p.startsWith("[") && end > 0) {
      const source = p.slice(1, end);
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
  }
  const patternSources = [...sourceCounts.entries()].map(([source, count]) => `${source} (${count} patterns)`);

  return { stats, patternSources, sampleIgnored, sampleIncluded };
}

/** Push a skill from a local directory. Git provenance is auto-detected. */
export async function pushSkill(
  client: Stigmer,
  dir: string,
  org: string,
  tag: string,
  message: string,
  options: IgnoreOptions,
  onDecision?: DecisionSink,
): Promise<PushResult> {
  if (!hasSkillFile(dir)) {
    throw new UsageError(
      `${SKILL_FILE} not found in ${dir}\n\nA skill directory must contain a ${SKILL_FILE} file defining the skill interface`,
    );
  }
  const { name, visibility } = parseSkillMetadata(dir);
  const { bytes, stats } = createSkillZip(dir, options, onDecision);

  const provenance = collectLocalGitProvenance(dir);
  const request = create(PushSkillRequestSchema, {
    org,
    artifact: bytes,
    tag: tag === "" ? "latest" : tag,
    message,
    gitProvenance: provenance,
  });
  const response = await client.skill.push(request);
  const applied = await applyDeclaredVisibility(client, response, visibility);
  return toResult(applied, name, message, stats.totalSize, visibility);
}

export interface RemotePushParams {
  readonly gitUrl: string;
  readonly gitRef: string;
  readonly subdir: string;
  readonly org: string;
  readonly tag: string;
  readonly message: string;
  readonly options: IgnoreOptions;
}

/** Push a skill from a directory cloned from a remote git repo (--git-url). */
export async function pushSkillFromClone(
  client: Stigmer,
  skillDir: string,
  params: RemotePushParams,
  onDecision?: DecisionSink,
): Promise<PushResult> {
  if (!hasSkillFile(skillDir)) {
    throw new UsageError(`${SKILL_FILE} not found in ${skillDir}\n\nThe skill directory must contain a ${SKILL_FILE} file`);
  }
  const { name, visibility } = parseSkillMetadata(skillDir);
  const { bytes, stats } = createSkillZip(skillDir, params.options, onDecision);

  const commit = getGitCommit(skillDir) ?? "";
  const provenance = create(GitProvenanceSchema, {
    remoteUrl: params.gitUrl,
    ref: params.gitRef,
    commit,
    subdir: params.subdir,
  });
  const request = create(PushSkillRequestSchema, {
    org: params.org,
    artifact: bytes,
    tag: params.tag === "" ? "latest" : params.tag,
    message: params.message,
    gitProvenance: provenance,
  });
  const response = await client.skill.push(request);
  const applied = await applyDeclaredVisibility(client, response, visibility);
  return toResult(applied, name, params.message, stats.totalSize, visibility);
}

/** A validated pre-packaged skill archive (`--archive`), ready to upload. */
export interface SkillArchive {
  /** The archive file's exact bytes — uploaded untouched. */
  readonly bytes: Uint8Array;
  /** Metadata parsed from the archive's root SKILL.md. */
  readonly meta: SkillMetadata;
  /** Number of file entries (directory markers excluded). */
  readonly fileCount: number;
  /** Total uncompressed size of all file entries, in bytes. */
  readonly totalSize: number;
}

/**
 * Read and validate a pre-packaged skill archive.
 *
 * Client-side validation is deliberately minimal — root SKILL.md present and
 * frontmatter parses (the same contract the console's upload preview checks);
 * the server remains the authoritative validator. The unzip filter inflates
 * ONLY SKILL.md: entry metadata is enough for the count/size summary, and
 * validation must not pay for decompressing a large artifact.
 */
export function readSkillArchive(archivePath: string): SkillArchive {
  let raw: Buffer;
  try {
    raw = readFileSync(archivePath);
  } catch (err) {
    throw new UsageError(`failed to read archive ${archivePath}: ${(err as Error).message}`);
  }
  const bytes = new Uint8Array(raw);

  let fileCount = 0;
  let totalSize = 0;
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (info) => {
        if (!info.name.endsWith("/")) {
          fileCount++;
          totalSize += info.originalSize;
        }
        return info.name === SKILL_FILE;
      },
    });
  } catch (err) {
    throw new UsageError(`${archivePath} is not a valid ZIP archive: ${(err as Error).message}`);
  }

  const skillMd = unzipped[SKILL_FILE];
  if (skillMd === undefined) {
    throw new UsageError(
      `${SKILL_FILE} not found at the root of ${archivePath}\n\n` +
        `A skill archive must contain ${SKILL_FILE} at its root (not inside a directory) defining the skill interface`,
    );
  }

  return { bytes, meta: parseSkillMetadataContent(strFromU8(skillMd)), fileCount, totalSize };
}

/**
 * Push a pre-packaged skill archive as-is (`--archive`).
 *
 * The bytes are uploaded untouched, so the engine's version hash is the
 * SHA-256 of the file on disk — release pipelines that publish checksums get
 * engine version identities that match them (stigmer/stigmer#671). Git
 * provenance is deliberately omitted: the archive was built elsewhere, so the
 * local checkout says nothing about the artifact's origin.
 */
export async function pushSkillFromArchive(
  client: Stigmer,
  archivePath: string,
  org: string,
  tag: string,
  message: string,
): Promise<PushResult> {
  const archive = readSkillArchive(archivePath);
  const request = create(PushSkillRequestSchema, {
    org,
    artifact: archive.bytes,
    tag: tag === "" ? "latest" : tag,
    message,
  });
  const response = await client.skill.push(request);
  const applied = await applyDeclaredVisibility(client, response, archive.meta.visibility);
  return toResult(applied, archive.meta.name, message, archive.totalSize, archive.meta.visibility);
}

/**
 * Apply the SKILL.md-declared visibility after a push. The push RPC carries
 * artifact + provenance but not access level (visibility is metadata, not part
 * of the versioned content), so we follow it with a single UpdateVisibility RPC
 * — the declarative equivalent of the Go CLI's post-push `--public-skills`
 * sweep. No-ops (undefined visibility, or the server already matching) are
 * skipped so an unchanged skill costs nothing extra.
 */
async function applyDeclaredVisibility(
  client: Stigmer,
  pushed: Skill,
  visibility: ApiResourceVisibility | undefined,
): Promise<Skill> {
  if (visibility === undefined) return pushed;
  const resourceId = pushed.metadata?.id ?? "";
  if (resourceId === "") return pushed;
  if (pushed.metadata?.visibility === visibility) return pushed;
  return client.skill.updateVisibility(create(UpdateVisibilityInputSchema, { resourceId, visibility }));
}

function collectLocalGitProvenance(dir: string) {
  const root = getGitRepoRoot(dir);
  if (root === undefined) return undefined;
  const remoteUrl = getGitRemoteUrl(dir);
  if (remoteUrl === undefined) return undefined; // No remote → no meaningful provenance.

  const provenance = create(GitProvenanceSchema, { remoteUrl });
  const commit = getGitCommit(dir);
  if (commit !== undefined) provenance.commit = commit;
  const branch = getGitBranchName(dir);
  if (branch !== undefined) provenance.ref = branch;

  // Subdir relative to repo root (git returns an absolute toplevel path).
  const rel = relative(root, resolve(dir));
  if (rel !== "" && rel !== ".") provenance.subdir = rel;
  return provenance;
}

function toResult(
  response: Skill,
  skillName: string,
  message: string,
  size: number,
  visibility: ApiResourceVisibility | undefined,
): PushResult {
  const version = response.metadata?.version;
  const isNew = version === undefined ? false : version.previousVersionId === "";
  const changed =
    version === undefined ? true : version.previousVersionId === "" ? true : version.id !== version.previousVersionId;
  return {
    id: response.metadata?.id ?? "",
    skillName,
    slug: response.metadata?.slug ?? "",
    versionHash: response.status?.versionHash ?? "",
    tag: response.spec?.tag ?? "",
    message,
    artifactSize: size,
    isNewResource: isNew,
    versionChanged: changed,
    visibility,
  };
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** Human-readable byte size (1024-based), matching Go's formatBytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let div = 1024;
  let exp = 0;
  for (let n = Math.floor(bytes / 1024); n >= 1024; n = Math.floor(n / 1024)) {
    div *= 1024;
    exp++;
  }
  return `${(bytes / div).toFixed(1)} ${BYTE_UNITS[exp + 1]}`;
}

/** Friendly truncated sha256 identifier. */
export function shortHash(hash: string): string {
  if (hash === "") return "sha256:(none)";
  return `sha256:${hash.length > 12 ? hash.slice(0, 12) : hash}`;
}
