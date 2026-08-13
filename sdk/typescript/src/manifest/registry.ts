// Explicit manifest-kind registry: the single place that binds a YAML `kind`
// to its proto schema and controller RPCs.
//
// This is the SDK home of the pattern the CLIs already rely on (Go CLI,
// TS CLI `resources/apply/handlers.ts`, mcp-server): strict YAML→proto
// marshalling against the *generated schema*, and apply through the raw
// command controller with the full resource message. The high-level
// `*Input` wrappers are intentionally bypassed — they are lossy (they drop
// `metadata.id` and any field codegen hasn't projected), while the `apply`
// RPC takes the complete resource and the server upserts by slug.
//
// Registration is explicit — to support a new kind, add one entry here.

import type { DescMessage, DescService, Message } from "@bufbuild/protobuf";
import type { Client } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference, UpdateVisibilityInput } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { type Agent, AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { type AgentChannel, AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/command_pb";
import { AgentChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/query_pb";
import { type AgentInstance, AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/command_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { type AgentShare, AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";
import { AgentShareQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/query_pb";
import { type ChannelApp, ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ChannelAppQueryController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/query_pb";
import { type Environment, EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { type McpServer, McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { type Schedule, ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleCommandController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/command_pb";
import { ScheduleQueryController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/query_pb";
import { type Workflow, WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { type IdentityProvider, IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderCommandController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/command_pb";
import { IdentityProviderQueryController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/query_pb";
import { type OAuthApp, OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppCommandController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/command_pb";
import { OAuthAppQueryController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/query_pb";

/**
 * Accessor for a raw Connect client over a generated service controller.
 * Implementations cache clients per service (see `ManifestClient`).
 */
export type ServiceClientFn = <Desc extends DescService>(service: Desc) => Client<Desc>;

/**
 * Binds one YAML `kind` to everything the manifest engine needs:
 * the proto schema (strict marshalling), the command controller's `apply`
 * RPC, and the query controller's `getByReference` RPC (create-vs-update
 * preview).
 */
export interface ManifestKindHandler {
  /** The platform resource kind enum value. */
  readonly kind: ApiResourceKind;
  /** The YAML discriminator, e.g. `"Agent"`. */
  readonly yamlKind: string;
  /** Human-facing name for messages, e.g. `"MCP Server"`. */
  readonly displayName: string;
  /** Canonical `apiVersion` for this kind, e.g. `"agentic.stigmer.ai/v1"`. */
  readonly apiVersion: string;
  /** Proto schema for strict YAML↔proto conversion. */
  readonly schema: DescMessage;
  /**
   * Position in the dependency apply order (ascending). Referenced kinds
   * apply before their dependents, e.g. an McpServer before the Agent that
   * uses it, and everything an AgentChannel references before the channel.
   */
  readonly applyOrder: number;
  /** Drive the command controller's `apply` RPC with the full resource. */
  apply(clientFor: ServiceClientFn, message: Message): Promise<Message>;
  /** Load the current server state by org/slug reference. */
  getByReference(clientFor: ServiceClientFn, ref: ApiResourceReference): Promise<Message>;
  /**
   * Drive the command controller's `updateVisibility` RPC — the ONLY door
   * for visibility changes (both editions preserve stored visibility on
   * plain updates, oss#573). Declared only on kinds whose controller has
   * the RPC (exactly the kinds supporting non-private levels); a manifest
   * engine that finds a visibility diff after apply follows up through
   * this binding so the server-side guards (level support, default-instance
   * rejection) run. Absent on private-only kinds — a visibility diff there
   * is unactionable and should be surfaced to the user, not swallowed.
   */
  updateVisibility?(clientFor: ServiceClientFn, input: UpdateVisibilityInput): Promise<Message>;
}

const AGENTIC_V1 = "agentic.stigmer.ai/v1";
const IAM_V1 = "iam.stigmer.ai/v1";

const HANDLERS: readonly ManifestKindHandler[] = [
  {
    kind: ApiResourceKind.mcp_server,
    yamlKind: "McpServer",
    displayName: "MCP Server",
    apiVersion: AGENTIC_V1,
    schema: McpServerSchema,
    applyOrder: 1,
    apply: (c, m) => c(McpServerCommandController).apply(m as McpServer),
    getByReference: (c, ref) => c(McpServerQueryController).getByReference(ref),
    updateVisibility: (c, i) => c(McpServerCommandController).updateVisibility(i),
  },
  {
    kind: ApiResourceKind.agent,
    yamlKind: "Agent",
    displayName: "Agent",
    apiVersion: AGENTIC_V1,
    schema: AgentSchema,
    applyOrder: 3,
    apply: (c, m) => c(AgentCommandController).apply(m as Agent),
    getByReference: (c, ref) => c(AgentQueryController).getByReference(ref),
    updateVisibility: (c, i) => c(AgentCommandController).updateVisibility(i),
  },
  {
    kind: ApiResourceKind.workflow,
    yamlKind: "Workflow",
    displayName: "Workflow",
    apiVersion: AGENTIC_V1,
    schema: WorkflowSchema,
    applyOrder: 4,
    apply: (c, m) => c(WorkflowCommandController).apply(m as Workflow),
    getByReference: (c, ref) => c(WorkflowQueryController).getByReference(ref),
    updateVisibility: (c, i) => c(WorkflowCommandController).updateVisibility(i),
  },
  {
    kind: ApiResourceKind.environment,
    yamlKind: "Environment",
    displayName: "Environment",
    apiVersion: AGENTIC_V1,
    schema: EnvironmentSchema,
    applyOrder: 5,
    apply: (c, m) => c(EnvironmentCommandController).apply(m as Environment),
    getByReference: (c, ref) => c(EnvironmentQueryController).getByReference(ref),
    updateVisibility: (c, i) => c(EnvironmentCommandController).updateVisibility(i),
  },
  {
    kind: ApiResourceKind.identity_provider,
    yamlKind: "IdentityProvider",
    displayName: "Identity Provider",
    apiVersion: IAM_V1,
    schema: IdentityProviderSchema,
    applyOrder: 6,
    apply: (c, m) => c(IdentityProviderCommandController).apply(m as IdentityProvider),
    getByReference: (c, ref) => c(IdentityProviderQueryController).getByReference(ref),
  },
  {
    kind: ApiResourceKind.oauth_app,
    yamlKind: "OAuthApp",
    displayName: "OAuth App",
    apiVersion: IAM_V1,
    schema: OAuthAppSchema,
    applyOrder: 7,
    apply: (c, m) => c(OAuthAppCommandController).apply(m as OAuthApp),
    getByReference: (c, ref) => c(OAuthAppQueryController).getByReference(ref),
  },
  {
    kind: ApiResourceKind.channel_app,
    yamlKind: "ChannelApp",
    displayName: "Channel App",
    apiVersion: AGENTIC_V1,
    schema: ChannelAppSchema,
    applyOrder: 8,
    apply: (c, m) => c(ChannelAppCommandController).apply(m as ChannelApp),
    getByReference: (c, ref) => c(ChannelAppQueryController).getByReference(ref),
  },
  {
    kind: ApiResourceKind.agent_instance,
    yamlKind: "AgentInstance",
    displayName: "Agent Instance",
    apiVersion: AGENTIC_V1,
    schema: AgentInstanceSchema,
    applyOrder: 9,
    apply: (c, m) => c(AgentInstanceCommandController).apply(m as AgentInstance),
    getByReference: (c, ref) => c(AgentInstanceQueryController).getByReference(ref),
    updateVisibility: (c, i) => c(AgentInstanceCommandController).updateVisibility(i),
  },
  {
    kind: ApiResourceKind.agent_share,
    yamlKind: "AgentShare",
    displayName: "Agent Share",
    apiVersion: AGENTIC_V1,
    schema: AgentShareSchema,
    applyOrder: 10,
    apply: (c, m) => c(AgentShareCommandController).apply(m as AgentShare),
    getByReference: (c, ref) => c(AgentShareQueryController).getByReference(ref),
  },
  // An AgentChannel references an Agent, a ChannelApp, and Environments.
  {
    kind: ApiResourceKind.agent_channel,
    yamlKind: "AgentChannel",
    displayName: "Agent Channel",
    apiVersion: AGENTIC_V1,
    schema: AgentChannelSchema,
    applyOrder: 11,
    apply: (c, m) => c(AgentChannelCommandController).apply(m as AgentChannel),
    getByReference: (c, ref) => c(AgentChannelQueryController).getByReference(ref),
  },
  // Last: a Schedule references an Agent (and, later, a Workflow) — it
  // applies after every kind it can target.
  {
    kind: ApiResourceKind.schedule,
    yamlKind: "Schedule",
    displayName: "Schedule",
    apiVersion: AGENTIC_V1,
    schema: ScheduleSchema,
    applyOrder: 12,
    apply: (c, m) => c(ScheduleCommandController).apply(m as Schedule),
    getByReference: (c, ref) => c(ScheduleQueryController).getByReference(ref),
  },
];

const BY_YAML_KIND: ReadonlyMap<string, ManifestKindHandler> = new Map(
  HANDLERS.map((h) => [h.yamlKind, h]),
);

const BY_TYPE_NAME: ReadonlyMap<string, ManifestKindHandler> = new Map(
  HANDLERS.map((h) => [h.schema.typeName, h]),
);

/** All kinds the manifest engine supports, in dependency apply order. */
export function manifestKinds(): readonly ManifestKindHandler[] {
  return HANDLERS;
}

/** Resolve a handler by its YAML `kind` discriminator (e.g. `"Agent"`). */
export function manifestHandlerForYamlKind(
  yamlKind: string,
): ManifestKindHandler | undefined {
  return BY_YAML_KIND.get(yamlKind);
}

/** Resolve a handler from a proto message's fully-qualified type name. */
export function manifestHandlerForTypeName(
  typeName: string,
): ManifestKindHandler | undefined {
  return BY_TYPE_NAME.get(typeName);
}
