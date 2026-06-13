// Declarative apply (`stigmer apply` inside a stigmer.yaml project directory).
//
// The project is a lightweight membership tracker: it stores only references
// (org/kind/slug) to its members and the server reconciles by set-difference
// against the previous member list. The CLI's job is to discover the resources
// that live beside stigmer.yaml, apply each one, collect references to the
// member-eligible ones, then apply the project with that member set. Pruning of
// orphans is therefore entirely server-side — see the note on `--prune` in
// commands/apply.ts (S1).
//
// Two project layouts are supported, mirroring the Go CLI:
//   flat:      project/agent.yaml, project/my-skill/SKILL.md
//   organized: project/agents/*.yaml, project/skills/my-skill/SKILL.md
// Scanning is top-level plus one level of subdirectories — deep trees are not
// walked, matching Go (this keeps membership predictable and fast).

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { create, fromJson } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  type ApiResourceReference,
  ApiResourceReferenceSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  type ApiResourceMetadata,
  ApiResourceMetadataSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { type Project, ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";
import { ProjectCommandController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/command_pb";
import { ProjectSpecSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/spec_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/index.js";
import { CommandResult } from "../../output/index.js";
import { loadDocuments } from "../documents.js";
import { hasSkillFile, pushSkill } from "../skill.js";
import { type ApplyItem, applyItem, resolveHandlerForKind, sortApplyItems } from "./apply.js";
import { discoverAppliedMcpServers } from "./discovery.js";
import type { ControllerFn } from "./handlers.js";

const CONFIG_FILE_NAME = "stigmer.yaml";
const DEFAULT_MAX_DEPTH = 10;

/** The detected CLI operation mode (mirrors Go's project.Track). */
export type Track = "atomic" | "declarative" | "project";

export interface DetectResult {
  readonly track: Track;
  /** Absolute path to stigmer.yaml; undefined for the atomic track. */
  readonly configPath?: string;
  /** Directory containing stigmer.yaml; undefined for the atomic track. */
  readonly configDir?: string;
  /** Parsed Project; undefined for the atomic track. */
  readonly project?: Project;
}

/**
 * Walk up from `startDir` (max 10 levels, matching Go) looking for stigmer.yaml.
 * Absent → atomic track. Present-but-invalid → a hard error (the user clearly
 * intended a project; help them fix it rather than silently falling back).
 * Present with an entry_point → the SDK "project" track (synthesis), which this
 * wave does not implement.
 */
export function detectTrack(startDir: string, maxDepth = DEFAULT_MAX_DEPTH): DetectResult {
  let dir = resolve(startDir);
  for (let depth = 0; depth < maxDepth; depth++) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      const project = loadProject(candidate);
      const track: Track = project.spec?.entryPoint ? "project" : "declarative";
      return { track, configPath: candidate, configDir: dirname(candidate), project };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { track: "atomic" };
}

// Strict parse of stigmer.yaml into a Project (proto carries apiVersion/kind as
// real fields, so the discriminator is accepted, not rejected). Unknown fields
// are an error — a typo in stigmer.yaml should fail loudly.
function loadProject(configPath: string): Project {
  const docs = loadDocuments(configPath, { strict: true });
  if (docs.length === 0) throw new UsageError(`${configPath} contains no document`);
  const doc = docs[0];
  if (doc.kind !== "Project") {
    throw new UsageError(`${configPath} must declare 'kind: Project' (found '${doc.kind}')`);
  }
  try {
    return fromJson(ProjectSchema, doc.document, { ignoreUnknownFields: false });
  } catch (err) {
    throw new UsageError(
      `invalid project configuration in ${configPath}: ${(err as Error).message}\n\n` +
        "Fix the issues above or remove the file to use file mode (stigmer apply -f).",
    );
  }
}

// =============================================================================
// Directory scanning
// =============================================================================

/**
 * YAML resource files beside stigmer.yaml: top-level files plus files in
 * immediate subdirectories. stigmer.yaml itself is excluded, as are skill
 * directories (handled separately) and grouping dirs that hold skills.
 */
export function scanResourceFiles(projectDir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
    const full = join(projectDir, entry.name);
    if (entry.isDirectory()) {
      if (isSkillDirectory(full) || containsSkillDirectories(full)) continue;
      for (const sub of readdirSync(full, { withFileTypes: true })) {
        if (!sub.isDirectory() && isYaml(sub.name)) files.push(join(full, sub.name));
      }
      continue;
    }
    if (isYaml(entry.name) && entry.name.toLowerCase() !== CONFIG_FILE_NAME) {
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * Skill directories beside stigmer.yaml: immediate children that contain a
 * SKILL.md (flat layout), plus grandchildren under a grouping dir like skills/
 * (organized layout). Scanning stops one level deep, matching Go.
 */
export function scanSkillDirectories(projectDir: string): string[] {
  const skillDirs: string[] = [];
  for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(projectDir, entry.name);
    if (isSkillDirectory(full)) {
      skillDirs.push(full);
      continue;
    }
    for (const sub of readdirSync(full, { withFileTypes: true })) {
      const nested = join(full, sub.name);
      if (sub.isDirectory() && isSkillDirectory(nested)) skillDirs.push(nested);
    }
  }
  return skillDirs.sort();
}

function containsSkillDirectories(dir: string): boolean {
  try {
    return readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory() && isSkillDirectory(join(dir, e.name)));
  } catch {
    return false;
  }
}

function isSkillDirectory(dir: string): boolean {
  return hasSkillFile(dir);
}

function isYaml(name: string): boolean {
  const ext = extname(name).toLowerCase();
  return ext === ".yaml" || ext === ".yml";
}

// =============================================================================
// Item building
// =============================================================================

/**
 * Build ordered apply items from scanned resource files. Project documents are
 * skipped (stigmer.yaml is already loaded) and Organization documents are
 * skipped with a warning — an organization sits above a project in the resource
 * hierarchy and must be applied independently with file mode.
 */
export function buildDeclarativeItems(files: readonly string[], warn: (line: string) => void): ApplyItem[] {
  const items: ApplyItem[] = [];
  for (const file of files) {
    for (const doc of loadDocuments(file, { strict: true })) {
      if (doc.kind === "Project") continue;
      if (doc.kind === "Organization") {
        warn(`Skipping ${file}: Organization is not a project resource. Use 'stigmer apply -f' to manage organizations.`);
        continue;
      }
      items.push({ filePath: file, handler: resolveHandlerForKind(doc.kind, file), document: doc.document });
    }
  }
  return sortApplyItems(items);
}

// Member-eligible kinds participate in project membership and reconciliation.
// Mirrors Go's types.IsProjectMemberKind.
const MEMBER_KINDS: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.agent,
  ApiResourceKind.workflow,
  ApiResourceKind.mcp_server,
  ApiResourceKind.skill,
]);

// =============================================================================
// Orchestration
// =============================================================================

export interface DeclarativeDeps {
  /** Raw command-controller accessor (full-proto apply, preserves metadata.id). */
  readonly controller: ControllerFn;
  /** High-level client for skill push + post-apply MCP discovery. */
  readonly stigmer: Stigmer;
  /** Resolved organization (already validated non-empty by the caller). */
  readonly org: string;
  /** Human progress lines (stderr; not a parity surface). */
  readonly info: (line: string) => void;
  /** Warnings (stderr). */
  readonly warn: (line: string) => void;
}

/**
 * Apply a declarative project: push skills, apply resources, set membership,
 * apply the project. Returns the summary CommandResult for the caller to render.
 */
export async function applyDeclarative(detect: DetectResult, deps: DeclarativeDeps): Promise<CommandResult> {
  const { project, configDir } = detect;
  if (project === undefined || configDir === undefined) {
    throw new UsageError("declarative apply requires a stigmer.yaml project");
  }

  const resourceFiles = scanResourceFiles(configDir);
  const skillDirs = scanSkillDirectories(configDir);
  if (resourceFiles.length === 0 && skillDirs.length === 0) {
    return buildNoResourcesResult(configDir);
  }

  const items = buildDeclarativeItems(resourceFiles, deps.warn);
  deps.info(`Found ${items.length} resource(s) in ${resourceFiles.length} file(s), ${skillDirs.length} skill(s)`);

  const members: ApiResourceReference[] = [];

  // Skills first — agents may reference them.
  for (const dir of skillDirs) {
    deps.info(`Pushing skill from ${basename(dir)}...`);
    const pushed = await pushSkill(deps.stigmer, dir, deps.org, "latest", "", {
      respectGitignore: true,
      extraIgnore: [],
      extraInclude: [],
    });
    members.push(reference(deps.org, ApiResourceKind.skill, pushed.slug));
  }

  // Then each YAML resource, collecting member references.
  const appliedMcpServers: McpServer[] = [];
  for (const item of items) {
    const outcome = await applyItem(deps.controller, item, deps.org, false);
    if (outcome.warning !== undefined) deps.warn(outcome.warning);
    if (outcome.appliedMcpServer !== undefined) appliedMcpServers.push(outcome.appliedMcpServer);
    if (MEMBER_KINDS.has(item.handler.kind)) {
      const slug = metaOf(item)?.slug;
      if (slug) members.push(reference(deps.org, item.handler.kind, slug));
    }
  }

  await discoverAppliedMcpServers(deps.stigmer, appliedMcpServers, deps.info);

  // Apply the project with the collected membership. The server reconciles by
  // set-difference (orphan pruning is server-side; see S1 in commands/apply.ts).
  injectOrg(project, deps.org);
  if (project.spec === undefined) project.spec = create(ProjectSpecSchema, {});
  project.spec.members = members;
  const created = (project.metadata?.id ?? "") === "";
  const applied = await deps.controller(ProjectCommandController).apply(project);

  return buildDeclarativeResult(applied, members, created);
}

/** Dry-run: validate every resource without touching the backend. */
export function previewDeclarative(detect: DetectResult, deps: Pick<DeclarativeDeps, "controller" | "warn">): {
  results: CommandResult[];
  summary: CommandResult;
} {
  const { configDir } = detect;
  if (configDir === undefined) throw new UsageError("declarative apply requires a stigmer.yaml project");
  const items = buildDeclarativeItems(scanResourceFiles(configDir), deps.warn);
  const results = items.map((item) => buildDryRunPreview(item));
  const summary = CommandResult.success(`Dry run complete: ${items.length} resource(s) validated`);
  summary.hint("Remove --dry-run to apply resources to the backend");
  return { results, summary };
}

function buildDryRunPreview(item: ApplyItem): CommandResult {
  const meta = metaOf(item);
  const result = CommandResult.success(`Dry run: ${meta?.name ?? item.handler.displayName} is valid`);
  const section = result.addSection(`${item.handler.displayName} Preview`);
  if (meta?.name) section.field("Name", meta.name);
  if (meta?.slug) section.field("Slug", meta.slug);
  return result;
}

// The document is YAML-shaped JSON; read metadata fields for membership/preview
// without marshalling (the apply itself marshals strictly).
function metaOf(item: ApplyItem): { name?: string; slug?: string } | undefined {
  const meta = (item.document as { metadata?: { name?: unknown; slug?: unknown } }).metadata;
  if (meta === undefined) return undefined;
  return {
    name: typeof meta.name === "string" ? meta.name : undefined,
    slug: typeof meta.slug === "string" ? meta.slug : undefined,
  };
}

function reference(org: string, kind: ApiResourceKind, slug: string): ApiResourceReference {
  return create(ApiResourceReferenceSchema, { org, kind, slug });
}

function injectOrg(project: Project, org: string): void {
  if (org === "") return;
  const holder = project as unknown as { metadata?: ApiResourceMetadata };
  if (holder.metadata === undefined) {
    holder.metadata = create(ApiResourceMetadataSchema, { org });
  } else if (holder.metadata.org === "") {
    holder.metadata.org = org;
  }
}

// =============================================================================
// Result builders
// =============================================================================

function buildNoResourcesResult(projectDir: string): CommandResult {
  const result = CommandResult.warning("No resource files found in project directory");
  result
    .addSection("")
    .field("Directory", projectDir)
    .item(
      "Add YAML resource files (Agent, Workflow, McpServer) or skill directories (with SKILL.md) next to stigmer.yaml",
    );
  result.hint("Example: create agent.yaml with kind: Agent, then run 'stigmer apply'");
  return result;
}

function buildDeclarativeResult(
  project: Project,
  members: readonly ApiResourceReference[],
  created: boolean,
): CommandResult {
  const name = project.metadata?.name ?? "project";
  const result = CommandResult.success(`Project ${name} successfully (${created ? "created" : "updated"})`);

  const section = result.addSection("Project");
  if (project.metadata?.name) section.field("Name", project.metadata.name);
  if (project.metadata?.slug) section.field("Slug", project.metadata.slug);
  if (project.metadata?.id) section.field("ID", project.metadata.id);

  const counts = countByKind(members);
  if (counts.size > 0) {
    const memberSection = result.addSection("Members Applied");
    for (const kind of [
      ApiResourceKind.agent,
      ApiResourceKind.workflow,
      ApiResourceKind.mcp_server,
      ApiResourceKind.skill,
    ]) {
      const count = counts.get(kind);
      if (count !== undefined) memberSection.field(ApiResourceKind[kind], String(count));
    }
  }

  const recon = project.status?.lastReconciliation;
  if (recon !== undefined && (recon.created.length > 0 || recon.updated.length > 0 || recon.deleted.length > 0)) {
    const reconSection = result.addSection("Reconciliation");
    if (recon.created.length > 0) reconSection.field("Created", String(recon.created.length));
    if (recon.updated.length > 0) reconSection.field("Updated", String(recon.updated.length));
    if (recon.deleted.length > 0) reconSection.field("Pruned", String(recon.deleted.length));
  }

  if (project.metadata?.slug) result.hint(`View project: stigmer get project ${project.metadata.slug}`);
  return result;
}

function countByKind(members: readonly ApiResourceReference[]): Map<ApiResourceKind, number> {
  const counts = new Map<ApiResourceKind, number>();
  for (const member of members) counts.set(member.kind, (counts.get(member.kind) ?? 0) + 1);
  return counts;
}
