/**
 * The one data migration both store drivers run when the MCP server kind is
 * removed and a plugin becomes one thing: an agent or a conversation that
 * used a plugin's parts lists the plugin itself, every MCP server row
 * leaves the store, and so does every skill a plugin install created. The
 * drivers own the SQL (which rows to read, in what pages, how to write
 * them, the transaction); this module owns what is driver-neutral: what a
 * stored row says, and what one agent or session row becomes.
 *
 * What an agent becomes. Fields the contract now reserves decode as unknown
 * fields (protobuf-es keeps them through `fromBinary`) and are read by wire
 * number, never through a schema that no longer exists:
 *   - a server usage (AgentSpec field 4) naming a server a plugin installed
 *     becomes a `plugins` reference to that plugin; one naming a server
 *     someone added by hand is dropped, and the step logs the agent and the
 *     server with the way back (`stigmer mcp add`); one naming nothing is
 *     dropped;
 *   - a skill reference naming a skill a plugin installed becomes a
 *     reference to that plugin;
 *   - a hook source naming a plugin (HookSource field 1) becomes a
 *     reference to that plugin;
 *   - a tool-list entry naming a plugin's server by its old name
 *     (`mcp__<server slug>`) names it as a turn now does
 *     (`mcp__plugin_<plugin>_<server>`); a sub-agent's lists likewise, and
 *     a sub-agent's reference to a plugin's skill is dropped (the plugin
 *     comes with its parent);
 *   - an agent a plugin install composed (labelled with the plugin) stays,
 *     as an ordinary agent that lists its plugin: its two plugin labels go,
 *     its sub-agents go (they arrive with the plugin as `<plugin>:<agent>`)
 *     and its instructions stay, so a schedule, channel or share on it
 *     keeps running.
 * An agent that used only some of a plugin's parts now gets all of them,
 * since a plugin is attached whole; the step logs each agent it changes.
 * A changed agent is stored as a new current version: its spec's hash is
 * recomputed, the head moves to it (its previous version kept as history,
 * the tag left with the version it named), and the new version is
 * archived like any saved version.
 *
 * What a session becomes. Its server usages (SessionSpec field 7) and its
 * references to a plugin's skills become references to the plugins, as an
 * agent's do, and a session pinned to an agent the step changed is
 * re-pinned to the agent's new version, so its next turn runs the plugins.
 *
 * What is not rewritten. A run keeps the session spec it was created with,
 * as history; an approval granted before the upgrade names the old server
 * and does not carry over (a run's leases are derived per run); schedules,
 * channels and shares carry no tool fields; archived agent versions keep
 * what they held. Each plugin row is left as it is: its status is filled
 * from its archive at boot (domain/plugin/legacy-status.ts).
 *
 * An undecodable row fails the step, the rule the other data migrations
 * keep: the driver's transaction rolls back and the boot stops on the row
 * it names.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";

import { toolServerSegment } from "@stigmer/plugin-package";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataVersionSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { canonicalSpecHash } from "../pipeline/steps/spec-hash.js";
import { FrozenMcpServerEnvelopeSchema } from "./frozen-envelopes.js";
import type { StoreLogger } from "./logger.js";

/** The `kind` column values the step reads, rewrites and removes. */
export const RETIRED_MCP_SERVER_KIND = "mcp_server";
export const PLUGIN_KIND = "plugin";
export const SKILL_KIND = "skill";
export const AGENT_KIND = "agent";
export const SESSION_KIND = "session";
export const POLICY_KIND = "iam_policy";

/** How many rows the step decodes per page. */
export const RETIREMENT_PAGE_SIZE = 500;

/** The label a plugin install stamped on what it created: the plugin's id. */
const PLUGIN_LABEL = "stigmer.ai/plugin";
/** The label a plugin install stamped with the archive digest. */
const PLUGIN_VERSION_LABEL = "stigmer.ai/plugin-version";

/** The retired AgentSpec and SessionSpec fields that held server usages. */
const AGENT_SPEC_SERVER_USAGES_FIELD = 4;
const SESSION_SPEC_SERVER_USAGES_FIELD = 7;
/** McpServerUsage.mcp_server_ref. */
const USAGE_REF_FIELD = 1;
/** The retired HookSource.plugin. */
const HOOK_SOURCE_PLUGIN_FIELD = 1;

/** The version message a changed agent's new version carries. */
export const RETIREMENT_VERSION_MESSAGE =
  "plugins are attached whole: this agent's plugin parts became its plugins";

/** A plugin as the step reads it. */
export interface PluginFacts {
  readonly id: string;
  readonly org: string;
  readonly slug: string;
  readonly name: string;
}

/** A server row as the step reads it. */
export interface ServerFacts {
  readonly id: string;
  readonly org: string;
  readonly slug: string;
  readonly name: string;
  /** The plugin that installed it; absent for a server added by hand. */
  readonly pluginId: string | undefined;
}

