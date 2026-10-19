/**
 * What a turn's data looks like on the agent host's pipe, and the one
 * place it is encoded and decoded (`protocol.ts` says what the pipe is).
 *
 * Three things cross:
 *
 *  - The `TurnInput` (`harness/types.ts`), as {@link WireTurnInput}. The
 *    run's values cross per declarer, as the runner fetched them, minus
 *    one group: a repository's token is the runner's alone (its clone and
 *    write-back run there), so it never reaches the host, which decodes no
 *    repositories. Plain
 *    data stays JSON; protobuf messages cross as base64 of their binary
 *    form, which round-trips them exactly (unknown fields included); Maps
 *    and Sets cross as entry arrays. The aliases the runtime builds are
 *    rebuilt on decode, because adapters rely on them: `session` IS
 *    `blueprint.session`, `blueprint.sessionSpec` IS its spec, and
 *    `mcpDefault.leasedServers` IS `leases.servers`
 *    (`shared/approval-policy.ts`). Each subagent's context crosses whole,
 *    its hook sources as the main agent's do. The members that are behaviour, not
 *    data, are rebuilt in the host over calls back to the runner, which
 *    keeps the authority each one needs: the recalled-memory selection (a
 *    network call that writes the runtime's status), the artifact upload
 *    (the runner's storage credential), and a plugin's verify (the archive
 *    the runner verified). The tool scope is rebuilt from its lists
 *    (`ToolScope.toWire`), and the workspace backend from its two
 *    directories.
 *
 *  - The adapter-owned fields ({@link WireProjection}), host to runner, on
 *    every persist and at settle: the turn's rows the adapter writes
 *    ({@link ADAPTER_OWNED_ROW_FIELDS}, a `TurnRows`: messages, sub-agent
 *    rows, todos and the structured output) and the status's artifacts
 *    ({@link ADAPTER_OWNED_STATUS_FIELDS}, a `RunStatus`). The field
 *    ownership is `TurnSink`'s (`harness/types.ts`): the adapter creates and
 *    amends those while its turn runs; the runtime writes every other field,
 *    and edits the adapter's rows only before `runTurn` or after it returns.
 *    So while a turn runs, the host's copy of those five fields is the only
 *    writer, and the runner replaces its copy wholesale. Arrays are replaced
 *    in place (`splice`), never reassigned: the runtime's transcript builder
 *    and its chokepoint hold the rows' and the status's own arrays
 *    (`harness/transcript/state.ts`). The turn's rows the runtime writes
 *    (the file-review ledger, the memory report) never cross: no adapter
 *    reads them.
 *
 *  - The runtime-owned status fields, runner to host, field by field and
 *    only what changed, so an adapter that reads one (the Cursor harness
 *    reads `startedAt` and `streamingUsage`) sees the runtime's current
 *    value.
 *
 * What crosses back from a persist besides those: the runtime's offloads of
 * large tool outputs (`shared/status-offload.ts`), which the host's copy
 * takes in place of the outputs it still holds unchanged. The offload
 * uploads and keeps its dedupe state on the row, so without them the host's
 * full rows would be uploaded again, and carried across the pipe, on every
 * persist.
 *
 * What does not cross: the runtime's other edits of the adapter's rows
 * during a persist (the secret backstop, `harness/persist-chokepoint.ts`).
 * It is a pure function of the rows it is given with no side effect, so
 * applying it again to every snapshot writes the same rows.
 */

