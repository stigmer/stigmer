// Explicit apply-handler registry for `apply -f` (file mode).
//
// Each handler binds an ApiResourceKind to its proto schema (for strict
// YAML→proto marshalling) and the raw command-controller `apply` RPC. We drive
// the *generated controllers* directly — not the high-level SDK `apply(input)`
// methods — because the SDK's `*Input` wrappers are lossy (they drop
// `metadata.id`, so an update would be misrouted as a create). The `apply` RPC
// takes the full resource message, preserving every field round-tripped from
// YAML. This is the keystone decision for Wave 2e.
//
// Registration is explicit (no init magic), mirroring Go's
// newApplyHandlerRegistry — to add a kind, add a line here.

import type { Client } from "@connectrpc/connect";
import type { DescMessage, DescService, Message } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { type Agent, AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { type AgentChannel, AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/command_pb";
import { type AgentInstance, AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/command_pb";
import { type AgentShare, AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";
import { type Datastore, DatastoreSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { DatastoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/command_pb";
import { type Environment, EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { type McpServer, McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { type Session, SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { type Workflow, WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import {
  type WorkflowInstance,
  WorkflowInstanceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/command_pb";
import { type IdentityProvider, IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderCommandController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/command_pb";
import { type OAuthApp, OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppCommandController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/command_pb";
import { type Organization, OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

/** Accessor for a raw Connect client over a generated service controller. */
export type ControllerFn = <Desc extends DescService>(service: Desc) => Client<Desc>;

export interface ApplyHandler {
  readonly kind: ApiResourceKind;
  readonly displayName: string;
  /** Proto schema for strict YAML→proto marshalling. */
  readonly schema: DescMessage;
  /** Drive the controller's `apply` RPC with the full resource message. */
  apply(controller: ControllerFn, message: Message): Promise<Message>;
}

export const APPLY_HANDLERS: ReadonlyMap<ApiResourceKind, ApplyHandler> = new Map<ApiResourceKind, ApplyHandler>([
  [
    ApiResourceKind.organization,
    {
      kind: ApiResourceKind.organization,
      displayName: "Organization",
      schema: OrganizationSchema,
      apply: (c, m) => c(OrganizationCommandController).apply(m as Organization),
    },
  ],
  [
    ApiResourceKind.mcp_server,
    {
      kind: ApiResourceKind.mcp_server,
      displayName: "MCP Server",
      schema: McpServerSchema,
      apply: (c, m) => c(McpServerCommandController).apply(m as McpServer),
    },
  ],
  [
    ApiResourceKind.datastore,
    {
      kind: ApiResourceKind.datastore,
      displayName: "Datastore",
      schema: DatastoreSchema,
      apply: (c, m) => c(DatastoreCommandController).apply(m as Datastore),
    },
  ],
  [
    ApiResourceKind.agent,
    {
      kind: ApiResourceKind.agent,
      displayName: "Agent",
      schema: AgentSchema,
      apply: (c, m) => c(AgentCommandController).apply(m as Agent),
    },
  ],
  [
    ApiResourceKind.workflow,
    {
      kind: ApiResourceKind.workflow,
      displayName: "Workflow",
      schema: WorkflowSchema,
      apply: (c, m) => c(WorkflowCommandController).apply(m as Workflow),
    },
  ],
  [
    ApiResourceKind.environment,
    {
      kind: ApiResourceKind.environment,
      displayName: "Environment",
      schema: EnvironmentSchema,
      apply: (c, m) => c(EnvironmentCommandController).apply(m as Environment),
    },
  ],
  [
    ApiResourceKind.identity_provider,
    {
      kind: ApiResourceKind.identity_provider,
      displayName: "Identity Provider",
      schema: IdentityProviderSchema,
      apply: (c, m) => c(IdentityProviderCommandController).apply(m as IdentityProvider),
    },
  ],
  [
    ApiResourceKind.oauth_app,
    {
      kind: ApiResourceKind.oauth_app,
      displayName: "OAuth App",
      schema: OAuthAppSchema,
      apply: (c, m) => c(OAuthAppCommandController).apply(m as OAuthApp),
    },
  ],
  [
    ApiResourceKind.agent_share,
    {
      kind: ApiResourceKind.agent_share,
      displayName: "Agent Share",
      schema: AgentShareSchema,
      apply: (c, m) => c(AgentShareCommandController).apply(m as AgentShare),
    },
  ],
  [
    ApiResourceKind.agent_channel,
    {
      kind: ApiResourceKind.agent_channel,
      displayName: "Agent Channel",
      schema: AgentChannelSchema,
      apply: (c, m) => c(AgentChannelCommandController).apply(m as AgentChannel),
    },
  ],
  [
    ApiResourceKind.agent_instance,
    {
      kind: ApiResourceKind.agent_instance,
      displayName: "Agent Instance",
      schema: AgentInstanceSchema,
      apply: (c, m) => c(AgentInstanceCommandController).apply(m as AgentInstance),
    },
  ],
  [
    ApiResourceKind.workflow_instance,
    {
      kind: ApiResourceKind.workflow_instance,
      displayName: "Workflow Instance",
      schema: WorkflowInstanceSchema,
      apply: (c, m) => c(WorkflowInstanceCommandController).apply(m as WorkflowInstance),
    },
  ],
  [
    ApiResourceKind.session,
    {
      kind: ApiResourceKind.session,
      displayName: "Session",
      schema: SessionSchema,
      apply: (c, m) => c(SessionCommandController).apply(m as Session),
    },
  ],
]);
