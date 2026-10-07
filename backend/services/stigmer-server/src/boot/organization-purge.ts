/**
 * The organization purge's composition: every kind purge the core runs, in
 * one explicit list (the list-indexes.ts idiom: no import side effects),
 * the stage order, and the boot check that every kind an organization can
 * own is removed by someone or kept on purpose.
 *
 * The order. Schedules go in the quiesce stage, before anything else, so
 * nothing fires while the rest is removed. The content stage then removes
 * leaves first: a run before the session it belongs to, a blueprint's
 * shares and channels
 * before the blueprint, and the environments and clients a run or a
 * blueprint reads last. Each kind's purge cascades what its delete chain
 * cascades, so an order that met a parent first would still converge; the
 * order keeps each batch small.
 *
 * Coverage is a boot check, not a hope (the precedent is
 * `kindsWithoutRows`, authorization/posture.ts: boot refuses a composition
 * that serves a kind no reader can read). Every kind the composition
 * serves whose contract scopes it to an organization or to a parent that
 * is must be owned by exactly one of: a core kind purge (or the core's
 * policy cleanup, for `iam_policy`, whose rows name no organization and go
 * with each resource and with the organization itself), a unit stage's
 * declared `kinds`, a unit's declared retention. None is a kind whose rows
 * would outlive the organization unnoticed; two is two owners that would
 * each assume the other's order.
 *
 * What the tests pin (__tests__/organization-purge-inventory.test.ts): the
 * open-source composition's ownership, the refusals, and the stage order.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { AuthorizationScopeType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import type { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { newAgentPurge } from "../domain/agent/purge.js";
import { newIdentityAccountPurge } from "../domain/identityaccount/purge.js";
import type { IdentityAccountStore } from "../domain/identityaccount/store.js";
import type { ChannelRuntime } from "../domain/agentchannel/channel-runtime.js";
import { newAgentChannelPurge } from "../domain/agentchannel/purge.js";
import { newAgentExecutionPurge } from "../domain/agentrun/purge.js";
import { newAgentSharePurge } from "../domain/agentshare/purge.js";
import { newApiKeyPurge } from "../domain/apikey/purge.js";
import { newChannelAppPurge } from "../domain/channelapp/purge.js";
import { newEnvironmentPurge } from "../domain/environment/purge.js";
import { newExecutionContextPurge } from "../domain/executioncontext/purge.js";
import { newMcpServerPurge } from "../domain/mcpserver/purge.js";
import { newMemoryPurge } from "../domain/memory/purge.js";
import { newOAuthAppPurge } from "../domain/oauthapp/purge.js";
import type { KindPurge, KindPurgeDeps } from "../domain/organization/purge/kind-purge.js";
import { newPlatformClientPurge } from "../domain/platformclient/purge.js";
import type { PlatformClientStore } from "../domain/platformclient/store.js";
import { newPluginPurge } from "../domain/plugin/purge.js";
import type { ClockProvider } from "../domain/schedule/clock.js";
import { newSchedulePurge } from "../domain/schedule/purge.js";
import { newSessionPurge } from "../domain/session/purge.js";
import { newSkillPurge } from "../domain/skill/purge.js";
import type { SecretService } from "../encryption/encryption.js";
import type {
  OrganizationPurgeStage,
  ResolvedOrganizationPurge,
} from "../extensions/organization-purge.js";
import type { ResourceAuthorizationLifecycle } from "../extensions/resource-authorization.js";
import {
  getKindMeta,
  kindEnumName,
  kindServedByEdition,
} from "../pipeline/apiresource-meta.js";
import { quoteJoin } from "../pipeline/errors.js";

/** What the core kind purges read and write through: the composition's own instances. */
export interface CoreKindPurgeDeps extends KindPurgeDeps {
  /** The composed tuple-lifecycle driver every non-organization controller gets. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composition's one secret facade (sealed values' backing state). */
  readonly secretService: SecretService;
  /** The schedule clock the schedule controller tears artifacts down through. */
  readonly scheduleClock: ClockProvider;
  /** The composed channel runtime; undefined when no unit composes one. */
  readonly channelRuntime: ChannelRuntime | undefined;
  /** The PlatformClient port the composition bound. */
  readonly platformClients: PlatformClientStore;
  /** The identity-account port the composition bound. */
  readonly accounts: IdentityAccountStore;
  /** The identity-account controller's lifecycle (the composed driver, or open source's role lifecycle). */
  readonly accountLifecycle: ResourceAuthorizationLifecycle | undefined;
}

/** The core's kind purges, by stage. */
export interface CoreKindPurges {
  /** Run first, in the quiesce stage. */
  readonly quiesce: KindPurge;
  /** Run in the content stage, in this order. */
  readonly content: ReadonlyArray<KindPurge>;
}

