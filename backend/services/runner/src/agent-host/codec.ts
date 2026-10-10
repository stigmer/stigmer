/**
 * What a turn's data looks like on the agent host's pipe, and the one
 * place it is encoded and decoded (`protocol.ts` says what the pipe is).
 *
 * Three things cross:
 *
 *  - The `TurnInput` (`harness/types.ts`), as {@link WireTurnInput}. Plain
 *    data stays JSON; protobuf messages cross as base64 of their binary
 *    form, which round-trips them exactly (unknown fields included); Maps
 *    and Sets cross as entry arrays. The aliases the runtime builds are
 *    rebuilt on decode, because adapters rely on them: `session` IS
 *    `blueprint.session`, `blueprint.sessionSpec` IS its spec, and
 *    `blueprint.subAgents` IS the agent spec's list when the resolver made
 *    it so (`shared/blueprint-resolver.ts`; the built-in judge's is its own
 *    empty list, so whether it is crosses too); `mcpDefault.leasedServers`
 *    IS `leases.servers` (`shared/approval-policy.ts`). The members that are behaviour, not
 *    data, are rebuilt in the host over calls back to the runner, which
 *    keeps the authority each one needs: the recalled-memory selection (a
 *    network call that writes the runtime's status), the artifact upload
 *    (the runner's storage credential), and a plugin's verify (the archive
 *    the runner verified). The tool scope is rebuilt from its lists
 *    (`ToolScope.toWire`), and the workspace backend from its two
 *    directories.
 *
 *  - The adapter-owned half of the status ({@link ADAPTER_OWNED_STATUS_FIELDS}),
 *    host to runner, on every persist and at settle. The field ownership is
 *    `TurnSink`'s (`harness/types.ts`): the adapter creates and amends
 *    transcript rows, todos, artifacts and the structured output while its
 *    turn runs; the runtime writes every other field, and edits the
 *    adapter's rows only before `runTurn` or after it returns. So while a
 *    turn runs, the host's copy of those five fields is the only writer, and
 *    the runner replaces its copy wholesale. Arrays are replaced in place
 *    (`splice`), never reassigned: the runtime's transcript builder and its
 *    chokepoint hold the status's own arrays (`harness/transcript/state.ts`).
 *
 *  - The runtime-owned half, runner to host, field by field and only what
 *    changed, so an adapter that reads one (the Cursor harness reads
 *    `startedAt` and `streamingUsage`) sees the runtime's current value.
 *
 * What crosses back from a persist besides those: the runtime's offloads of
 * large tool outputs (`shared/status-offload.ts`), which the host's copy
 * takes in place of the outputs it still holds unchanged. The offload
 * uploads and keeps its dedupe state on the row, so without them the host's
 * full rows would be uploaded again, and carried across the pipe, on every
 * persist.
 *
 * What does not cross: the runtime's other edits of the adapter's rows
 * during a persist (the secret backstop, the size elision,
 * `harness/persist-chokepoint.ts`). Each is a pure function of the rows it
 * is given with no side effect, so applying it again to every snapshot
 * writes the same status.
 */

