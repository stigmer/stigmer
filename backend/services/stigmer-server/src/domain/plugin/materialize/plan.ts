/**
 * The materialisation plan: everything a push will write, computed before
 * anything is written. One pure function turns the library's description
 * of the package, the parsed overlay and the plugin's identity into the
 * four planned member sets plus the warnings the plan itself raised, so
 * the push step can check every slug against the organization, pre-
 * authorise the caller for every child kind, and decide whether the
 * members already converge — all before the first in-process call.
 *
 * Warnings collected here join the library's in `PluginStatus.warnings`:
 * every ignored component (recorded once per component, as the library
 * records it), each unapplied model hint, each built-in name shadowed, and
 * a manifest version the tag pattern rejects.
 */
import { create } from "@bufbuild/protobuf";

import type { PluginFiles, PluginPackage } from "@stigmer/plugin-package";
import { PluginWarningSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { PluginWarning } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  RESERVED_LABEL_TRUE,
  SYSTEM_LABEL,
  isSystemContent,
} from "../../../pipeline/apiresource-labels.js";
import { SERVER_WARNING_KINDS, VERSION_TAG_PATTERN } from "../constants.js";
import type { PlannedMember } from "../members.js";
import type { ParsedOverlays } from "../overlay/documents.js";
import { planAgent } from "./agent.js";
import type { PlannedAgent } from "./agent.js";
import type { PluginIdentity } from "./identity.js";
import { planMcpServers } from "./mcp-servers.js";
import type { PlannedMcpServer } from "./mcp-servers.js";
import { planSkills } from "./skills.js";
import type { PlannedSkill } from "./skills.js";
import { planWorkflows } from "./workflows.js";
import type { PlannedWorkflow } from "./workflows.js";

export interface MaterializationPlan {
  readonly skills: readonly PlannedSkill[];
  readonly mcpServers: readonly PlannedMcpServer[];
  readonly agent: PlannedAgent | undefined;
  readonly workflows: readonly PlannedWorkflow[];
  /** Every member the push intends, in materialisation order. */
  readonly members: readonly PlannedMember[];
  /** The audit tag this push assigns; empty when the version does not fit. */
  readonly tag: string;
  readonly warnings: readonly PluginWarning[];
}

/** The manifest version as a tag, or empty with a warning when it cannot be one. */
export function versionTag(
  version: string | undefined,
  warnings: PluginWarning[],
): string {
  if (version === undefined || version === "") {
    return "";
  }
  if (VERSION_TAG_PATTERN.test(version)) {
    return version;
  }
  warnings.push(
    create(PluginWarningSchema, {
      kind: SERVER_WARNING_KINDS.versionNotTaggable,
      message:
        `version '${version}' cannot be a tag (letters, digits, '.', '_' and '-' only); ` +
        "this version is reachable by its digest but not by name",
    }),
  );
  return "";
}

export function planMaterialization(
  plugin: PluginPackage,
  files: PluginFiles,
  overlays: ParsedOverlays,
  identity: PluginIdentity,
  message: string,
): MaterializationPlan {
  const warnings: PluginWarning[] = [];
  for (const ignored of plugin.ignored) {
    warnings.push(
      create(PluginWarningSchema, {
        kind: SERVER_WARNING_KINDS.componentIgnored,
        path: ignored.path,
        message: `${ignored.kind} at '${ignored.path}' is not installed; Stigmer reads skills, MCP servers, sub-agents and the ai.stigmer/ overlay`,
      }),
    );
  }
  const tag = versionTag(plugin.version, warnings);

  const skills = planSkills(plugin, files, identity, tag, message);
  const mcpServers = planMcpServers(
    plugin,
    new Map(
      overlays.mcpServers.map((document) => [
        document.server,
        document.resource,
      ]),
    ),
    identity,
  );
  const agent = planAgent(
    plugin,
    overlays.agent?.resource,
    mcpServers,
    identity,
    warnings,
  );
  const workflows = planWorkflows(overlays.workflows, identity);

  // `system` is read from the labels each member will be written with (the
  // overlay author's, the plugin's two merged over them). A skill's request
  // carries only the plugin's two, so a skill never declares system content
  // and can never adopt a row; the overlay kinds can.
  const members: PlannedMember[] = [
    ...skills.map((skill) => ({
      kind: ApiResourceKind.skill,
      slug: skill.slug,
      name: skill.name,
      system: skill.request.labels[SYSTEM_LABEL] === RESERVED_LABEL_TRUE,
    })),
    ...mcpServers.map((server) => ({
      kind: ApiResourceKind.mcp_server,
      slug: server.slug,
      name: server.name,
      system: isSystemContent(server.resource.metadata),
    })),
    ...(agent === undefined
      ? []
      : [
          {
            kind: ApiResourceKind.agent,
            slug: agent.slug,
            name: agent.name,
            system: isSystemContent(agent.resource.metadata),
          },
        ]),
    ...workflows.map((workflow) => ({
      kind: ApiResourceKind.workflow,
      slug: workflow.slug,
      name: workflow.name,
      system: isSystemContent(workflow.resource.metadata),
    })),
  ];

  return { skills, mcpServers, agent, workflows, members, tag, warnings };
}
