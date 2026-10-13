/**
 * The owners' preview of a sign-in requirement (`previewSsoRequirement`):
 * before an owner turns `sso_required` on, who would stop counting in the
 * organization, so nobody is surprised.
 *
 * Who counts as a member here: every account holding a role on the
 * organization directly, and every member of a team that holds one (the
 * policy rows on the organization and on those teams, read through the
 * composition's own binding). An account the organization's SSO provider
 * made counts and is left out; a service account is unaffected by the
 * requirement and is left out; an owner is exempt and listed apart. For each
 * member who would be refused, the preview lists the open invitations they
 * created (which stop redeeming once they are refused or move) and the
 * automations that act as them (schedules, evaluators and evals, which
 * stop: @stigmer/server's account automations, empty where a host's own
 * accounts run them).
 *
 * These are exactly the people the requirement holds (sign-in-rule.ts): a
 * child organization's member reading what the organization shares down,
 * or anyone else with no role in it, is not held and not listed. A key
 * bound to the organization by an account with no role in it is held and
 * not listed; such a key is made only by an account that had a role there.
 */
import { create } from "@bufbuild/protobuf";

import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { AccountAutomationSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type {
  SsoRequirementPreview,
  SsoRequirementPreviewInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import {
  SsoRequirementMemberSchema,
  SsoRequirementPreviewSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type {
  AccountAutomation,
  AccountAutomations,
  ComposedIamPolicies,
  IdentityAccountStore,
  RequestContext,
} from "@stigmer/server";

import { openInvitationsCreatedBy } from "../access-move/handlers.js";
import type { InvitationStore } from "../invitation/store.js";
import { requireLiveSsoProvider } from "./sso-info.js";
import type { SsoProviderReads } from "./sso-info.js";

export interface RequirementPreviewDeps extends SsoProviderReads {
  readonly policies: Pick<ComposedIamPolicies, "findByResource">;
  readonly accounts: Pick<IdentityAccountStore, "findById">;
  readonly automations: AccountAutomations;
  readonly invitations: Pick<InvitationStore, "findIdsByOrg" | "findById">;
}

const ACCOUNT_KIND = "identity_account";
const ORGANIZATION_KIND = "organization";
const TEAM_KIND = ApiResourceKind[ApiResourceKind.team];
const OWNER = IamRole[IamRole.owner];
const TEAM_MEMBER = "member";

/** previewSsoRequirement's domain step. */
export async function previewSsoRequirement(
  reqCtx: RequestContext<typeof SsoRequirementPreviewInputSchema>,
  deps: RequirementPreviewDeps,
): Promise<SsoRequirementPreview> {
  const org = reqCtx.input.org;
  const provider = await requireLiveSsoProvider(deps, org);
  const providerId = provider.metadata?.id ?? "";
  const { members, owners } = await membersOf(deps, org);

  const refused: string[] = [];
  const exempt: string[] = [];
  const accounts = new Map<string, { readonly email: string; readonly displayName: string }>();
  for (const accountId of members) {
    const account = await deps.accounts.findById(accountId);
    if (
      account === undefined ||
      account.spec?.provisioningMode === IdentityAccountProvisioningMode.service_account ||
      (account.spec?.identityProviderRef?.id ?? "") === providerId
    ) {
      continue;
    }
    const spec = account.spec;
    accounts.set(accountId, {
      email: spec?.email ?? "",
      displayName: [spec?.firstName ?? "", spec?.lastName ?? ""].filter((part) => part !== "").join(" "),
    });
    (owners.has(accountId) ? exempt : refused).push(accountId);
  }

  const automations = groupByAccount(await deps.automations.actingAs(org, new Set(refused)));
  const preview = create(SsoRequirementPreviewSchema);
  for (const accountId of refused) {
    preview.members.push(
      create(SsoRequirementMemberSchema, {
        identityAccountId: accountId,
        ...accounts.get(accountId),
        invitationIds: [...(await openInvitationsCreatedBy(deps, org, accountId))],
        automations: (automations.get(accountId) ?? []).map((automation) =>
          create(AccountAutomationSchema, {
            kind: ApiResourceKind[automation.kind],
            id: automation.id,
            slug: automation.slug,
            name: automation.name,
          }),
        ),
      }),
    );
  }
  for (const accountId of exempt) {
    preview.exemptOwners.push(
      create(SsoRequirementMemberSchema, { identityAccountId: accountId, ...accounts.get(accountId) }),
    );
  }
  return preview;
}

/** The accounts holding a role on the organization, directly or through a team, and which of them own it. */
async function membersOf(
  deps: Pick<RequirementPreviewDeps, "policies">,
  org: string,
): Promise<{ readonly members: ReadonlySet<string>; readonly owners: ReadonlySet<string> }> {
  const members = new Set<string>();
  const owners = new Set<string>();
  for (const row of await deps.policies.findByResource(ORGANIZATION_KIND, org)) {
    const principal = row.spec?.principal;
    if (principal?.kind === ACCOUNT_KIND && principal.relation === "") {
      members.add(principal.id);
      if (row.spec?.relation === OWNER) {
        owners.add(principal.id);
      }
    } else if (principal?.kind === TEAM_KIND && principal.relation === TEAM_MEMBER) {
      for (const membership of await deps.policies.findByResource(TEAM_KIND, principal.id)) {
        const member = membership.spec?.principal;
        if (member?.kind === ACCOUNT_KIND && membership.spec?.relation === TEAM_MEMBER) {
          members.add(member.id);
        }
      }
    }
  }
  return { members, owners };
}

function groupByAccount(
  automations: ReadonlyArray<AccountAutomation>,
): ReadonlyMap<string, ReadonlyArray<AccountAutomation>> {
  const grouped = new Map<string, AccountAutomation[]>();
  for (const automation of automations) {
    const held = grouped.get(automation.accountId) ?? [];
    held.push(automation);
    grouped.set(automation.accountId, held);
  }
  return grouped;
}
