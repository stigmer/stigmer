/**
 * What a turn loaded besides its agent: every skill and plugin, each at the
 * exact version that ran (`RunStatus.loaded_versions`).
 *
 * A skill or plugin an agent lists without a version follows its latest
 * push, so the run's agent version does not name it; this record does. The
 * turn context builds it once, when resolution is ready to run
 * (`turn-context.ts` `resolveTurnContext`), from what the turn mounted:
 * the root's and each subagent's skills, and the plugins the turn uses. A
 * turn that settles during resolution ran nothing and records nothing. The
 * server merges each write by union over (id, version)
 * (`stigmer-server` `update-status.ts`), so a resumed attempt that loads a
 * moved head adds an entry beside the one before.
 *
 * A record, never a pin: nothing reads it to choose what a later turn loads.
 */
import { create } from "@bufbuild/protobuf";
import { LoadedVersionsSchema, type LoadedVersions } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema, type ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { ResolvedBlueprint } from "../shared/blueprint-resolver.js";

/**
 * The record of what a turn loaded, in the turn's resolution order, root
 * first, each list kept once per (id, version), the first kept:
 *  - `skills`: the root's and the subagents' mounted skills, each already a
 *    reference at its version hash (`shared/skill-resolver.ts`);
 *  - the blueprint's plugins, each at its digest, then each saved
 *    subagent's when the harness runs subagents (`subAgents`), the only
 *    harness whose turn uses them. A plugin is listed whether or not its
 *    skills' archive mounted: its servers and hooks run at that digest.
 * Undefined when the turn loaded neither, so the status carries no empty
 * record.
 *
 * Throws on a skill or plugin with no id: a server read always carries one,
 * so a missing id is a defect upstream, and the server refuses an id-less
 * entry anyway (`loaded_versions.skill_id`, `loaded_versions.plugin_id`).
 */
export function loadedVersionsOf(
  skills: readonly ApiResourceReference[],
  blueprint: Pick<ResolvedBlueprint, "plugins" | "subagents">,
  subAgents: boolean,
): LoadedVersions | undefined {
  const plugins: readonly Plugin[] = [
    ...blueprint.plugins,
    ...(subAgents ? blueprint.subagents.flatMap((subagent) => subagent.plugins) : []),
  ];
  const pluginRefs = plugins.map((plugin) =>
    create(ApiResourceReferenceSchema, {
      org: plugin.metadata?.org ?? "",
      kind: ApiResourceKind.plugin,
      id: plugin.metadata?.id ?? "",
      version: plugin.status?.digest ?? "",
    }),
  );
  const loaded = create(LoadedVersionsSchema, {
    skills: onceEach(skills, "skill"),
    plugins: onceEach(pluginRefs, "plugin"),
  });
  return loaded.skills.length === 0 && loaded.plugins.length === 0 ? undefined : loaded;
}

/** `refs` in order, each (id, version) once, the first kept; throws on one with no id. */
function onceEach(refs: readonly ApiResourceReference[], noun: string): ApiResourceReference[] {
  const seen = new Set<string>();
  const kept: ApiResourceReference[] = [];
  for (const ref of refs) {
    if (ref.id === "") {
      throw new Error(`a loaded ${noun} has no id (version '${ref.version}'): the run cannot record it`);
    }
    const key = `${ref.id}@${ref.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(ref);
  }
  return kept;
}