/** A skill a plugin installed. */
export interface MemberSkillFacts {
  readonly id: string;
  readonly org: string;
  readonly slug: string;
  readonly pluginId: string;
}

/** Everything the step reads before it rewrites a row. */
export class RetirementFacts {
  private readonly plugins = new Map<string, PluginFacts>();
  private readonly pluginsBySlug = new Map<string, PluginFacts>();
  private readonly servers = new Map<string, ServerFacts>();
  private readonly memberSkills = new Map<string, MemberSkillFacts>();

  addPlugin(plugin: PluginFacts): void {
    this.plugins.set(plugin.id, plugin);
    this.pluginsBySlug.set(`${plugin.org}/${plugin.slug}`, plugin);
  }

  addServer(server: ServerFacts): void {
    this.servers.set(`${server.org}/${server.slug}`, server);
  }

  addMemberSkill(skill: MemberSkillFacts): void {
    this.memberSkills.set(`${skill.org}/${skill.slug}`, skill);
  }

  /** The ids of every server row: they all leave. */
  serverIds(): Set<string> {
    return new Set([...this.servers.values()].map((server) => server.id));
  }

  /** The ids of every skill a plugin installed: they leave. */
  memberSkillIds(): Set<string> {
    return new Set([...this.memberSkills.values()].map((skill) => skill.id));
  }

  plugin(id: string): PluginFacts | undefined {
    return this.plugins.get(id);
  }

  pluginByRef(ref: ApiResourceReference, org: string): PluginFacts | undefined {
    return this.pluginsBySlug.get(`${ref.org || org}/${ref.slug}`);
  }

  server(ref: ApiResourceReference, org: string): ServerFacts | undefined {
    return this.servers.get(`${ref.org || org}/${ref.slug}`);
  }

  memberSkill(ref: ApiResourceReference, org: string): MemberSkillFacts | undefined {
    return this.memberSkills.get(`${ref.org || org}/${ref.slug}`);
  }

  /** Each plugin server's old tool-name prefix and the one a turn uses now. */
  toolRenames(): ReadonlyMap<string, string> {
    const renames = new Map<string, string>();
    for (const server of this.servers.values()) {
      const plugin = server.pluginId === undefined ? undefined : this.plugins.get(server.pluginId);
      if (plugin !== undefined) {
        renames.set(`mcp__${server.slug}`, `mcp__${toolServerSegment(plugin.name, server.name)}`);
      }
    }
    return renames;
  }
}

/** A plugin row's facts. Throws when the bytes do not decode. */
export function pluginFactsOf(data: Uint8Array): PluginFacts {
  const plugin = fromBinary(PluginSchema, data);
  return {
    id: plugin.metadata?.id ?? "",
    org: plugin.metadata?.org ?? "",
    slug: plugin.metadata?.slug ?? "",
    name: plugin.metadata?.name ?? "",
  };
}

/** A server row's facts, through its frozen envelope. Throws when the bytes do not decode. */
export function serverFactsOf(data: Uint8Array): ServerFacts {
  const envelope = fromBinary(FrozenMcpServerEnvelopeSchema, data) as unknown as {
    metadata?: { id: string; org: string; slug: string; name: string; labels: Record<string, string> };
  };
  const metadata = envelope.metadata;
  const pluginId = metadata?.labels[PLUGIN_LABEL] ?? "";
  return {
    id: metadata?.id ?? "",
    org: metadata?.org ?? "",
    slug: metadata?.slug ?? "",
    name: metadata?.name ?? "",
    pluginId: pluginId === "" ? undefined : pluginId,
  };
}

/** A skill row's facts when a plugin installed it; undefined otherwise. Throws when the bytes do not decode. */
export function memberSkillFactsOf(data: Uint8Array): MemberSkillFacts | undefined {
  const skill = fromBinary(SkillSchema, data);
  const pluginId = skill.metadata?.labels[PLUGIN_LABEL] ?? "";
  if (pluginId === "") {
    return undefined;
  }
  return {
    id: skill.metadata?.id ?? "",
    org: skill.metadata?.org ?? "",
    slug: skill.metadata?.slug ?? "",
    pluginId,
  };
}

/** A changed agent: its new bytes and the version it now heads. */
export interface MigratedAgent {
  readonly data: Uint8Array;
  readonly versionHash: string;
}

/**
 * The migrated bytes of one agent row, or undefined when the step leaves
 * it as it is. Throws when the bytes do not decode.
 */
