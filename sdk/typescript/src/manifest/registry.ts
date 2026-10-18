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
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceReference,
  RenameInput,
  UpdateVisibilityInput,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import { type Agent, AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { type Channel, ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelCommandController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/command_pb";
import { ChannelQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/query_pb";
import { type ChannelApp, ChannelAppSchema } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { type Environment, EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { ChannelAppCommandController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ChannelAppQueryController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/query_pb";
import { type Routine, RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { type FederationIssuer, FederationIssuerSchema } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerCommandController } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/command_pb";
import { FederationIssuerQueryController } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/query_pb";
import { type OAuthApp, OAuthAppSchema } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppCommandController } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/command_pb";
import { OAuthAppQueryController } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/query_pb";

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
  /** Human-facing name for messages, e.g. `"Channel App"`. */
  readonly displayName: string;
  /** Canonical `apiVersion` for this kind, e.g. `"agentic.stigmer.ai/v1"`. */
  readonly apiVersion: string;
  /** Proto schema for strict YAML↔proto conversion. */
  readonly schema: DescMessage;
  /**
   * Position in the dependency apply order (ascending). Referenced kinds
   * apply before their dependents, e.g. everything a Channel
   * references before the channel.
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
   * this binding so the server-side guards (level support) run. Absent on
   * private-only kinds — a visibility diff there is unactionable and should
   * be surfaced to the user, not swallowed.
   */
  updateVisibility?(clientFor: ServiceClientFn, input: UpdateVisibilityInput): Promise<Message>;
  /**
   * Drive the command controller's `rename` RPC — the ONLY door for a slug
   * change (an apply or update keeps the stored slug). Declared only on
   * kinds whose controller has the RPC; a manifest engine that finds the
   * resource by the manifest's id and a different slug declared follows up
   * through this binding.
   */
  rename?(clientFor: ServiceClientFn, input: RenameInput): Promise<Message>;
}

const AGENTIC_V1 = "agentic.stigmer.ai/v1";
const IAM_V1 = "iam.stigmer.ai/v1";

const HANDLERS: readonly ManifestKindHandler[] = [
  // First: an Environment references nothing, and an Agent's default and a
  // Routine's invocation name one.
  {
    kind: ApiResourceKind.environment,
    yamlKind: "Environment",
    displayName: "Environment",
    apiVersion: AGENTIC_V1,
    schema: EnvironmentSchema,
    applyOrder: 2,
    apply: (c, m) => c(EnvironmentCommandController).apply(m as Environment),
    getByReference: (c, ref) => c(EnvironmentQueryController).getByReference(ref),
    updateVisibility: (c, i) => c(EnvironmentCommandController).updateVisibility(i),
    rename: (c, i) => c(EnvironmentCommandController).rename(i),
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
    rename: (c, i) => c(AgentCommandController).rename(i),
  },
  {
    kind: ApiResourceKind.federation_issuer,
    yamlKind: "FederationIssuer",
    displayName: "Federation Issuer",
    apiVersion: IAM_V1,
    schema: FederationIssuerSchema,
    applyOrder: 6,
    apply: (c, m) => c(FederationIssuerCommandController).apply(m as FederationIssuer),
    getByReference: (c, ref) => c(FederationIssuerQueryController).getByReference(ref),
    rename: (c, i) => c(FederationIssuerCommandController).rename(i),
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
    rename: (c, i) => c(OAuthAppCommandController).rename(i),
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
    rename: (c, i) => c(ChannelAppCommandController).rename(i),
  },
  // A Channel references an Agent, vaults, and (Slack or WhatsApp) a
  // ChannelApp.
  {
    kind: ApiResourceKind.channel,
    yamlKind: "Channel",
    displayName: "Channel",
    apiVersion: AGENTIC_V1,
    schema: ChannelSchema,
    applyOrder: 11,
    apply: (c, m) => c(ChannelCommandController).apply(m as Channel),
    getByReference: (c, ref) => c(ChannelQueryController).getByReference(ref),
    rename: (c, i) => c(ChannelCommandController).rename(i),
  },
  // Last: a Routine references an Agent — it applies after every kind it
  // can target.
  {
    kind: ApiResourceKind.routine,
    yamlKind: "Routine",
    displayName: "Routine",
    apiVersion: AGENTIC_V1,
    schema: RoutineSchema,
    applyOrder: 12,
    apply: (c, m) => c(RoutineCommandController).apply(m as Routine),
    getByReference: (c, ref) => c(RoutineQueryController).getByReference(ref),
    rename: (c, i) => c(RoutineCommandController).rename(i),
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
