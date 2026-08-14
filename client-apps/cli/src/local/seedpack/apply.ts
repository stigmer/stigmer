// In-process seedpack apply.
//
// The TS equivalent of Go's seedpackbootstrap.Apply, with one deliberate
// improvement: instead of shelling out to `stigmer apply` as a subprocess, this
// drives the same in-process declarative-apply path that `stigmer apply` uses —
// one code path, no recursion guard, no second process.
//
// Two phases respect the resource hierarchy (mirrors the Go bootstrap):
//   1. organizations/ via file mode — the org must exist before its members.
//   2. the project (stigmer.yaml + agents/skills/mcp-servers/workflows) via the
//      declarative reconciler, under the target org.
//
// Idempotent, with the applied-hash truth living with the backend it describes
// (cloud#429): every apply stamps the content hash as a reserved label on the
// seedpack Project, and cloud-mode runs skip by reading that label back — so
// any machine (operator laptop, CI) sees the same applied state. Local mode
// keeps the original marker file (the local data dir lives and dies with the
// local backend, so a local file IS backend-scoped state there).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { Stigmer } from "@stigmer/sdk";
import { applyItem, resolveApplyItems } from "../../resources/apply/apply.js";
import { applyDeclarative, detectTrack } from "../../resources/apply/declarative.js";
import type { ControllerFn } from "../../resources/apply/handlers.js";
import {
  extractSeedpack,
  hashSeedpackContent,
  readMarker,
  resolveSeedpackContent,
  type SeedpackContent,
  writeMarker,
} from "./content.js";

const DEFAULT_ORG = "stigmer";
const ORG_ENV_VAR = "STIGMER_SEEDPACK_ORG";

/**
 * Reserved label on the seedpack Project recording the last applied content
 * hash (cloud#429). Writing a NEW value requires `can_write_reserved_labels`
 * (the seeding identity's capability); re-sending an unchanged value is an
 * echo the cloud guard passes for any caller — so re-applies of identical
 * content are never treated as reserved-label writes.
 */
export const SEEDPACK_HASH_LABEL = "stigmer.ai/seedpack-hash";

/**
 * The seedpack Project's slug. The server derives it from the manifest's
 * `metadata.name` in `seedpack/stigmer.yaml` — "stigmer-seedpack" is already
 * slug-shaped, so name and slug coincide. Pinned by a test against the real
 * content so a rename there fails loudly here.
 */
export const SEEDPACK_PROJECT_SLUG = "stigmer-seedpack";

export interface SeedpackApplyDeps {
  /** Raw command-controller accessor (full-proto apply, preserves metadata.id). */
  readonly controller: ControllerFn;
  /** High-level client for skill push + post-apply MCP discovery. */
  readonly stigmer: Stigmer;
  /** Human progress lines (stderr). */
  readonly info: (line: string) => void;
  /** Warnings (stderr). */
  readonly warn: (line: string) => void;
}

export interface SeedpackApplyOptions {
  /** Directory holding the idempotency marker (local mode only). */
  readonly markerDir: string;
  /** Target org slug. Defaults to STIGMER_SEEDPACK_ORG, then "stigmer". */
  readonly org?: string;
  /** Re-apply even when the content hash is unchanged. */
  readonly force?: boolean;
  /** Pre-resolved content (injectable for tests); resolved on demand otherwise. */
  readonly content?: SeedpackContent;
  readonly home?: string;
  /**
   * Cloud mode: the idempotency truth is the {@link SEEDPACK_HASH_LABEL} on the
   * server's seedpack Project, read via {@link readServerSeedpackHash} — the
   * local marker is neither read nor written, so a stateless machine (CI, a
   * second operator laptop) still skips unchanged content correctly.
   */
  readonly useServerHash?: boolean;
}

export interface SeedpackApplyResult {
  /** True when the seedpack was applied; false when skipped as up to date. */
  readonly applied: boolean;
  /** The current content hash (stored in the marker on a successful apply). */
  readonly hash: string;
  /** The resolved target org. */
  readonly org: string;
}