export function migrateAgentRow(
  data: Uint8Array,
  facts: RetirementFacts,
  logger: StoreLogger,
): MigratedAgent | undefined {
  const agent = fromBinary(AgentSchema, data);
  const spec = agent.spec;
  const metadata = agent.metadata;
  if (spec === undefined || metadata === undefined) {
    return undefined;
  }
  const org = metadata.org;
  const composedBy = metadata.labels[PLUGIN_LABEL] ?? "";
  const plugins = new PluginList(spec.plugins, org);
  const dropped: string[] = [];
  let changed = false;

  for (const ref of takeUnknownReferences(spec, AGENT_SPEC_SERVER_USAGES_FIELD, USAGE_REF_FIELD)) {
    changed = true;
    const server = facts.server(ref, org);
    const plugin = server?.pluginId === undefined ? undefined : facts.plugin(server.pluginId);
    if (plugin !== undefined) {
      plugins.add(plugin);
    } else if (server !== undefined) {
      dropped.push(server.slug);
    }
  }

  const keptSkills = spec.skillRefs.filter((ref) => {
    const member = facts.memberSkill(ref, org);
    const plugin = member === undefined ? undefined : facts.plugin(member.pluginId);
    if (member === undefined) {
      return true;
    }
    if (plugin !== undefined) {
      plugins.add(plugin);
    }
    return false;
  });
  if (keptSkills.length !== spec.skillRefs.length) {
    changed = true;
    spec.skillRefs = keptSkills;
  }

  const keptHooks = spec.hooks.filter((source) => {
    const held = takeUnknownReferences(source, HOOK_SOURCE_PLUGIN_FIELD);
    if (held.length === 0) {
      return true;
    }
    changed = true;
    for (const ref of held) {
      const plugin = facts.pluginByRef(ref, org);
      if (plugin !== undefined) {
        plugins.add(plugin);
      }
    }
    return source.source.case !== undefined;
  });
  spec.hooks = keptHooks;

  if (composedBy !== "") {
    changed = true;
    delete metadata.labels[PLUGIN_LABEL];
    delete metadata.labels[PLUGIN_VERSION_LABEL];
    const plugin = facts.plugin(composedBy);
    if (plugin !== undefined) {
      plugins.add(plugin);
    }
    spec.subAgents = [];
  }

  const renames = facts.toolRenames();
  const rename = (entries: string[]): string[] => {
    const next = entries.map((entry) => renamedToolEntry(entry, renames));
    if (next.some((entry, i) => entry !== entries[i])) {
      changed = true;
    }
    return next;
  };
  spec.tools = rename(spec.tools);
  spec.disallowedTools = rename(spec.disallowedTools);
  for (const subAgent of spec.subAgents) {
    subAgent.tools = rename(subAgent.tools);
    subAgent.disallowedTools = rename(subAgent.disallowedTools);
    const kept = subAgent.skillRefs.filter((ref) => facts.memberSkill(ref, org) === undefined);
    if (kept.length !== subAgent.skillRefs.length) {
      changed = true;
      subAgent.skillRefs = kept;
    }
  }

  if (!changed) {
    return undefined;
  }
  spec.plugins = plugins.references();

  for (const server of dropped) {
    logger.warn("An agent used an MCP server that was added by hand; it no longer has it", {
      agent: `${org}/${metadata.slug}`,
      server,
      fix: `add it again as a one-server plugin with 'stigmer mcp add ${server} <url>', then list it in the agent's plugins`,
    });
  }
  logger.info("An agent's plugin parts became its plugins; it now gets each plugin whole", {
    agent: `${org}/${metadata.slug}`,
    plugins: spec.plugins.map((ref) => ref.slug),
  });

  const previousHash = agent.status?.versionHash ?? "";
  const versionHash = canonicalSpecHash(AgentSpecSchema, spec);
  if (agent.status !== undefined) {
    agent.status.versionHash = versionHash;
  }
  metadata.version = create(ApiResourceMetadataVersionSchema, {
    id: versionHash,
    previousVersionId: previousHash,
    message: RETIREMENT_VERSION_MESSAGE,
  });
  return { data: toBinary(AgentSchema, agent), versionHash };
}

/**
 * The migrated bytes of one session row, or undefined when the step leaves
 * it as it is. `repinned` maps an agent the step changed to its new
 * version. Throws when the bytes do not decode.
 */
