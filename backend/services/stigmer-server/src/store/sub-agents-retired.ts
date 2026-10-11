/**
 * The data migration both store drivers run when a subagent becomes a
 * saved agent the parent lists (AgentSpec.subagents) and the sub-agent
 * written inside an agent (the retired AgentSpec field 6) leaves the
 * contract. The drivers own the SQL (the pages, the writes, the
 * transaction); this module owns what one agent or session row becomes.
 *
 * What an agent becomes. Each sub-agent written inside it is dropped. A
 * store migration creates no rows (a saved agent needs its authorization
 * tuples, its search entry and its versions, which belong to the
 * controller), so the step writes each one to the log, at warn, as a
 * ready-to-apply Agent manifest that runs as the sub-agent ran:
 *   - its name, made a slug, its description and its instructions;
 *   - its skills;
 *   - the parent's plugins and `env` declarations, because it used the
 *     parent's tools and shell;
 *   - its tool lists over the parent's: its own `tools` when it had any,
 *     else the parent's, and the union of both `disallowed_tools`;
 *   - its model override as `run_config.model_name` on the native engine,
 *     the registry it was checked against.
 * The same line carries the `subagents` entry to add to the parent once
 * the manifest is applied. The parent's own hooks need no copy: a
 * conversation's hooks run on its subagents' calls.
 *
 * A changed agent is stored as a new current version, as every data
 * migration that rewrites an agent stores it: its spec's hash is
 * recomputed, the head moves to it (its previous version kept as
 * history), and the driver archives the new version. A session on a
 * changed agent is re-pinned to the new version, so its next turn reads a
 * spec its runner can decode whole.
 *
 * What is not rewritten. Archived agent versions keep what they held; a
 * run keeps the spec it ran.
 *
 * Frozen: the slug rule below is this step's own copy of the rule it
 * arrived with, so a later change to how slugs are made never changes
 * what an old store's upgrade logs. An undecodable row fails the step,
 * the rule the other data migrations keep.
 */