import { create, fromBinary, toBinary, type DescField, type DescMessage, type MessageShape } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { JsonObject } from "@bufbuild/protobuf";
import { AgentSpecSchema, SubAgentSchema, type AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ChannelTemplateSchema, MessagingChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { McpServerUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import { HookGroupSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { RunSchema, RunStatusSchema, type RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema, type SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ToolCallOutputRefSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";

import type { TurnInput, TurnHookSource } from "../harness/types.js";
import type { ArtifactStorage } from "../shared/artifact-storage.js";
import type { ResolvedAttachment } from "../shared/attachment-resolver.js";
import type { NotViewableEntry, VisionImage } from "../shared/attachment-vision.js";
import type { CloudRepo } from "../shared/blueprint-resolver.js";
import type { CasTouchedSnapshot } from "../shared/filereview/cas-touched.js";
import type { HookFormatName } from "../shared/hooks/hook-set.js";
import type { PluginServerName } from "../shared/hooks/tool-view.js";
import type { ResolvedMcpServer } from "../shared/mcp-resolver.js";
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

// ─── Bytes ─────────────────────────────────────────────────────────────────

export function encodeMessage<D extends DescMessage>(schema: D, message: MessageShape<D>): string {
  return Buffer.from(toBinary(schema, message)).toString("base64");
}

export function decodeMessage<D extends DescMessage>(schema: D, base64: string): MessageShape<D> {
  return fromBinary(schema, Buffer.from(base64, "base64"));
}

// ─── The turn input ────────────────────────────────────────────────────────

/** A `ResolvedAttachment` whose vision image is an index into `visionImages` when it is one of them. */
type WireAttachment = Omit<ResolvedAttachment, "vision"> & { readonly vision?: number | VisionImage };

/** `TurnInput` as it crosses (the module header says how each member is carried). */
export interface WireTurnInput {
  readonly executionId: string;
  readonly threadId: string;
  readonly turnSeq: number;
  readonly sessionId: string;
  readonly approvalDecisions: readonly (readonly [string, ApprovalAction])[];
  readonly execution: string;
  readonly session: string;
  readonly blueprint: {
    readonly agent: { readonly id: string; readonly versionHash: string; readonly spec: string } | null;
    readonly instructions: string;
    /** True when the list IS the agent spec's own (and `subAgents` is then empty on the wire). */
    readonly subAgentsAreAgentSpecs: boolean;
    readonly subAgents: readonly string[];
    readonly mergedMcpServerUsages: readonly string[];
    readonly mergedSkillRefs: readonly string[];
    readonly cloudRepos: readonly CloudRepo[];
  };
  readonly environment: { readonly envVars: Record<string, string>; readonly secretKeys: readonly string[] };
  readonly workspace: {
    readonly dirs: readonly string[];
    readonly primaryDir: string;
    readonly gitWorkspace: boolean;
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
    readonly platformServerSlugs: readonly string[];
    readonly toolScope: ToolScopeWire;
  };
  readonly skills: { readonly root: readonly SkillMetadata[]; readonly bySubAgent: readonly (readonly [string, readonly SkillMetadata[]])[] };
  readonly hooks: {
    readonly sources: readonly {
      readonly plugin: { readonly slug: string; readonly name: string; readonly root: string; readonly data: string } | null;
      readonly format: HookFormatName;
      readonly groups: readonly string[];
    }[];
    readonly pluginServers: readonly (readonly [string, PluginServerName])[];
  };
  readonly attachments: {
    readonly results: readonly WireAttachment[];
    readonly visionImages: readonly VisionImage[];
    readonly visionNotViewable: readonly NotViewableEntry[];
  };
  readonly appliedToolCallIds: readonly string[];
  readonly model: {
    readonly requested: string;
    readonly serviceTier: EffectiveServiceTier;
    readonly thinkingMode: EffectiveThinkingMode;
  };
  readonly structuredOutputSchema: Record<string, unknown> | null;
  readonly standing: {
    readonly contextBridge: string | null;
    readonly senderIdentity: SenderIdentity | null;
    readonly sessionContext: string | null;
    readonly declaredPreferences: DeclaredPreferencesContent | null;
    readonly conversationCatchup: string | null;
  };
  /** Whether the runtime resolved a store; the host's stand-in forwards uploads to it. */
  readonly artifactStorage: boolean;
}

export function encodeTurnInput(input: TurnInput): WireTurnInput {
  const { blueprint, workspace, mcp, hooks, attachments, standing } = input;
  const visionIndex = new Map(attachments.visionImages.map((image, i) => [image, i] as const));
  return {
    executionId: input.executionId,
    threadId: input.threadId,
    turnSeq: input.turnSeq,
    sessionId: input.sessionId,
    approvalDecisions: [...input.approvalDecisions],
    execution: encodeMessage(RunSchema, input.execution),
    session: encodeMessage(SessionSchema, input.session),
    blueprint: {
      agent: blueprint.agent
        ? { id: blueprint.agent.id, versionHash: blueprint.agent.versionHash, spec: encodeMessage(AgentSpecSchema, blueprint.agent.spec) }
        : null,
      instructions: blueprint.instructions,
      subAgentsAreAgentSpecs: subAgentsAreAgentSpecs(input),
      subAgents: subAgentsAreAgentSpecs(input) ? [] : blueprint.subAgents.map((s) => encodeMessage(SubAgentSchema, s)),
      mergedMcpServerUsages: blueprint.mergedMcpServerUsages.map((u) => encodeMessage(McpServerUsageSchema, u)),
      mergedSkillRefs: blueprint.mergedSkillRefs.map((r) => encodeMessage(ApiResourceReferenceSchema, r)),
      cloudRepos: blueprint.cloudRepos,
    },
    environment: { envVars: input.environment.envVars, secretKeys: [...input.environment.secretKeys] },
    workspace: {
      dirs: workspace.dirs,
      primaryDir: workspace.primaryDir,
      gitWorkspace: workspace.gitWorkspace,
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
      platformServerSlugs: [...mcp.platformServerSlugs],
      toolScope: mcp.toolScope.toWire(),
    },
    skills: { root: input.skills.root, bySubAgent: [...input.skills.bySubAgent] },
    hooks: {
      sources: hooks.sources.map((source) => ({
        plugin: source.plugin
          ? { slug: source.plugin.slug, name: source.plugin.name, root: source.plugin.root, data: source.plugin.data }
          : null,
        format: source.format,
        groups: source.groups.map((g) => encodeMessage(HookGroupSchema, g)),
      })),
      pluginServers: [...hooks.pluginServers],
    },
    attachments: {
      results: attachments.results.map((r): WireAttachment => {
        if (r.vision === undefined) return r;
        const index = visionIndex.get(r.vision);
        return { ...r, vision: index ?? r.vision };
      }),
      visionImages: attachments.visionImages,
      visionNotViewable: attachments.visionNotViewable,
    },
    appliedToolCallIds: [...input.appliedToolCallIds],
    model: { requested: input.model.requested, serviceTier: input.model.serviceTier, thinkingMode: input.model.thinkingMode },
    structuredOutputSchema: input.structuredOutputSchema ?? null,
    standing: {
      contextBridge: standing.contextBridge ?? null,
      senderIdentity: standing.senderIdentity ?? null,
      sessionContext: standing.sessionContext ?? null,
      declaredPreferences: standing.declaredPreferences ?? null,
      conversationCatchup: standing.conversationCatchup ?? null,
    },
    artifactStorage: input.artifactStorage !== undefined,
  };
}

function subAgentsAreAgentSpecs(input: TurnInput): boolean {
  return input.blueprint.agent !== undefined && input.blueprint.subAgents === input.blueprint.agent.spec.subAgents;
}

/** The behaviour the host rebuilds over calls to the runner (the module header). */
export interface HostTurnServices {
  readonly selectRecalledMemories: () => Promise<RecalledMemoriesContent | undefined>;
  readonly artifactStorage: ArtifactStorage;
  readonly verifyPlugin: (slug: string) => Promise<void>;
}

export function decodeTurnInput(wire: WireTurnInput, services: HostTurnServices): TurnInput {
  const session = decodeMessage(SessionSchema, wire.session);
  const sessionSpec: SessionSpec = session.spec ?? create(SessionSpecSchema);
  session.spec = sessionSpec;
  const agentSpec: AgentSpec | undefined = wire.blueprint.agent ? decodeMessage(AgentSpecSchema, wire.blueprint.agent.spec) : undefined;
  const leasedServers = new Set(wire.mcp.leases.servers);
  const visionImages = wire.attachments.visionImages;

  return {
    executionId: wire.executionId,
    threadId: wire.threadId,
    turnSeq: wire.turnSeq,
    sessionId: wire.sessionId,
    approvalDecisions: new Map(wire.approvalDecisions),
    execution: decodeMessage(RunSchema, wire.execution),
    session,
    blueprint: {
      agent: wire.blueprint.agent && agentSpec
        ? { id: wire.blueprint.agent.id, versionHash: wire.blueprint.agent.versionHash, spec: agentSpec }
        : undefined,
      session,
      sessionSpec,
      instructions: wire.blueprint.instructions,
      subAgents:
        agentSpec && wire.blueprint.subAgentsAreAgentSpecs
          ? agentSpec.subAgents
          : wire.blueprint.subAgents.map((s) => decodeMessage(SubAgentSchema, s)),
      mergedMcpServerUsages: wire.blueprint.mergedMcpServerUsages.map((u) => decodeMessage(McpServerUsageSchema, u)),
      mergedSkillRefs: wire.blueprint.mergedSkillRefs.map((r) => decodeMessage(ApiResourceReferenceSchema, r)),
      cloudRepos: [...wire.blueprint.cloudRepos],
    },
    environment: { envVars: wire.environment.envVars, secretKeys: new Set(wire.environment.secretKeys) },
    workspace: {
      dirs: wire.workspace.dirs,
      primaryDir: wire.workspace.primaryDir,
      gitWorkspace: wire.workspace.gitWorkspace,
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
      mcpDefault: { destructive: new Set(wire.mcp.destructive), leasedServers },
      platformServerSlugs: new Set(wire.mcp.platformServerSlugs),
      toolScope: ToolScope.fromWire(wire.mcp.toolScope),
    },
    skills: { root: wire.skills.root, bySubAgent: new Map(wire.skills.bySubAgent) },
    hooks: {
      sources: wire.hooks.sources.map((source): TurnHookSource => ({
        plugin: source.plugin
          ? { ...source.plugin, verify: () => services.verifyPlugin(source.plugin!.slug) }
          : null,
        format: source.format,
        groups: source.groups.map((g) => decodeMessage(HookGroupSchema, g)),
      })),
      pluginServers: new Map(wire.hooks.pluginServers),
    },
    attachments: {
      results: wire.attachments.results.map((r): ResolvedAttachment => {
        if (r.vision === undefined) return r as ResolvedAttachment;
        const vision = typeof r.vision === "number" ? visionImages[r.vision] : r.vision;
        return { ...r, vision };
      }),
      visionImages,
      visionNotViewable: wire.attachments.visionNotViewable,
    },
    appliedToolCallIds: new Set(wire.appliedToolCallIds),
    model: wire.model,
    structuredOutputSchema: wire.structuredOutputSchema ?? undefined,
    standing: {
      contextBridge: wire.standing.contextBridge ?? undefined,
      senderIdentity: wire.standing.senderIdentity ?? undefined,
      sessionContext: wire.standing.sessionContext ?? undefined,
      declaredPreferences: wire.standing.declaredPreferences ?? undefined,
      conversationCatchup: wire.standing.conversationCatchup ?? undefined,
      selectRecalledMemories: services.selectRecalledMemories,
    },
    artifactStorage: wire.artifactStorage ? services.artifactStorage : undefined,
  };
}

// ─── The status, split by owner ────────────────────────────────────────────

/**
 * The status fields an adapter writes while its turn runs (`TurnSink`'s
 * ownership list, `harness/types.ts`). Every other field is the runtime's.
 */
export const ADAPTER_OWNED_STATUS_FIELDS = ["messages", "subAgentRuns", "todos", "artifacts", "structuredOutput"] as const;

const ADAPTER_OWNED: ReadonlySet<string> = new Set(ADAPTER_OWNED_STATUS_FIELDS);

const RUNTIME_OWNED_FIELDS: readonly DescField[] = RunStatusSchema.fields.filter((f) => !ADAPTER_OWNED.has(f.localName));

/** The runtime-owned fields, by their generated names. */
export const RUNTIME_OWNED_STATUS_FIELDS: readonly string[] = RUNTIME_OWNED_FIELDS.map((f) => f.localName);

/** The adapter-owned fields of `status`, as base64 of a `RunStatus` holding only them. */
export function encodeAdapterProjection(status: RunStatus): string {
  return encodeMessage(
    RunStatusSchema,
    create(RunStatusSchema, {
      messages: status.messages,
      subAgentRuns: status.subAgentRuns,
      todos: status.todos,
      artifacts: status.artifacts,
      ...(status.structuredOutput !== undefined ? { structuredOutput: status.structuredOutput } : {}),
    }),
  );
}

/**
 * Replace `target`'s adapter-owned fields with a projection's. Every array
 * and the todo map are replaced IN PLACE: their identity is what the
 * runtime's builder and chokepoint hold.
 */
export function applyAdapterProjection(target: RunStatus, projection: string): void {
  const source = decodeMessage(RunStatusSchema, projection);
  target.messages.splice(0, target.messages.length, ...source.messages);
  target.subAgentRuns.splice(0, target.subAgentRuns.length, ...source.subAgentRuns);
  target.artifacts.splice(0, target.artifacts.length, ...source.artifacts);
  for (const id of Object.keys(target.todos)) {
    if (!(id in source.todos)) delete target.todos[id];
  }
  Object.assign(target.todos, source.todos);
  target.structuredOutput = source.structuredOutput as JsonObject | undefined;
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

/** Assign the changed runtime-owned fields onto the host's copy of the status; a name that is not one is ignored. */
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
