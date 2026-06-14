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
// Idempotent: a content-hash marker skips the apply when nothing changed.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  /** Directory holding the idempotency marker (data dir for local, config dir for cloud). */
  readonly markerDir: string;
  /** Target org slug. Defaults to STIGMER_SEEDPACK_ORG, then "stigmer". */
  readonly org?: string;
  /** Re-apply even when the content hash is unchanged. */
  readonly force?: boolean;
  /** Pre-resolved content (injectable for tests); resolved on demand otherwise. */
  readonly content?: SeedpackContent;
  readonly home?: string;
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
 * Apply the seedpack to the backend the deps connect to. Returns `applied:false`
 * (without touching the backend) when the marker already matches the content
 * hash and `force` is not set.
 */
export async function applySeedpack(deps: SeedpackApplyDeps, opts: SeedpackApplyOptions): Promise<SeedpackApplyResult> {
  const org = resolveSeedpackOrg(opts.org);
  const content = opts.content ?? resolveSeedpackContent({ home: opts.home });
  const hash = hashSeedpackContent(content.dir);

  if (opts.force !== true && readMarker(opts.markerDir) === hash) {
    return { applied: false, hash, org };
  }

  deps.info("Applying system resources (seedpack)…");
  const stage = mkdtempSync(join(tmpdir(), "stigmer-seedpack-"));
  try {
    extractSeedpack(content.dir, stage);
    await applyOrganizations(deps, stage);
    await applyProject(deps, stage, org);
    writeMarker(opts.markerDir, hash);
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
async function applyProject(deps: SeedpackApplyDeps, stageDir: string, org: string): Promise<void> {
  const detect = detectTrack(stageDir);
  if (detect.track !== "declarative") {
    throw new Error(`seedpack is not a declarative project (detected '${detect.track}')`);
  }
  await applyDeclarative(detect, {
    controller: deps.controller,
    stigmer: deps.stigmer,
    org,
    info: deps.info,
    warn: deps.warn,
  });
}
