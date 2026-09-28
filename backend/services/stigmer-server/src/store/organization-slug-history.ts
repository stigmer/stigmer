/**
 * The one data migration both store drivers run when the organization-slug
 * ledger arrives: every slug an organization held before the ledger existed
 * is recorded in it, once, before any request is served. The drivers own
 * the SQL (which rows to read, in what pages, how to insert, the
 * transaction); this module owns what is edition- and driver-neutral: WHICH
 * kinds can name an organization and HOW one row's organization is read.
 *
 * What the step records. Two kinds of slug were taken before the ledger:
 *
 *   - every live organization's, copied from the organization rows by the
 *     driver's SQL alone (an organization's id is its slug), unretired;
 *   - every slug a surviving organization-scoped row still names in
 *     `metadata.org` while no organization holds it, retired. Such a row
 *     outlived an organization the store deleted before the ledger could
 *     record it, and it is exactly what a new organization of that slug
 *     would inherit: under the built-in authorizer a row's organization link
 *     is derived from `metadata.org`, with no creation times compared.
 *
 * A slug whose organization left no row anywhere is not recorded, because
 * nothing in the store remembers it; re-creating that slug inherits nothing.
 *
 * Why a migration and not a boot sweep. The migration chain is the one
 * place that runs exactly once per database, before any request is served
 * (public-visibility-retired.ts makes the same case). A sweep would need a
 * marker, a fault posture, and either a window on its first boot or a boot
 * that waits on it anyway.
 *
 * Why the kind table is frozen here and not read from the live kind
 * configuration. The step is a statement about the store AS IT WAS when the
 * ledger arrived: these are the kinds whose `kind_meta` declared
 * AUTHORIZATION_SCOPE_TYPE_ORGANIZATION at that moment, and a later release
 * that adds or removes a kind must not change what this step does. The list
 * is spelled out with its schemas, the per-consumer kind-to-schema idiom the
 * tree already uses. The `kind` strings are the enum NAMES the drivers'
 * `kind` column holds (proto-fields.ts `apiResourceKindName`).
 *
 * Why an undecodable row fails the step. The row may name a deleted
 * organization, and skipping it would leave that slug free for anyone to
 * take along with everything the row grants. So the driver's transaction
 * rolls back and the boot stops on the row this names, the rule
 * public-visibility-retired.ts keeps for the same reason. A row with no
 * metadata, or an empty organization, names no slug and is not a fault.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { fromBinary } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { SubscriptionSchema } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { InvitationSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";

/** One kind whose rows name their organization, with the schema its rows decode through. */
export interface OrganizationScopedKind {
  /** The enum NAME the drivers' `kind` column holds. */
  readonly kind: string;
  readonly schema: DescMessage;
}

/**
 * The organization-scoped kinds when the ledger arrived, in the order
 * `api_resource_kind.proto` declares them. Frozen: see the module header.
 */
export const ORGANIZATION_SCOPED_KINDS_AT_LEDGER: ReadonlyArray<OrganizationScopedKind> =
  [
    { kind: "iam_policy", schema: IamPolicySchema },
    { kind: "invitation", schema: InvitationSchema },
    { kind: "identity_provider", schema: IdentityProviderSchema },
    { kind: "oauth_app", schema: OAuthAppSchema },
    { kind: "platform_client", schema: PlatformClientSchema },
    { kind: "team", schema: TeamSchema },
    { kind: "agent", schema: AgentSchema },
    { kind: "session", schema: SessionSchema },
    { kind: "skill", schema: SkillSchema },
    { kind: "mcp_server", schema: McpServerSchema },
    { kind: "agent_instance", schema: AgentInstanceSchema },
    { kind: "agent_share", schema: AgentShareSchema },
    { kind: "agent_channel", schema: AgentChannelSchema },
    { kind: "channel_app", schema: ChannelAppSchema },
    { kind: "workflow", schema: WorkflowSchema },
    { kind: "workflow_instance", schema: WorkflowInstanceSchema },
    { kind: "workflow_execution", schema: WorkflowExecutionSchema },
    { kind: "environment", schema: EnvironmentSchema },
    { kind: "artifact", schema: ArtifactSchema },
    { kind: "schedule", schema: ScheduleSchema },
    { kind: "memory", schema: MemorySchema },
    { kind: "plugin", schema: PluginSchema },
    { kind: "subscription", schema: SubscriptionSchema },
  ];

/** How many rows of a kind the step decodes per page, so no kind is ever read whole into memory. */
export const HISTORY_PAGE_SIZE = 500;

/**
 * The organization a stored row names in `metadata.org`, or "" when it names
 * none (no metadata, or an empty organization). Throws when the bytes do not
 * decode through the kind's schema, or when the schema lacks the metadata
 * shape every resource shares: both fail the step (see the header).
 */
export function organizationNamedBy(
  entry: OrganizationScopedKind,
  data: Uint8Array,
): string {
  const message = fromBinary(entry.schema, data);
  const root = reflect(entry.schema, message);
  const metadataField = root.fields.find((field) => field.name === "metadata");
  if (metadataField === undefined || metadataField.fieldKind !== "message") {
    throw new Error(
      `${entry.kind}: the schema declares no metadata message field`,
    );
  }
  if (!root.isSet(metadataField)) {
    return "";
  }
  const metadata = root.get(metadataField);
  const orgField = metadata.fields.find((field) => field.name === "org");
  if (orgField === undefined || orgField.fieldKind !== "scalar") {
    throw new Error(
      `${entry.kind}: the metadata message declares no org field`,
    );
  }
  const org = metadata.get(orgField);
  return typeof org === "string" ? org : "";
}

/**
 * The error a driver throws for a row that does not decode, naming the row,
 * so both drivers stop the boot with the same sentence.
 */
export function undecodableRowError(
  entry: OrganizationScopedKind,
  id: string,
  cause: unknown,
): Error {
  return new Error(
    `${entry.kind} '${id}' cannot be read for the organization it names: ${String(cause)}`,
    { cause },
  );
}
