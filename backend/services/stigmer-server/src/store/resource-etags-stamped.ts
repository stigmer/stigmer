/**
 * The one data migration both store drivers run when resources gain an
 * etag (etag.ts): every stored resource is stamped with the etag its
 * stored content gives, so a read carries one from the first boot of the
 * release and an editor can send it back. The drivers own the SQL; this
 * module owns what one row becomes.
 *
 * A row is decoded with its kind's resource message ({@link
 * RESOURCE_SCHEMAS}, one entry for every kind that stores a resource, a
 * test keeping it whole against the kind enum) and stamped exactly as a
 * write stamps it, so the etag a migrated row carries is the one its next
 * unchanged write would give. Unknown fields ride through the decode and
 * the encode, as every data migration keeps them. A row whose kind has no
 * entry (a kind the enum no longer names) and a row already carrying its
 * etag are left byte for byte as they are. `updated_at` is left alone: an
 * etag is not an edit.
 *
 * An undecodable row is left as it is, unstamped, and the step goes on:
 * unlike the migrations that drop a secret, nothing is wrong while a row
 * lacks its etag (an update that sends none is last write wins), and no
 * read decodes such a row anyway, so stopping the boot on it would take a
 * server down for a fingerprint. The step logs one line per kind that
 * held one, with the count and the first ids ({@link
 * logUnreadableEtagRows}).
 *
 * Pinned by __tests__/resource-etags-stamped.test.ts and both drivers'
 * migration arms.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { LicenseSchema } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import { PlanSchema } from "@stigmer/protos/ai/stigmer/billing/plan/v1/api_pb";
import { SubscriptionSchema } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/api_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { InvitationSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { etagOf, stampEtag, storedEtagOf } from "./etag.js";
import type { StoreLogger } from "./logger.js";
import { apiResourceKindName } from "./proto-fields.js";

/** How many rows the step decodes per page. */
export const ETAG_STAMP_PAGE_SIZE = 100;

/** Every kind that stores a resource, with the message its rows decode as. */
export const RESOURCE_SCHEMAS: ReadonlyMap<ApiResourceKind, DescMessage> = new Map<ApiResourceKind, DescMessage>([
  [ApiResourceKind.agent, AgentSchema],
  [ApiResourceKind.agent_channel, AgentChannelSchema],
  [ApiResourceKind.agent_share, AgentShareSchema],
  [ApiResourceKind.api_key, ApiKeySchema],
  [ApiResourceKind.channel_app, ChannelAppSchema],
  [ApiResourceKind.evaluator, EvaluatorSchema],
  [ApiResourceKind.iam_policy, IamPolicySchema],
  [ApiResourceKind.identity_account, IdentityAccountSchema],
  [ApiResourceKind.federation_issuer, FederationIssuerSchema],
  [ApiResourceKind.invitation, InvitationSchema],
  [ApiResourceKind.license, LicenseSchema],
  [ApiResourceKind.memory, MemorySchema],
  [ApiResourceKind.oauth_app, OAuthAppSchema],
  [ApiResourceKind.organization, OrganizationSchema],
  [ApiResourceKind.plan, PlanSchema],
  [ApiResourceKind.plugin, PluginSchema],
  [ApiResourceKind.eval_run, EvalRunSchema],
  [ApiResourceKind.run, RunSchema],
  [ApiResourceKind.schedule, ScheduleSchema],
  [ApiResourceKind.score, ScoreSchema],
  [ApiResourceKind.session, SessionSchema],
  [ApiResourceKind.skill, SkillSchema],
  [ApiResourceKind.subscription, SubscriptionSchema],
  [ApiResourceKind.team, TeamSchema],
  [ApiResourceKind.vault, VaultSchema],
]);

const SCHEMAS_BY_KIND_NAME: ReadonlyMap<string, DescMessage> = new Map(
  [...RESOURCE_SCHEMAS].map(([kind, schema]) => [apiResourceKindName(kind), schema]),
);

/** The `kind` column values of the rows the step reads. */
export const ETAG_STAMPED_KIND_NAMES: ReadonlyArray<string> = [...SCHEMAS_BY_KIND_NAME.keys()];

/**
 * The stamped bytes of one row of `kindName`, or undefined when its kind
 * has no entry or it already carries its etag (the driver then leaves its
 * bytes as they are). Throws when the bytes do not decode; the driver
 * leaves such a row as it is and reports it.
 */
export function stampEtagRow(kindName: string, data: Uint8Array): Uint8Array | undefined {
  const schema = SCHEMAS_BY_KIND_NAME.get(kindName);
  if (schema === undefined) {
    return undefined;
  }
  const resource = fromBinary(schema, data);
  const etag = etagOf(schema, resource);
  if (etag === undefined || storedEtagOf(schema, resource) === etag) {
    return undefined;
  }
  stampEtag(schema, resource);
  return toBinary(schema, resource);
}

/** How many unreadable row ids one kind's log line names. */
export const UNREADABLE_ETAG_ROW_SAMPLE = 10;

/** The step's one line for a kind's rows it could not read (the module header). */
export function logUnreadableEtagRows(
  logger: StoreLogger,
  kindName: string,
  ids: ReadonlyArray<string>,
): void {
  if (ids.length === 0) {
    return;
  }
  logger.warn("rows that do not decode were left without an etag", {
    kind: kindName,
    count: ids.length,
    ids: ids.slice(0, UNREADABLE_ETAG_ROW_SAMPLE),
  });
}