import { create, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import yaml from "js-yaml";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataVersionSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { canonicalSpecHash } from "../pipeline/steps/spec-hash.js";
import { readSubAgents, writeSubAgents } from "./frozen-sub-agent.js";
import type { FrozenSubAgent } from "./frozen-sub-agent.js";
import type { StoreLogger } from "./logger.js";

/** The `kind` column values the step reads and rewrites. */
export const SUB_AGENT_RETIREMENT_AGENT_KIND = "agent";
export const SUB_AGENT_RETIREMENT_SESSION_KIND = "session";

/** How many rows the step decodes per page. */
export const SUB_AGENT_RETIREMENT_PAGE_SIZE = 500;

/** The version message a changed agent's new version carries. */
export const SUB_AGENT_RETIREMENT_VERSION_MESSAGE =
  "subagents are saved agents: the sub-agents written inside this agent were removed and logged as agent manifests";

/** The warning each removed sub-agent is logged under. */
export const SUB_AGENT_REMOVED_MESSAGE =
  "A sub-agent written inside an agent was removed: a subagent is now a saved agent the agent lists. " +
  "Apply the manifest, then add the subagents entry to the agent";

/** A changed agent: its new bytes and the version it now heads. */
export interface RetiredSubAgentsAgent {
  readonly data: Uint8Array;
  readonly versionHash: string;
}

/**
 * The migrated bytes of one agent row, or undefined when it holds no
 * sub-agent. Logs each removed sub-agent (the module header). Throws when
 * the bytes do not decode.
 */
export function retireSubAgentsInAgentRow(
  data: Uint8Array,
  logger: StoreLogger,
): RetiredSubAgentsAgent | undefined {
  const agent = fromBinary(AgentSchema, data);
  const spec = agent.spec;
  const metadata = agent.metadata;
  if (spec === undefined || metadata === undefined) {
    return undefined;
  }
  const subAgents = readSubAgents(spec);
  if (subAgents.length === 0) {
    return undefined;
  }
  writeSubAgents(spec, []);

  const parent = `${metadata.org}/${metadata.slug}`;
  for (const subAgent of subAgents) {
    const slug = frozenSlug(subAgent.name);
    logger.warn(SUB_AGENT_REMOVED_MESSAGE, {
      agent: parent,
      subagent: subAgent.name,
      manifest: subAgentManifest(subAgent, slug, spec),
      add_to_agent: yaml.dump({ subagents: [{ kind: "agent", slug }] }),
    });
  }

  const previousHash = agent.status?.versionHash ?? "";
  const versionHash = canonicalSpecHash(AgentSpecSchema, spec);
  if (agent.status !== undefined) {
    agent.status.versionHash = versionHash;
  }
  metadata.version = create(ApiResourceMetadataVersionSchema, {
    id: versionHash,
    previousVersionId: previousHash,
    message: SUB_AGENT_RETIREMENT_VERSION_MESSAGE,
  });
  return { data: toBinary(AgentSchema, agent), versionHash };
}

/**
 * The migrated bytes of one session row, or undefined when the step leaves
 * it as it is: a session on an agent the step changed moves to the agent's
 * new version. Throws when the bytes do not decode.
 */
export function repinSessionRow(
  data: Uint8Array,
  repinned: ReadonlyMap<string, string>,
): Uint8Array | undefined {
  const session = fromBinary(SessionSchema, data);
  const status = session.status;
  const hash = status === undefined ? undefined : repinned.get(status.agentId);
  if (status === undefined || hash === undefined || status.agentVersionHash === "" || status.agentVersionHash === hash) {
    return undefined;
  }
  status.agentVersionHash = hash;
  return toBinary(SessionSchema, session);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableSubAgentRowError(kind: string, id: string, error: unknown): Error {
  return new Error(
    `${kind} '${id}' cannot be read to retire sub-agents written inside agents: ${String(error)}`,
    { cause: error },
  );
}

/** One sub-agent as an Agent manifest in `stigmer apply`'s shape (the module header). */
export function subAgentManifest(subAgent: FrozenSubAgent, slug: string, parent: AgentSpec): string {
  const reference = (ref: (typeof parent.plugins)[number]) =>
    toJson(ApiResourceReferenceSchema, ref, { useProtoFieldName: true });
  const tools = subAgent.tools.length > 0 ? subAgent.tools : parent.tools;
  const disallowedTools = [...new Set([...parent.disallowedTools, ...subAgent.disallowedTools])];
  const env = Object.fromEntries(
    Object.entries(parent.env).map(([key, declaration]) => [
      key,
      toJson(EnvVarDeclarationSchema, declaration, { useProtoFieldName: true }),
    ]),
  );
  const spec: Record<string, unknown> = {};
  if (subAgent.description !== "") spec["description"] = subAgent.description;
  spec["instructions"] = subAgent.instructions;
  if (subAgent.skillRefs.length > 0) spec["skill_refs"] = subAgent.skillRefs.map(reference);
  if (parent.plugins.length > 0) spec["plugins"] = parent.plugins.map(reference);
  if (Object.keys(env).length > 0) spec["env"] = env;
  if (tools.length > 0) spec["tools"] = [...tools];
  if (disallowedTools.length > 0) spec["disallowed_tools"] = disallowedTools;
  if (subAgent.modelOverride !== "") {
    spec["run_config"] = { model_name: subAgent.modelOverride };
    spec["harness"] = "HARNESS_NATIVE";
  }
  return yaml.dump(
    {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: slug },
      spec,
    },
    { lineWidth: -1 },
  );
}

/**
 * A sub-agent's name as an agent slug: lowercase, spaces, dots and
 * underscores to hyphens, everything outside [a-z0-9-] dropped, hyphens
 * collapsed and trimmed; "subagent" when nothing is left, and "agent-"
 * in front of one that does not start with a letter, since a slug does.
 * Frozen (the module header).
 */
export function frozenSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[ ._]/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") {
    return "subagent";
  }
  return /^[a-z]/.test(slug) ? slug : `agent-${slug}`;
}