import type { TranscriptMessage } from "@stigmer/eval-runtime";
import { create, fromBinary, toBinary, type DescField, type DescMessage, type MessageShape } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { JsonObject } from "@bufbuild/protobuf";
import { AgentSpecSchema, type AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { ChannelTemplateSchema, MessagingChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/message_io_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { HookGroupSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { RunSchema, RunStatusSchema, type RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { SessionSpecSchema, type SessionSpec } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ToolCallOutputRefSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/message_pb";

import type { ApprovalAsk } from "../harness/approval-answers.js";
import type { TurnFiles, TurnInput, TurnHookSource, TurnSubagent } from "../harness/types.js";
import type { ArtifactStorage } from "../shared/artifact-storage.js";
import type { CloudRepo, PluginSubagent } from "../shared/blueprint-resolver.js";
import type { CasTouchedSnapshot } from "../shared/filereview/cas-touched.js";
import type { HookFormatName } from "../shared/hooks/hook-set.js";
import type { HookServerName } from "../shared/hooks/tool-view.js";
import { platformServerSlugsOf, type ResolvedMcpServer } from "../shared/mcp-resolver.js";
import type { McpToolListing } from "../shared/mcp-tool-listing.js";
import type { RecalledMemoriesContent } from "../shared/recalled-memories.js";
import type { DeclaredPreferencesContent } from "../shared/declared-preferences.js";
import type { SenderIdentity } from "../shared/sender-identity.js";
import type { EffectiveServiceTier } from "../shared/service-tier.js";
import type { SkillMetadata } from "../shared/skill-resolver.js";
import type { EffectiveThinkingMode } from "../shared/thinking-mode.js";
import { ToolScope, type ToolScopeWire } from "../shared/tool-lists.js";
import type { ToolApprovalCategory } from "../shared/tool-kind.js";
import { LocalWorkspaceBackend } from "../shared/workspace/local-backend.js";
import type { ProvisionResult } from "../shared/workspace/types.js";
import type { OffloadedOutput } from "../shared/status-offload.js";
import type { WireCasSnapshot } from "./protocol.js";
import type { ApprovalAction } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { TurnRowsSchema, type TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

// ─── Bytes ─────────────────────────────────────────────────────────────────

export function encodeMessage<D extends DescMessage>(schema: D, message: MessageShape<D>): string {
  return Buffer.from(toBinary(schema, message)).toString("base64");
}

export function decodeMessage<D extends DescMessage>(schema: D, base64: string): MessageShape<D> {
  return fromBinary(schema, Buffer.from(base64, "base64"));
}

/** A run's events as `readRunEvents` carries them across: each its own base64 `SessionEvent`. */
export function encodeRunEvents(events: readonly SessionEvent[]): string[] {
  return events.map((event) => encodeMessage(SessionEventSchema, event));
}

export function decodeRunEvents(wire: readonly string[]): SessionEvent[] {
  return wire.map((event) => decodeMessage(SessionEventSchema, event));
}

// ─── The turn input ────────────────────────────────────────────────────────

/** A hook source as it crosses: its plugin's facts without the verify, which the host rebuilds. */
interface WireHookSource {
  readonly plugin: { readonly id: string; readonly slug: string; readonly name: string; readonly root: string; readonly data: string } | null;
  readonly format: HookFormatName;
  readonly groups: readonly string[];
}

function encodeHookSource(source: TurnHookSource): WireHookSource {
  return {
    plugin: source.plugin
      ? { id: source.plugin.id, slug: source.plugin.slug, name: source.plugin.name, root: source.plugin.root, data: source.plugin.data }
      : null,
    format: source.format,
    groups: source.groups.map((g) => encodeMessage(HookGroupSchema, g)),
  };
}

function decodeHookSource(source: WireHookSource, services: HostTurnServices): TurnHookSource {
  return {
    plugin: source.plugin ? { ...source.plugin, verify: () => services.verifyPlugin(source.plugin!.slug) } : null,
    format: source.format,
    groups: source.groups.map((g) => decodeMessage(HookGroupSchema, g)),
  };
}

/** `TurnInput` as it crosses (the module header says how each member is carried). */
export interface WireTurnInput {
  readonly executionId: string;
  readonly threadId: string;
  readonly turnSeq: number;
  readonly sessionId: string;
  readonly approvalDecisions: readonly (readonly [string, ApprovalAction])[];
  readonly approvalDenyMessages: readonly (readonly [string, string])[];
  readonly approvalAsks: readonly (readonly [string, ApprovalAsk])[];
  readonly execution: string;
  readonly session: string;
  readonly blueprint: {
    readonly agent: { readonly id: string; readonly versionHash: string; readonly spec: string } | null;
    readonly instructions: string;
    readonly pluginAgents: readonly PluginSubagent[];
    readonly subagents: readonly {
      readonly name: string;
      readonly agentId: string;
      readonly versionHash: string;
      readonly spec: string;
      readonly plugins: readonly string[];
    }[];
    readonly plugins: readonly string[];
    readonly mergedSkillRefs: readonly string[];
    readonly cloudRepos: readonly CloudRepo[];
  };
  /** The agent's own values, each tool's by plugin and server, each plugin's for its hooks, each subagent's own; never a repository's token. */
  readonly values: {
    readonly agent: Readonly<Record<string, string>>;
    readonly tools: ReadonlyArray<readonly [string, { readonly url: string; readonly values: Readonly<Record<string, string>> }]>;
    readonly plugins: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;
    readonly subagents: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;
  };
  readonly workspace: {
    readonly dirs: readonly string[];
    readonly primaryDir: string;
    readonly gitWorkspace: boolean;
    readonly captureSubstrate: boolean;
    readonly fileReview: boolean;
    readonly captureMode: boolean;
    readonly changeSetId: string;
    readonly provision: {
      readonly workspaceDirs: readonly string[];
      readonly provisionResults: readonly ProvisionResult[];
      readonly backend: { readonly rootDir: string; readonly platformDir: string | null };
    };
  };
  readonly mcp: {
    readonly servers: readonly ResolvedMcpServer[];
    readonly channelMessaging: readonly { readonly channel: string; readonly templates: readonly string[] }[];
    readonly leases: {
      readonly global: boolean;
      readonly categories: readonly ToolApprovalCategory[];
      readonly servers: readonly string[];
      readonly hooks: readonly string[];
    };
    readonly destructive: readonly string[];
    readonly unlisted: readonly string[];
    readonly listing: McpToolListing | null;
    readonly toolScope: ToolScopeWire;
  };
  readonly skills: { readonly root: readonly SkillMetadata[]; readonly bySubAgent: readonly (readonly [string, readonly SkillMetadata[]])[] };
  readonly hooks: {
    readonly sources: readonly WireHookSource[];
    readonly serverNames: readonly (readonly [string, HookServerName])[];
  };
  readonly subagents: readonly (Omit<TurnSubagent, "toolScope" | "hooks"> & {
    readonly toolScope: ToolScopeWire;
    readonly hooks: readonly WireHookSource[];
  })[];
  /** Plain data already: each image's bytes cross once, in `visionImages`. */
  readonly files: TurnFiles;
  readonly appliedToolCallIds: readonly string[];
  readonly model: {
    readonly requested: string;
    readonly serviceTier: EffectiveServiceTier;
    readonly thinkingMode: EffectiveThinkingMode;
  };
  readonly structuredOutputSchema: Record<string, unknown> | null;
  /** The turn's `RunSpec.append_system_prompt`; empty when unset. */
  readonly appendSystemPrompt: string;
  readonly standing: {
    readonly contextBridge: string | null;
    readonly senderIdentity: SenderIdentity | null;
    readonly sessionContext: string | null;
    readonly declaredPreferences: DeclaredPreferencesContent | null;
    readonly conversationCatchup: string | null;
  };
  /** Whether the runtime resolved a store; the host's stand-in forwards uploads to it. */
  readonly artifactStorage: boolean;
  /** A eval-run try's recorded conversation (`TurnInput.resumedHistory`), or `null` for none. Plain JSON already. */
  readonly resumedHistory: readonly TranscriptMessage[] | null;
}

export function encodeTurnInput(input: TurnInput): WireTurnInput {
  const { blueprint, workspace, mcp, hooks, standing } = input;
  return {
    executionId: input.executionId,
    threadId: input.threadId,
    turnSeq: input.turnSeq,
    sessionId: input.sessionId,
    approvalDecisions: [...input.approvalDecisions],
    approvalDenyMessages: [...input.approvalDenyMessages],
    approvalAsks: [...input.approvalAsks],
    execution: encodeMessage(RunSchema, input.execution),
    session: encodeMessage(SessionSchema, input.session),
    blueprint: {
      agent: blueprint.agent
        ? { id: blueprint.agent.id, versionHash: blueprint.agent.versionHash, spec: encodeMessage(AgentSpecSchema, blueprint.agent.spec) }
        : null,
      instructions: blueprint.instructions,
      pluginAgents: blueprint.pluginAgents,
      subagents: blueprint.subagents.map((subagent) => ({
        name: subagent.name,
        agentId: subagent.agentId,
        versionHash: subagent.versionHash,
        spec: encodeMessage(AgentSpecSchema, subagent.spec),
        plugins: subagent.plugins.map((p) => encodeMessage(PluginSchema, p)),
      })),
      plugins: blueprint.plugins.map((p) => encodeMessage(PluginSchema, p)),
      mergedSkillRefs: blueprint.mergedSkillRefs.map((r) => encodeMessage(ApiResourceReferenceSchema, r)),
      cloudRepos: blueprint.cloudRepos,
    },
    values: {
      agent: input.values.agent,
      tools: [...input.values.tools],
      plugins: [...input.values.plugins],
      subagents: [...input.values.subagents],
    },
    workspace: {
      dirs: workspace.dirs,
      primaryDir: workspace.primaryDir,
      gitWorkspace: workspace.gitWorkspace,
      captureSubstrate: workspace.captureSubstrate,
      fileReview: workspace.fileReview,
      captureMode: workspace.captureMode,
      changeSetId: workspace.changeSetId,
      provision: {
        workspaceDirs: workspace.provision.workspaceDirs,
        provisionResults: workspace.provision.provisionResults,
        backend: {
          rootDir: workspace.provision.workspaceBackend.rootDir,
          platformDir: workspace.provision.workspaceBackend.platformDir ?? null,
        },
      },
    },
    mcp: {
      servers: mcp.servers,
      channelMessaging: mcp.channelMessaging.map((c) => ({
        channel: encodeMessage(MessagingChannelSchema, c.channel),
        templates: c.templates.map((t) => encodeMessage(ChannelTemplateSchema, t)),
      })),
      leases: {
        global: mcp.leases.global,
        categories: [...mcp.leases.categories],
        servers: [...mcp.leases.servers],
        hooks: [...mcp.leases.hooks],
      },
      destructive: [...mcp.mcpDefault.destructive],
      unlisted: [...mcp.mcpDefault.unlisted],
      listing: mcp.listing ?? null,
      toolScope: mcp.toolScope.toWire(),
    },
    skills: { root: input.skills.root, bySubAgent: [...input.skills.bySubAgent] },
    hooks: {
      sources: hooks.sources.map(encodeHookSource),
      serverNames: [...hooks.serverNames],
    },
    subagents: input.subagents.map((subagent) => ({
      ...subagent,
      toolScope: subagent.toolScope.toWire(),
      hooks: subagent.hooks.map(encodeHookSource),
    })),
    files: input.files,
    appliedToolCallIds: [...input.appliedToolCallIds],
    model: { requested: input.model.requested, serviceTier: input.model.serviceTier, thinkingMode: input.model.thinkingMode },
    structuredOutputSchema: input.structuredOutputSchema ?? null,
    appendSystemPrompt: input.appendSystemPrompt,
    standing: {
      contextBridge: standing.contextBridge ?? null,
      senderIdentity: standing.senderIdentity ?? null,
      sessionContext: standing.sessionContext ?? null,
      declaredPreferences: standing.declaredPreferences ?? null,
      conversationCatchup: standing.conversationCatchup ?? null,
    },
    artifactStorage: input.artifactStorage !== undefined,
    resumedHistory: input.resumedHistory ?? null,
  };
}

/** The behaviour the host rebuilds over calls to the runner (the module header). */
export interface HostTurnServices {
  readonly selectRecalledMemories: () => Promise<RecalledMemoriesContent | undefined>;
  readonly artifactStorage: ArtifactStorage;
  readonly verifyPlugin: (slug: string) => Promise<void>;
  readonly readRunEvents: () => Promise<readonly SessionEvent[]>;
}

export function decodeTurnInput(wire: WireTurnInput, services: HostTurnServices): TurnInput {
  const session = decodeMessage(SessionSchema, wire.session);
  const sessionSpec: SessionSpec = session.spec ?? create(SessionSpecSchema);
  session.spec = sessionSpec;
  const agentSpec: AgentSpec | undefined = wire.blueprint.agent ? decodeMessage(AgentSpecSchema, wire.blueprint.agent.spec) : undefined;
  const leasedServers = new Set(wire.mcp.leases.servers);

  return {
    executionId: wire.executionId,
    threadId: wire.threadId,
    turnSeq: wire.turnSeq,
    sessionId: wire.sessionId,
    approvalDecisions: new Map(wire.approvalDecisions),
    approvalDenyMessages: new Map(wire.approvalDenyMessages),
    approvalAsks: new Map(wire.approvalAsks),
    execution: decodeMessage(RunSchema, wire.execution),
    session,
    blueprint: {
      agent: wire.blueprint.agent && agentSpec
        ? { id: wire.blueprint.agent.id, versionHash: wire.blueprint.agent.versionHash, spec: agentSpec }
        : undefined,
      session,
      sessionSpec,
      instructions: wire.blueprint.instructions,
      pluginAgents: [...wire.blueprint.pluginAgents],
      subagents: wire.blueprint.subagents.map((subagent) => ({
        name: subagent.name,
        agentId: subagent.agentId,
        versionHash: subagent.versionHash,
        spec: decodeMessage(AgentSpecSchema, subagent.spec),
        plugins: subagent.plugins.map((p) => decodeMessage(PluginSchema, p)),
      })),
      plugins: wire.blueprint.plugins.map((p) => decodeMessage(PluginSchema, p)),
      mergedSkillRefs: wire.blueprint.mergedSkillRefs.map((r) => decodeMessage(ApiResourceReferenceSchema, r)),
      cloudRepos: [...wire.blueprint.cloudRepos],
    },
    values: {
      agent: wire.values.agent,
      tools: new Map(wire.values.tools),
      plugins: new Map(wire.values.plugins),
      subagents: new Map(wire.values.subagents),
      repositories: [],
    },
    workspace: {
      dirs: wire.workspace.dirs,
      primaryDir: wire.workspace.primaryDir,
      gitWorkspace: wire.workspace.gitWorkspace,
      captureSubstrate: wire.workspace.captureSubstrate,
      fileReview: wire.workspace.fileReview,
      captureMode: wire.workspace.captureMode,
      changeSetId: wire.workspace.changeSetId,
      provision: {
        workspaceDirs: [...wire.workspace.provision.workspaceDirs],
        provisionResults: [...wire.workspace.provision.provisionResults],
        workspaceBackend: new LocalWorkspaceBackend(
          wire.workspace.provision.backend.rootDir,
          wire.workspace.provision.backend.platformDir ?? undefined,
        ),
      },
    },
    mcp: {
      servers: wire.mcp.servers,
      channelMessaging: wire.mcp.channelMessaging.map((c) => ({
        channel: decodeMessage(MessagingChannelSchema, c.channel),
        templates: c.templates.map((t) => decodeMessage(ChannelTemplateSchema, t)),
      })),
      leases: {
        global: wire.mcp.leases.global,
        categories: new Set(wire.mcp.leases.categories),
        servers: leasedServers,
        hooks: new Set(wire.mcp.leases.hooks),
      },
      mcpDefault: { destructive: new Set(wire.mcp.destructive), unlisted: new Set(wire.mcp.unlisted), leasedServers },
      listing: wire.mcp.listing ?? undefined,
      // One truth with the runner's: the platform's servers are the ones
      // whose home says so, so the set is derived here, never carried.
      platformServerSlugs: platformServerSlugsOf(wire.mcp.servers),
      toolScope: ToolScope.fromWire(wire.mcp.toolScope),
    },
    skills: { root: wire.skills.root, bySubAgent: new Map(wire.skills.bySubAgent) },
    hooks: {
      sources: wire.hooks.sources.map((source) => decodeHookSource(source, services)),
      serverNames: new Map(wire.hooks.serverNames),
    },
    subagents: wire.subagents.map((subagent): TurnSubagent => ({
      ...subagent,
      toolScope: ToolScope.fromWire(subagent.toolScope),
      hooks: subagent.hooks.map((source) => decodeHookSource(source, services)),
    })),
    files: wire.files,
    appliedToolCallIds: new Set(wire.appliedToolCallIds),
    model: wire.model,
    structuredOutputSchema: wire.structuredOutputSchema ?? undefined,
    appendSystemPrompt: wire.appendSystemPrompt,
    standing: {
      contextBridge: wire.standing.contextBridge ?? undefined,
      senderIdentity: wire.standing.senderIdentity ?? undefined,
      sessionContext: wire.standing.sessionContext ?? undefined,
      declaredPreferences: wire.standing.declaredPreferences ?? undefined,
      conversationCatchup: wire.standing.conversationCatchup ?? undefined,
      selectRecalledMemories: services.selectRecalledMemories,
    },
    artifactStorage: wire.artifactStorage ? services.artifactStorage : undefined,
    readRunEvents: services.readRunEvents,
    ...(wire.resumedHistory === null ? {} : { resumedHistory: wire.resumedHistory }),
  };
}

// ─── The turn's fields, split by owner ─────────────────────────────────────

/**
 * The rows an adapter writes while its turn runs (`TurnSink`'s ownership
 * list, `harness/types.ts`). The turn's other rows are the runtime's.
 */
export const ADAPTER_OWNED_ROW_FIELDS = ["messages", "subAgentRuns", "todos", "structuredOutput"] as const;

/**
 * The status fields an adapter writes while its turn runs: the artifacts it
 * publishes. Every other status field is the runtime's.
 */
export const ADAPTER_OWNED_STATUS_FIELDS = ["artifacts"] as const;

const ADAPTER_OWNED: ReadonlySet<string> = new Set(ADAPTER_OWNED_STATUS_FIELDS);

const RUNTIME_OWNED_FIELDS: readonly DescField[] = RunStatusSchema.fields.filter((f) => !ADAPTER_OWNED.has(f.localName));

/** The runtime-owned fields, by their generated names. */
export const RUNTIME_OWNED_STATUS_FIELDS: readonly string[] = RUNTIME_OWNED_FIELDS.map((f) => f.localName);

/** What an adapter wrote, as it crosses: the adapter-owned rows and the adapter-owned status fields, each as base64. */
export interface WireProjection {
  /** base64 `TurnRows` holding only {@link ADAPTER_OWNED_ROW_FIELDS}. */
  readonly rows: string;
  /** base64 `RunStatus` holding only {@link ADAPTER_OWNED_STATUS_FIELDS}. */
  readonly status: string;
}

/** The turn's rows and status, the two halves a projection is read from and applied to. */
export interface TurnFields {
  readonly rows: TurnRows;
  readonly status: RunStatus;
}

/** The adapter-owned fields of a turn (the module header). */
export function encodeAdapterProjection(turn: TurnFields): WireProjection {
  const { rows, status } = turn;
  return {
    rows: encodeMessage(
      TurnRowsSchema,
      create(TurnRowsSchema, {
        messages: rows.messages,
        subAgentRuns: rows.subAgentRuns,
        todos: rows.todos,
        ...(rows.structuredOutput !== undefined ? { structuredOutput: rows.structuredOutput } : {}),
      }),
    ),
    status: encodeMessage(RunStatusSchema, create(RunStatusSchema, { artifacts: status.artifacts })),
  };
}

/**
 * Replace `target`'s adapter-owned fields with a projection's. Every array
 * and the todo map are replaced IN PLACE: their identity is what the
 * runtime's builder and chokepoint hold.
 */
export function applyAdapterProjection(target: TurnFields, projection: WireProjection): void {
  const rows = decodeMessage(TurnRowsSchema, projection.rows);
  const status = decodeMessage(RunStatusSchema, projection.status);
  target.rows.messages.splice(0, target.rows.messages.length, ...rows.messages);
  target.rows.subAgentRuns.splice(0, target.rows.subAgentRuns.length, ...rows.subAgentRuns);
  for (const id of Object.keys(target.rows.todos)) {
    if (!(id in rows.todos)) delete target.rows.todos[id];
  }
  Object.assign(target.rows.todos, rows.todos);
  target.rows.structuredOutput = rows.structuredOutput as JsonObject | undefined;
  target.status.artifacts.splice(0, target.status.artifacts.length, ...status.artifacts);
}

/** The runtime-owned fields the host has not seen yet: their names, and a `RunStatus` holding their values. */
export interface RuntimeFieldsWire {
  readonly fields: readonly string[];
  readonly status: string;
}

/**
 * Tracks which runtime-owned fields one host has seen, so each persist
 * answer carries only what changed. One per remote turn: the host's copy
 * starts as the whole status the turn was started with.
 */
export class RuntimeFieldTracker {
  private readonly seen = new Map<string, string>();

  constructor(initial: RunStatus) {
    for (const field of RUNTIME_OWNED_FIELDS) this.seen.set(field.localName, encodeFields(initial, [field]));
  }

  /** The fields of `status` that differ from what the host last saw, marked seen. */
  changes(status: RunStatus): RuntimeFieldsWire {
    const changed = RUNTIME_OWNED_FIELDS.filter((field) => {
      const encoded = encodeFields(status, [field]);
      if (this.seen.get(field.localName) === encoded) return false;
      this.seen.set(field.localName, encoded);
      return true;
    });
    return { fields: changed.map((f) => f.localName), status: encodeFields(status, changed) };
  }
}

/** The runtime's offloads of tool outputs (`shared/status-offload.ts`), as they cross: each ref as a base64 `ToolCallOutputRef`. */
export interface WireOffload {
  readonly toolCallId: string;
  readonly outputRef: string;
}

export function encodeOffloads(offloads: readonly OffloadedOutput[]): WireOffload[] {
  return offloads.map((o) => ({ toolCallId: o.toolCallId, outputRef: encodeMessage(ToolCallOutputRefSchema, o.outputRef) }));
}

export function decodeOffloads(wire: readonly WireOffload[]): OffloadedOutput[] {
  return wire.map((o) => ({ toolCallId: o.toolCallId, outputRef: decodeMessage(ToolCallOutputRefSchema, o.outputRef) }));
}

/** Assign the changed runtime-owned fields onto the host's copy of the status; a name that is not one is ignored. */
export function applyRuntimeFields(target: RunStatus, wire: RuntimeFieldsWire): void {
  const fields = RUNTIME_OWNED_FIELDS.filter((f) => wire.fields.includes(f.localName));
  if (fields.length === 0) return;
  copyFields(decodeMessage(RunStatusSchema, wire.status), target, fields);
}

/** `status`'s `fields`, alone in a `RunStatus`, as base64. */
function encodeFields(status: RunStatus, fields: readonly DescField[]): string {
  const partial = create(RunStatusSchema);
  copyFields(status, partial, fields);
  return encodeMessage(RunStatusSchema, partial);
}

/** Copy `fields` from one status to another by reflection, an unset field cleared. */
function copyFields(from: RunStatus, to: RunStatus, fields: readonly DescField[]): void {
  const source = reflect(RunStatusSchema, from);
  const target = reflect(RunStatusSchema, to);
  for (const field of fields) {
    if (source.isSet(field)) target.set(field, source.get(field));
    else target.clear(field);
  }
}

// ─── CAS observations ──────────────────────────────────────────────────────

export function encodeCasSnapshot(snapshot: CasTouchedSnapshot): WireCasSnapshot {
  return {
    before: [...snapshot.before].map(([path, bytes]) => [path, bytes === null ? null : Buffer.from(bytes).toString("base64")] as const),
    blockedSecretPaths: [...snapshot.blockedSecretPaths],
  };
}

export function decodeCasSnapshot(wire: WireCasSnapshot): CasTouchedSnapshot {
  return {
    before: new Map(wire.before.map(([path, base64]) => [path, base64 === null ? null : new Uint8Array(Buffer.from(base64, "base64"))])),
    blockedSecretPaths: new Set(wire.blockedSecretPaths),
  };
}
