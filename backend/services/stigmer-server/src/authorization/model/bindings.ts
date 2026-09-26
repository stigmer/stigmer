/**
 * What the compiled model cannot say about a type, and the evaluator needs:
 * the message schema a stored row of the kind decodes with, and the
 * relations `kind_meta.authorization` cannot derive from the row alone.
 * One row per type of the model, in `fga.mod` order; model/index.ts joins
 * this table with the compiled JSON and refuses, at load, a type with no
 * binding, a binding with no type, and a derived rule for a relation the
 * type does not define.
 *
 * The table is explicit rather than computed from `kind_meta`'s naming
 * convention (`ai.stigmer.<group>.<name>.<version>.<Name>`): a lookup by
 * name would need a registry holding every message and would hide a
 * mistake behind a rule, and an explicit import is what the tree-shaken
 * slim bundle wants. The convention holds for every row but `platform`,
 * and model/__tests__/registry.test.ts pins the table against it.
 *
 * `platform` has no stored resource: it is the singleton the platform's
 * own permissions hang off (`platform:stigmer`), and a check on it
 * resolves over tuples alone. Its row is ROWLESS, so the table says so
 * rather than leaving a hole; the tuple source never loads a row for it
 * and the list scope never lists it.
 *
 * The three derived rules: `default_of` on both instance kinds, which the
 * blueprint's default-instance pointer decides (default-of.ts), and a
 * workflow instance's `execution_viewer`, which its execution visibility
 * decides (execution-viewer.ts).
 */
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { InvitationSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { defaultOfBlueprint } from "./default-of.js";
import { executionViewer } from "./execution-viewer.js";
import type { DerivedRelation } from "./rewrite.js";

/** A type with no stored resource: it resolves over tuples alone (the module header). */
export const ROWLESS = undefined;

export interface KindBinding {
  /** What a stored row decodes with, or ROWLESS. */
  readonly schema: DescMessage | typeof ROWLESS;
  /** The relations `kind_meta` cannot derive, by relation name. */
  readonly derived?: Readonly<Record<string, DerivedRelation>>;
}

/** Every type of the model, bound, in `fga.mod` order. */
export const KIND_BINDINGS: ReadonlyMap<ApiResourceKind, KindBinding> = new Map<
  ApiResourceKind,
  KindBinding
>([
  [ApiResourceKind.platform, { schema: ROWLESS }],
  [ApiResourceKind.identity_account, { schema: IdentityAccountSchema }],
  [ApiResourceKind.identity_provider, { schema: IdentityProviderSchema }],
  [ApiResourceKind.iam_policy, { schema: IamPolicySchema }],
  [ApiResourceKind.api_key, { schema: ApiKeySchema }],
  [ApiResourceKind.oauth_app, { schema: OAuthAppSchema }],
  [ApiResourceKind.platform_client, { schema: PlatformClientSchema }],
  [ApiResourceKind.invitation, { schema: InvitationSchema }],
  [ApiResourceKind.team, { schema: TeamSchema }],
  [ApiResourceKind.organization, { schema: OrganizationSchema }],
  [ApiResourceKind.agent, { schema: AgentSchema }],
  [ApiResourceKind.agent_channel, { schema: AgentChannelSchema }],
  [ApiResourceKind.agent_share, { schema: AgentShareSchema }],
  [ApiResourceKind.channel_app, { schema: ChannelAppSchema }],
  [
    ApiResourceKind.agent_instance,
    {
      schema: AgentInstanceSchema,
      derived: {
        default_of: defaultOfBlueprint({
          kind: ApiResourceKind.agent,
          schema: AgentSchema,
          defaultInstanceIdOf: (agent) => agent.status?.defaultInstanceId ?? "",
        }),
      },
    },
  ],
  [ApiResourceKind.agent_execution, { schema: AgentExecutionSchema }],
  [ApiResourceKind.artifact, { schema: ArtifactSchema }],
  [ApiResourceKind.environment, { schema: EnvironmentSchema }],
  [ApiResourceKind.execution_context, { schema: ExecutionContextSchema }],
  [ApiResourceKind.mcp_server, { schema: McpServerSchema }],
  [ApiResourceKind.memory, { schema: MemorySchema }],
  [ApiResourceKind.plugin, { schema: PluginSchema }],
  [ApiResourceKind.schedule, { schema: ScheduleSchema }],
  [ApiResourceKind.session, { schema: SessionSchema }],
  [ApiResourceKind.skill, { schema: SkillSchema }],
  [ApiResourceKind.workflow, { schema: WorkflowSchema }],
  [
    ApiResourceKind.workflow_instance,
    {
      schema: WorkflowInstanceSchema,
      derived: {
        default_of: defaultOfBlueprint({
          kind: ApiResourceKind.workflow,
          schema: WorkflowSchema,
          defaultInstanceIdOf: (workflow) => workflow.status?.defaultInstanceId ?? "",
        }),
        execution_viewer: executionViewer,
      },
    },
  ],
  [ApiResourceKind.workflow_execution, { schema: WorkflowExecutionSchema }],
]);
