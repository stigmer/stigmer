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
 * The step pages the `kind` column, so it reads each kind by the name its
 * rows carried when the step ran (Postgres v29, SQLite v34), not the name
 * the enum gives it today: a kind renamed after the step has its name at
 * the step's time in {@link KIND_NAMES_AT_STEP}, frozen, and a later
 * step renames its rows. Without it a store replayed from before the step
 * would stamp no row of that kind. A kind two kinds were merged into after
 * the step held no rows of its own then: its predecessors are read by
 * their names through their frozen shapes ({@link MERGED_KINDS_AT_STEP}),
 * since the live message no longer decodes their rows, and the merge
 * stamps each converted row again.
 *
 * Pinned by __tests__/resource-etags-stamped.test.ts and both drivers'
 * migration arms.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelAppSchema } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { ScoringRuleSchema } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { MemorySchema } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/api_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { EvalSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ScoreSchema } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { LicenseSchema } from "@stigmer/apis/ai/stigmer/billing/license/v1/api_pb";
import { PlanSchema } from "@stigmer/apis/ai/stigmer/billing/plan/v1/api_pb";
import { SubscriptionSchema } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/api_pb";
import { ApiKeySchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { FederationIssuerSchema } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { InvitationSchema } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { OAuthAppSchema } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import { TeamSchema } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { etagOf, stampEtag, storedEtagOf } from "./etag.js";
import { FrozenAgentChannelSchema, FrozenAgentShareSchema } from "./frozen-envelopes.js";
import type { StoreLogger } from "./logger.js";
import { apiResourceKindName } from "./proto-fields.js";

/** How many rows the step decodes per page. */
export const ETAG_STAMP_PAGE_SIZE = 100;

/** Every kind that stores a resource, with the message its rows decode as. */
export const RESOURCE_SCHEMAS: ReadonlyMap<ApiResourceKind, DescMessage> = new Map<ApiResourceKind, DescMessage>([
  [ApiResourceKind.agent, AgentSchema],
  [ApiResourceKind.channel, ChannelSchema],
  [ApiResourceKind.api_key, ApiKeySchema],
  [ApiResourceKind.channel_app, ChannelAppSchema],
  [ApiResourceKind.environment, EnvironmentSchema],
  [ApiResourceKind.file, FileSchema],
  [ApiResourceKind.scoring_rule, ScoringRuleSchema],
  [ApiResourceKind.grant, GrantSchema],
  [ApiResourceKind.identity_account, IdentityAccountSchema],
  [ApiResourceKind.federation_issuer, FederationIssuerSchema],
  [ApiResourceKind.invitation, InvitationSchema],
  [ApiResourceKind.license, LicenseSchema],
  [ApiResourceKind.memory, MemorySchema],
  [ApiResourceKind.oauth_app, OAuthAppSchema],
  [ApiResourceKind.organization, OrganizationSchema],
  [ApiResourceKind.plan, PlanSchema],
  [ApiResourceKind.plugin, PluginSchema],
  [ApiResourceKind.eval, EvalSchema],
  [ApiResourceKind.eval_run, EvalRunSchema],
  [ApiResourceKind.run, RunSchema],
  [ApiResourceKind.routine, RoutineSchema],
  [ApiResourceKind.score, ScoreSchema],
  [ApiResourceKind.session, SessionSchema],
  [ApiResourceKind.skill, SkillSchema],
  [ApiResourceKind.subscription, SubscriptionSchema],
  [ApiResourceKind.team, TeamSchema],
  [ApiResourceKind.vault, VaultSchema],
]);

/**
 * The stored name of each kind renamed after this step and the label and
 * tag report (Postgres v29 and v32, SQLite v34 and v36), as their rows
 * spelled it. Postgres v34 and SQLite v38 renamed `iam_policy` to `grant`;
 * Postgres v36 and SQLite v40 renamed `evaluator` to `scoring_rule`.
 */
export const KIND_NAMES_AT_STEP: ReadonlyMap<ApiResourceKind, string> = new Map([
  [ApiResourceKind.grant, "iam_policy"],
  [ApiResourceKind.scoring_rule, "evaluator"],
]);

/**
 * The kinds merged into another after this step and the label and tag
 * report, by the name their rows carried then, with the frozen shape their
 * rows decode through (frozen-envelopes.ts). Postgres v37 and SQLite v41
 * merged `agent_share` and `agent_channel` into `channel`
 * (channel-kinds-merged.ts); no `channel` row existed before them.
 */
export const MERGED_KINDS_AT_STEP: ReadonlyMap<ApiResourceKind, ReadonlyMap<string, DescMessage>> = new Map([
  [
    ApiResourceKind.channel,
    new Map<string, DescMessage>([
      ["agent_share", FrozenAgentShareSchema],
      ["agent_channel", FrozenAgentChannelSchema],
    ]),
  ],
]);

/**
 * Each `kind` column value this step and the label and tag report read,
 * with the message its rows decode as: every kind by its name at the step
 * (KIND_NAMES_AT_STEP), a merged kind by its predecessors'.
 */
export const SCHEMAS_AT_STEP: ReadonlyMap<string, DescMessage> = new Map(
  [...RESOURCE_SCHEMAS].flatMap(([kind, schema]): Array<[string, DescMessage]> => {
    const merged = MERGED_KINDS_AT_STEP.get(kind);
    return merged !== undefined
      ? [...merged]
      : [[KIND_NAMES_AT_STEP.get(kind) ?? apiResourceKindName(kind), schema]];
  }),
);

const SCHEMAS_BY_KIND_NAME = SCHEMAS_AT_STEP;

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