export function newCoreKindPurges(deps: CoreKindPurgeDeps): CoreKindPurges {
  return {
    quiesce: newSchedulePurge(deps),
    content: [
      // Runs before the sessions they belong to.
      newAgentExecutionPurge(deps),
      newSessionPurge(deps),
      // A blueprint's shares and channels before the blueprint; a channel
      // before the channel app it references.
      newAgentSharePurge(deps),
      newAgentChannelPurge(deps),
      newChannelAppPurge(deps),
      newMemoryPurge(deps),
      // A plugin's members before the plugin: its purge does not cascade
      // them (plugin/purge.ts says why).
      newAgentPurge(deps),
      newSkillPurge(deps),
      newMcpServerPurge(deps),
      newPluginPurge(deps),
      // What runs and blueprints read, last: an MCP server references its
      // OAuth app, and a run its environments.
      newEnvironmentPurge(deps),
      newOAuthAppPurge(deps),
      newPlatformClientPurge(deps),
      newExecutionContextPurge(deps),
      newApiKeyPurge(deps),
      // The accounts that belong to the organization (a platform client's
      // end users), once nothing it owned names them.
      newIdentityAccountPurge(deps),
    ],
  };
}

/**
 * The kinds the core removes, stated before anything is composed so boot
 * checks coverage before its first side effect: every kind purge's kind
 * (organization-purge-inventory.test.ts holds this list equal to
 * `newCoreKindPurges`), and `iam_policy`, which no kind purge lists because
 * its rows name no organization (each resource's purge revokes the rows
 * naming it, and the final stage the organization's).
 */
export const CORE_PURGED_KINDS: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.schedule,
  ApiResourceKind.agent_run,
  ApiResourceKind.session,
  ApiResourceKind.agent_share,
  ApiResourceKind.agent_channel,
  ApiResourceKind.channel_app,
  ApiResourceKind.memory,
  ApiResourceKind.agent,
  ApiResourceKind.skill,
  ApiResourceKind.mcp_server,
  ApiResourceKind.plugin,
  ApiResourceKind.environment,
  ApiResourceKind.oauth_app,
  ApiResourceKind.platform_client,
  ApiResourceKind.execution_context,
  ApiResourceKind.api_key,
  ApiResourceKind.identity_account,
  ApiResourceKind.iam_policy,
]);

/** Whether the contract scopes the kind to an organization, or to a parent that is. */
function scopedToAnOrganization(kind: ApiResourceKind): boolean {
  let scope: AuthorizationScopeType | undefined;
  try {
    scope = getKindMeta(kind).authorization?.scopeType;
  } catch {
    return false;
  }
  return (
    scope === AuthorizationScopeType.ORGANIZATION ||
    scope === AuthorizationScopeType.PARENT
  );
}

/**
 * Refuses, at boot, a composition in which a served organization-scoped
 * kind is owned by no purge or retention, or by more than one. Throws
 * naming each kind and its owners.
 */
export function assertOrganizationPurgeCoverage(input: {
  readonly edition: ServerEdition;
  readonly coreKinds: ReadonlySet<ApiResourceKind>;
  readonly units: ResolvedOrganizationPurge;
}): void {
  const owners = new Map<ApiResourceKind, string[]>();
  const own = (kind: ApiResourceKind, owner: string): void => {
    owners.set(kind, [...(owners.get(kind) ?? []), owner]);
  };
  for (const kind of input.coreKinds) {
    own(kind, "the core purge");
  }
  for (const { unit, stage } of input.units.stages) {
    for (const kind of stage.kinds ?? []) {
      own(kind, `extension '${unit}' stage '${stage.name}'`);
    }
  }
  for (const { unit, retained } of input.units.retains) {
    if (retained.kind !== undefined) {
      own(retained.kind, `extension '${unit}' retention`);
    }
  }
  const unowned: ApiResourceKind[] = [];
  const doubled: string[] = [];
  for (const value of Object.values(ApiResourceKind)) {
    if (typeof value !== "number") {
      continue;
    }
    const kind = value as ApiResourceKind;
    if (
      !scopedToAnOrganization(kind) ||
      !kindServedByEdition(kind, input.edition)
    ) {
      continue;
    }
    const held = owners.get(kind) ?? [];
    if (held.length === 0) {
      unowned.push(kind);
    } else if (held.length > 1) {
      doubled.push(`'${kindEnumName(kind)}' (${held.join(", ")})`);
    }
  }
  if (unowned.length > 0) {
    throw new Error(
      `the composition serves ${quoteJoin(unowned.map(kindEnumName))}, which an organization owns, but nothing removes them when it is deleted — declare each in an organization purge stage's kinds, or retain it with a reason (ServerExtension.orgPurge)`,
    );
  }
  if (doubled.length > 0) {
    throw new Error(
      `the organization purge has more than one owner for ${doubled.join("; ")} — each kind an organization owns is removed or retained by exactly one`,
    );
  }
}

/** Every stage, in the order the purge runs them: core quiesce, the units', then the core's. */
export function orderOrganizationPurgeStages(input: {
  readonly quiesce: OrganizationPurgeStage;
  readonly units: ResolvedOrganizationPurge;
  readonly content: OrganizationPurgeStage;
  readonly shred: OrganizationPurgeStage;
  readonly children: OrganizationPurgeStage;
  readonly final: OrganizationPurgeStage;
}): ReadonlyArray<OrganizationPurgeStage> {
  return [
    input.quiesce,
    ...input.units.stages.map(({ stage }) => stage),
    input.content,
    input.shred,
    input.children,
    input.final,
  ];
}