/** Resolve the target org: explicit option > env var > "stigmer". */
export function resolveSeedpackOrg(explicit?: string): string {
  if (explicit !== undefined && explicit !== "") return explicit;
  const env = process.env[ORG_ENV_VAR];
  if (env !== undefined && env !== "") return env;
  return DEFAULT_ORG;
}

/** Compute the current seedpack content hash without applying (drives `status`). */
export function seedpackContentHash(opts: Pick<SeedpackApplyOptions, "content" | "home"> = {}): string {
  const content = opts.content ?? resolveSeedpackContent({ home: opts.home });
  return hashSeedpackContent(content.dir);
}

/**
 * Read the applied content hash recorded on the backend's seedpack Project,
 * or null when it cannot be proven (project absent — never applied — or the
 * read failed). Null means "apply": the apply itself is idempotent server-side,
 * so an unprovable state costs one redundant pass, never a skipped update.
 */
export async function readServerSeedpackHash(stigmer: Stigmer, org: string): Promise<string | null> {
  try {
    const project = await stigmer.project.getByReference({ org, slug: SEEDPACK_PROJECT_SLUG });
    return project.metadata?.labels?.[SEEDPACK_HASH_LABEL] ?? null;
  } catch {
    return null;
  }
}

/**
 * Apply the seedpack to the backend the deps connect to. Returns `applied:false`
 * (without touching the backend beyond the cloud-mode hash read) when the
 * recorded hash already matches the content hash and `force` is not set.
 */
export async function applySeedpack(deps: SeedpackApplyDeps, opts: SeedpackApplyOptions): Promise<SeedpackApplyResult> {
  const org = resolveSeedpackOrg(opts.org);
  const content = opts.content ?? resolveSeedpackContent({ home: opts.home });
  const hash = hashSeedpackContent(content.dir);

  const appliedHash = opts.useServerHash === true
    ? await readServerSeedpackHash(deps.stigmer, org)
    : readMarker(opts.markerDir);
  if (opts.force !== true && appliedHash === hash) {
    return { applied: false, hash, org };
  }

  deps.info("Applying system resources (seedpack)…");
  const stage = mkdtempSync(join(tmpdir(), "stigmer-seedpack-"));
  try {
    extractSeedpack(content.dir, stage);
    await applyOrganizations(deps, stage);
    await applyProject(deps, stage, org, hash);
    // The Project label written above is the cloud-mode record; the marker
    // stays the local-mode one. Never both — two records of one fact drift.
    if (opts.useServerHash !== true) {
      writeMarker(opts.markerDir, hash);
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }

  deps.info("System resources applied successfully");
  return { applied: true, hash, org };
}

// Phase 1: organizations via file mode. Organizations sit above the project and
// carry no org context themselves, so they apply with an empty org.
async function applyOrganizations(deps: SeedpackApplyDeps, stageDir: string): Promise<void> {
  const orgDir = join(stageDir, "organizations");
  let items: ReturnType<typeof resolveApplyItems>;
  try {
    items = resolveApplyItems(orgDir);
  } catch {
    return; // No organizations to apply.
  }
  for (const item of items) {
    const outcome = await applyItem(deps.controller, item, "", false);
    if (outcome.warning !== undefined) deps.warn(outcome.warning);
  }
}

// Phase 2: the project (agents, skills, MCP servers, workflows) via the shared
// declarative reconciler — the same path `stigmer apply` runs for a user project.
//
// The content hash is stamped as a reserved label on the Project HERE, in the
// seedpack path only — general `stigmer apply` never writes reserved labels.
// The stamp rides the project apply that happens anyway, so recording the hash
// costs no extra RPC and can never succeed while the apply failed.
async function applyProject(deps: SeedpackApplyDeps, stageDir: string, org: string, contentHash: string): Promise<void> {
  const detect = detectTrack(stageDir);
  if (detect.track !== "declarative" || detect.project === undefined) {
    throw new Error(`seedpack is not a declarative project (detected '${detect.track}')`);
  }
  detect.project.metadata ??= create(ApiResourceMetadataSchema, {});
  detect.project.metadata.labels[SEEDPACK_HASH_LABEL] = contentHash;
  await applyDeclarative(detect, {
    controller: deps.controller,
    stigmer: deps.stigmer,
    org,
    info: deps.info,
    warn: deps.warn,
  });
}
