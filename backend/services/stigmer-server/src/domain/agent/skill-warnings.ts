/**
 * RecordAgentWarnings: what an agent's save notices and does not refuse,
 * kept on the agent's status (AgentStatus.warnings) for the author to read
 * where the save answers them (the CLI's apply, `get agent`, the console).
 *
 * One warning today: a skill carrying scripts on an agent without a
 * computer. Such an agent's turns read a skill's files from the store and
 * run no command (domain/run/computer.ts), so a skill whose archive holds
 * an executable file still loads, and its text still reads, but its
 * scripts never run. That is not refused, because many skills ship a
 * helper script beside instructions that stand without it; it is said once
 * per skill, at the save, where every refusal of a computerless agent is
 * said.
 *
 * What is read. The agent's own skill references, each at the version it
 * names (the head when it names none: a turn resolves a skill reference at
 * its start), and each skill of each plugin the agent uses, at the version
 * a turn reads it (run-plugins.ts). A skill's files come from its
 * archive's file index, written at push and built on first read for an
 * older version (archive/file-reads.ts), through the same served-version rules its
 * listFiles answers (archive/serve-files.ts), so the eval suite never
 * counts. A plugin's skill is the files under its folder in the plugin's
 * archive, or the whole archive for a plugin that is one skill.
 *
 * A warning is never a failure: a skill that is gone, an archive that
 * cannot be indexed or a store fault reading one costs that skill's
 * warning alone, logged, and the save goes on.
 *
 * Status, never spec: the version hash is the spec's (agent-version.ts), so
 * a warning that appears or clears moves no version. An agent with a
 * computer carries none; its warnings are cleared on the save that gives
 * it one.
 *
 * Pipeline position: after RefuseWhatNeedsAComputer, whose refusals come
 * first, and before Persist.
 *
 * Proven by __tests__/skill-warnings.test.ts and the agent conformance
 * suite.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentStatusSchema, AgentWarningSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import type { AgentWarning } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { ArchiveFileEntry } from "../../archive/file-index.js";
import type { ArchiveFileReads } from "../../archive/file-reads.js";
import { listServedFiles, resolveServedVersion } from "../../archive/serve-files.js";
import type { Logger } from "../../boot/logger.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { Store } from "../../store/interface.js";
import { servedPlugin } from "../plugin/served-files.js";
import { loadRunPlugins, runPluginReferences } from "../run/run-plugins.js";
import { servedSkill } from "../skill/served-files.js";
import { loadSkillByReference } from "../skill/version-resolution.js";
import type { RunPlugin } from "../vault/resolve.js";

type AgentDesc = typeof AgentSchema;

/** The kind of the warning a skill with scripts raises on an agent without a computer. */
export const SKILL_SCRIPTS_WARNING_KIND = "skill-scripts";

/** The warning's sentence for the skill a turn names `skill`. */
export function skillScriptsWarningMessage(skill: string): string {
  return `skill '${skill}' has scripts this agent can't run without a computer; it can still read them`;
}

/** The archive file reads the step reads skills' and plugins' indexes through. */
export interface AgentWarningReads {
  readonly skill: ArchiveFileReads;
  readonly plugin: ArchiveFileReads;
}

export function newRecordAgentWarningsStep(
  store: Store,
  reads: AgentWarningReads,
  logger: Logger,
): PipelineStep<AgentDesc> {
  return {
    name: "RecordAgentWarnings",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const agent = ctx.newState;
      const spec = agent.spec;
      if (spec === undefined) {
        return;
      }
      const warnings = spec.computer === Computer.NONE ? await skillScriptWarnings(store, reads, logger, agent.metadata?.org ?? "", spec) : [];
      agent.status ??= create(AgentStatusSchema);
      agent.status.warnings = warnings;
    },
  };
}

async function skillScriptWarnings(
  store: Store,
  reads: AgentWarningReads,
  logger: Logger,
  org: string,
  spec: NonNullable<RequestContext<AgentDesc>["newState"]["spec"]>,
): Promise<AgentWarning[]> {
  const warnings: AgentWarning[] = [];
  const warn = (skill: string): void => {
    warnings.push(create(AgentWarningSchema, { kind: SKILL_SCRIPTS_WARNING_KIND, message: skillScriptsWarningMessage(skill), skill }));
  };
  for (const ref of spec.skillRefs) {
    const named = ref.slug || ref.id;
    try {
      const skill = await loadSkillByReference(store, ref, org);
      const version = await resolveServedVersion(store, servedSkill, skill, skill.metadata?.id ?? "", "");
      const files = await listServedFiles(reads.skill, "skill", version);
      if (files.some((file) => file.executable)) {
        warn(skill.metadata?.slug || named);
      }
    } catch (error) {
      if (!isNotFound(error)) {
        logger.warn("Agent save could not read a skill's files for its warnings", { skill: named, error: String(error) });
      }
    }
  }
  let plugins: RunPlugin[];
  try {
    plugins = await loadRunPlugins(store, runPluginReferences(spec, undefined, org), org);
  } catch (error) {
    logger.warn("Agent save could not read its plugins for its warnings", { error: String(error) });
    return warnings;
  }
  for (const plugin of plugins) {
    if (plugin.status.skills.length === 0) {
      continue;
    }
    let files: readonly ArchiveFileEntry[];
    try {
      const resource = create(PluginSchema, { metadata: { id: plugin.id, name: plugin.name }, status: plugin.status });
      files = await listServedFiles(reads.plugin, "plugin", await resolveServedVersion(store, servedPlugin, resource, plugin.id, ""));
    } catch (error) {
      logger.warn("Agent save could not read a plugin's files for its warnings", { plugin: plugin.name, error: String(error) });
      continue;
    }
    for (const skill of plugin.status.skills) {
      const folder = skill.path === "" ? "" : `${skill.path.replace(/\/+$/, "")}/`;
      if (files.some((file) => file.executable && file.path.startsWith(folder))) {
        warn(`${plugin.name}:${skill.name}`);
      }
    }
  }
  return warnings;
}

function isNotFound(error: unknown): boolean {
  return error instanceof ConnectError && error.code === Code.NotFound;
}