export function migrateSessionRow(
  data: Uint8Array,
  facts: RetirementFacts,
  repinned: ReadonlyMap<string, string>,
): Uint8Array | undefined {
  const session = fromBinary(SessionSchema, data);
  const spec = session.spec;
  const org = session.metadata?.org ?? "";
  let changed = false;
  if (spec !== undefined) {
    const plugins = new PluginList(spec.plugins, org);
    for (const ref of takeUnknownReferences(spec, SESSION_SPEC_SERVER_USAGES_FIELD, USAGE_REF_FIELD)) {
      changed = true;
      const server = facts.server(ref, org);
      const plugin = server?.pluginId === undefined ? undefined : facts.plugin(server.pluginId);
      if (plugin !== undefined) {
        plugins.add(plugin);
      }
    }
    const kept = spec.skillRefs.filter((ref) => {
      const member = facts.memberSkill(ref, org);
      if (member === undefined) {
        return true;
      }
      const plugin = facts.plugin(member.pluginId);
      if (plugin !== undefined) {
        plugins.add(plugin);
      }
      return false;
    });
    if (kept.length !== spec.skillRefs.length) {
      changed = true;
      spec.skillRefs = kept;
    }
    if (changed) {
      spec.plugins = plugins.references();
    }
  }
  const status = session.status;
  const hash = status === undefined ? undefined : repinned.get(status.agentId);
  if (status !== undefined && hash !== undefined && status.agentVersionHash !== "" && status.agentVersionHash !== hash) {
    status.agentVersionHash = hash;
    changed = true;
  }
  return changed ? toBinary(SessionSchema, session) : undefined;
}

/**
 * Whether a stored IamPolicy row names a server or a plugin's skill the
 * step removes, as its resource or its principal: a grant on a row that no
 * longer exists would only linger in grant listings. Throws when the bytes
 * do not decode.
 */
export function policyNamesRetired(
  data: Uint8Array,
  serverIds: ReadonlySet<string>,
  memberSkillIds: ReadonlySet<string>,
): boolean {
  const spec = fromBinary(IamPolicySchema, data).spec;
  const names = (ref: { kind: string; id: string } | undefined): boolean =>
    ref !== undefined &&
    ((ref.kind === RETIRED_MCP_SERVER_KIND && serverIds.has(ref.id)) ||
      (ref.kind === SKILL_KIND && memberSkillIds.has(ref.id)));
  return names(spec?.resource) || names(spec?.principal);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableRowError(kind: string, id: string, error: unknown): Error {
  return new Error(
    `${kind} '${id}' cannot be read to retire the MCP server kind: ${String(error)}`,
    { cause: error },
  );
}

/** `mcp__<old>` and `mcp__<old>__<tool>` under a plugin server's new name; any other entry unchanged. */
export function renamedToolEntry(entry: string, renames: ReadonlyMap<string, string>): string {
  // A server slug holds no `_`, so the first `__` after the prefix ends it.
  const match = /^(mcp__[a-z0-9-]+)(__.*)?$/.exec(entry);
  if (match === null) {
    return entry;
  }
  const renamed = renames.get(match[1] ?? "");
  return renamed === undefined ? entry : `${renamed}${match[2] ?? ""}`;
}

/** The references a spec lists in `plugins`, each plugin once, in order. */
class PluginList {
  private readonly refs: ApiResourceReference[];
  private readonly seen = new Set<string>();

  constructor(existing: readonly ApiResourceReference[], private readonly org: string) {
    this.refs = [...existing];
    for (const ref of existing) {
      this.seen.add(`${ref.org || org}/${ref.slug}`);
    }
  }

  add(plugin: PluginFacts): void {
    const key = `${plugin.org}/${plugin.slug}`;
    if (this.seen.has(key)) {
      return;
    }
    this.seen.add(key);
    this.refs.push(
      create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.plugin,
        org: plugin.org,
        slug: plugin.slug,
      }),
    );
  }

  references(): ApiResourceReference[] {
    return this.refs;
  }
}

type UnknownField = { readonly no: number; readonly wireType: WireType; readonly data: Uint8Array };

/**
 * Removes every occurrence of a retired length-delimited field from a
 * message's unknown fields and returns the references they held: the
 * field itself when it is a reference, else the reference at `innerField`
 * inside it.
 */
function takeUnknownReferences(
  message: object,
  field: number,
  innerField?: number,
): ApiResourceReference[] {
  const holder = message as { $unknown?: UnknownField[] };
  const held = (holder.$unknown ?? []).filter(
    (f) => f.no === field && f.wireType === WireType.LengthDelimited,
  );
  if (held.length === 0) {
    return [];
  }
  holder.$unknown = (holder.$unknown ?? []).filter((f) => f.no !== field);
  if (holder.$unknown.length === 0) {
    delete holder.$unknown;
  }
  return held.flatMap((f) => {
    const content = new BinaryReader(f.data).bytes();
    const ref = innerField === undefined ? content : lastLengthDelimited(content, innerField);
    return ref === undefined ? [] : [fromBinary(ApiResourceReferenceSchema, ref)];
  });
}

/** The content of the last occurrence of a length-delimited field in an encoded message. */
function lastLengthDelimited(message: Uint8Array, no: number): Uint8Array | undefined {
  const reader = new BinaryReader(message);
  let value: Uint8Array | undefined;
  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === no && wireType === WireType.LengthDelimited) {
      value = reader.bytes();
    } else {
      reader.skip(wireType, fieldNo);
    }
  }
  return value;
}
