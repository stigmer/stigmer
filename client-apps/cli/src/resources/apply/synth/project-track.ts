// Synthesis (project) track: the consumer adapter for `apply entry_point`.
//
// Its job mirrors the declarative adapter's — turn a source into resources +
// skill sources — but the source here is the SDK program rather than YAML
// files: infer the runtime, run synthesis (subprocess → `.pb`), decode the
// output, normalize it into the shared shapes, then hand off to the ONE shared
// reconciler (DD-009 §6). There is no parallel project-apply path.
//
// Resources are emitted in dependency-apply order (mcp_server → agent →
// workflow), matching the declarative track's APPLY_ORDER so parents land before
// dependents — a deliberate, more-correct ordering than the Go synth path
// (which applied agents first).

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { UsageError } from "../../../errors/index.js";
import { CommandResult } from "../../../output/index.js";
import {
  type DeclarativeDeps,
  type DetectResult,
  type ReconcileResource,
  reconcileProjectMembers,
  type SkillSource,
} from "../declarative.js";
import { APPLY_HANDLERS, type ApplyHandler } from "../handlers.js";
import type { SynthesisResult } from "./reader.js";
import { readSynthesisOutput } from "./reader.js";
import { inferRuntime } from "./runtime.js";
import type { SynthesizeDeps } from "./synthesize.js";
import { synthesize } from "./synthesize.js";

/** Deps for the project track: the reconciler deps plus injectable synthesis. */
export interface ProjectTrackDeps extends DeclarativeDeps {
  /** Injectable synthesis collaborators (real subprocess by default). */
  readonly synthesizeDeps?: SynthesizeDeps;
}

/**
 * Apply an SDK project: synthesize the entry point, read the `.pb` output, and
 * reconcile membership through the shared reconciler. Returns the summary
 * CommandResult for the caller to render.
 */
export async function applyProjectTrack(detect: DetectResult, deps: ProjectTrackDeps): Promise<CommandResult> {
  const { project, configDir } = detect;
  if (project === undefined || configDir === undefined) {
    throw new UsageError("project synthesis requires a stigmer.yaml project with an entry_point");
  }
  const entryPoint = project.spec?.entryPoint ?? "";
  if (entryPoint === "") throw new UsageError("project has no entry_point");

  const runtime = inferRuntime(entryPoint);
  deps.info(`SDK mode: ${entryPoint} (runtime: ${runtime})`);

  const { outputDir } = await synthesize(
    { projectDir: configDir, entryPoint, runtime, orgId: deps.org },
    deps.synthesizeDeps,
  );
  const synth = readSynthesisOutput(outputDir);
  deps.info(
    `Synthesis complete: ${synth.agents.length} agent(s), ${synth.workflows.length} workflow(s), ` +
      `${synth.mcpServers.length} MCP server(s), ${synth.skillSynths.length} skill(s)`,
  );

  const resources = toReconcileResources(synth);
  const skillSources = toSkillSources(synth, configDir);

  return reconcileProjectMembers(project, resources, skillSources, deps);
}

/**
 * Dry-run preview: validate the project configuration statically (no synthesis,
 * no backend), warning if the entry point file is missing. Port of Go's
 * executeSDKDryRun.
 */
export function previewProjectTrack(detect: DetectResult): CommandResult {
  const { project, configDir } = detect;
  if (project === undefined || configDir === undefined) {
    throw new UsageError("project synthesis requires a stigmer.yaml project with an entry_point");
  }
  const entryPoint = project.spec?.entryPoint ?? "";
  const runtime = inferRuntime(entryPoint);

  const result = CommandResult.success("Dry run: SDK project configuration is valid");
  const section = result.addSection("Project");
  if (project.metadata?.name) section.field("Name", project.metadata.name);
  section.field("Entry Point", entryPoint);
  section.field("Runtime", runtime);

  if (!existsSync(join(configDir, entryPoint))) {
    result.addSection("Warning").item(`Entry point file not found: ${entryPoint}`);
  }
  result.hint("Remove --dry-run to execute synthesis and apply resources");
  return result;
}

// Normalize decoded protos into ReconcileResources in dependency-apply order.
function toReconcileResources(synth: SynthesisResult): ReconcileResource[] {
  const resources: ReconcileResource[] = [];
  for (const message of synth.mcpServers) resources.push({ handler: handlerFor(ApiResourceKind.mcp_server), message });
  for (const message of synth.agents) resources.push({ handler: handlerFor(ApiResourceKind.agent), message });
  for (const message of synth.workflows) resources.push({ handler: handlerFor(ApiResourceKind.workflow), message });
  return resources;
}

// Normalize SkillSynths into SkillSources; local paths resolve relative to the
// project dir (matching Go's pushSkillSynth).
function toSkillSources(synth: SynthesisResult, configDir: string): SkillSource[] {
  return synth.skillSynths.map((skill) => {
    if (skill.source.case === "local") {
      const path = skill.source.value.path;
      return { kind: "local", dir: isAbsolute(path) ? path : join(configDir, path), tag: skill.tag };
    }
    if (skill.source.case === "git") {
      const git = skill.source.value;
      return { kind: "git", url: git.url, ref: git.ref, subdir: git.subdir, tag: skill.tag };
    }
    throw new UsageError("skill synthesis has no source configured (neither local nor git)");
  });
}

function handlerFor(kind: ApiResourceKind): ApplyHandler {
  const handler = APPLY_HANDLERS.get(kind);
  if (handler === undefined) throw new UsageError(`apply not implemented for ${ApiResourceKind[kind]}`);
  return handler;
}
