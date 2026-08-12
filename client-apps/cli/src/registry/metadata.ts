// Declarative mirror of api_resource_kind.proto `kind_meta` for CLI-relevant
// kinds.
//
// Why a hand-maintained table instead of reading the proto extension at
// runtime: protobuf-es does not surface custom enum-value options (the
// `kind_meta` extension) through its runtime reflection the way Go's protobuf
// reflection does. The SDK already established this pattern — see
// `sdk/typescript/src/gen/resource-availability.ts`, a generated table derived
// from the same `kind_meta`. T06's codegen pass can emit THIS file the same
// way; until then the table is small, stable, and guarded by tests that pin the
// derived aliases. Values below are copied verbatim from the proto.

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export interface KindMeta {
  /** Proto kind_meta.name — also the YAML `kind` value (e.g. "McpServer"). */
  readonly name: string;
  /** Proto kind_meta.display_name (e.g. "MCP Server"). */
  readonly displayName: string;
  /** Proto kind_meta.id_prefix (e.g. "mcp"). */
  readonly idPrefix: string;
}

export const KIND_META: ReadonlyMap<ApiResourceKind, KindMeta> = new Map([
  [ApiResourceKind.organization, { name: "Organization", displayName: "Organization", idPrefix: "org" }],
  [ApiResourceKind.agent, { name: "Agent", displayName: "Agent", idPrefix: "agt" }],
  [ApiResourceKind.workflow, { name: "Workflow", displayName: "Workflow", idPrefix: "wfl" }],
  [ApiResourceKind.skill, { name: "Skill", displayName: "Skill", idPrefix: "skl" }],
  [ApiResourceKind.mcp_server, { name: "McpServer", displayName: "MCP Server", idPrefix: "mcp" }],
  [ApiResourceKind.project, { name: "Project", displayName: "Project", idPrefix: "prj" }],
  [ApiResourceKind.api_key, { name: "ApiKey", displayName: "API Key", idPrefix: "key" }],
  [ApiResourceKind.identity_provider, { name: "IdentityProvider", displayName: "Identity Provider", idPrefix: "idp" }],
  [ApiResourceKind.oauth_app, { name: "OAuthApp", displayName: "OAuth App", idPrefix: "oapp" }],
  [ApiResourceKind.environment, { name: "Environment", displayName: "Environment", idPrefix: "env" }],
  [ApiResourceKind.agent_share, { name: "AgentShare", displayName: "Agent Share", idPrefix: "ash" }],
  [ApiResourceKind.agent_channel, { name: "AgentChannel", displayName: "Agent Channel", idPrefix: "ach" }],
  [ApiResourceKind.channel_app, { name: "ChannelApp", displayName: "Channel App", idPrefix: "chapp" }],
  [ApiResourceKind.datastore, { name: "Datastore", displayName: "Datastore", idPrefix: "dst" }],
  [ApiResourceKind.schedule, { name: "Schedule", displayName: "Schedule", idPrefix: "sch" }],
  [ApiResourceKind.agent_instance, { name: "AgentInstance", displayName: "Agent Instance", idPrefix: "ain" }],
  [ApiResourceKind.workflow_instance, { name: "WorkflowInstance", displayName: "Workflow Instance", idPrefix: "win" }],
  [ApiResourceKind.session, { name: "Session", displayName: "Session", idPrefix: "ses" }],
  [ApiResourceKind.agent_execution, { name: "AgentExecution", displayName: "Agent Execution", idPrefix: "aex" }],
]);

// Kinds that are user-facing in the CLI and therefore registered as addressable
// types. (Inherited from the Go CLI's `cliRelevantKinds`, removed in the
// TypeScript migration — stigmer/stigmer#203.) Note: agent_execution is
// intentionally excluded — it is driven through its dedicated
// AgentExecutionQueryController RPCs as a command special-case, not the generic
// verb dispatch, even though it carries kind metadata above and a verb-support
// entry below.
export const CLI_RELEVANT_KINDS: readonly ApiResourceKind[] = [
  ApiResourceKind.organization,
  ApiResourceKind.agent,
  ApiResourceKind.workflow,
  ApiResourceKind.skill,
  ApiResourceKind.mcp_server,
  ApiResourceKind.project,
  ApiResourceKind.api_key,
  ApiResourceKind.identity_provider,
  ApiResourceKind.oauth_app,
  ApiResourceKind.environment,
  ApiResourceKind.agent_share,
  ApiResourceKind.agent_channel,
  ApiResourceKind.channel_app,
  ApiResourceKind.datastore,
  ApiResourceKind.schedule,
  ApiResourceKind.agent_instance,
  ApiResourceKind.workflow_instance,
  ApiResourceKind.session,
];
