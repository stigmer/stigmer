"use client";

/**
 * Settings section for creating and managing organization invitations.
 *
 * An organization's invitations are administered by its admins: the
 * server lists them to, and creates them for, callers who hold
 * `can_grant_access` on the organization. The manager is mounted once the
 * server confirms the caller holds it; while it answers the page draws the
 * shared skeleton, and everyone else is told that the organization's
 * admins manage invitations, rather than shown an empty list and a create
 * button the server would refuse. A failed check leaves the manager in
 * place: the server answers its own reads.
 */
import { useResourceAvailable } from "@stigmer/react-core";
import { ApiResourceKind } from "@stigmer/react-core/internal";
import { InvitationManager } from "../invitation/InvitationManager.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { useOrg } from "../organization/OrgProvider.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";
import { SettingsSkeleton } from "./SettingsSkeleton.js";

/** Shown in place of the manager to a caller who may not manage invitations. */
const INVITATIONS_MANAGED_BY_ADMINS = "Invitations are managed by your organization's admins.";

/** Props for {@link InvitationsSection}. */
export interface InvitationsSectionProps {
  /**
   * Build the full invite URL from a token, when invitees accept somewhere
   * other than this origin's `/invite/<token>` (a desktop app's links open
   * the web console).
   */
  readonly buildInviteUrl?: (token: string) => string;
}

/** Settings section for creating and managing organization invitations. */
export function InvitationsSection({ buildInviteUrl }: InvitationsSectionProps = {}) {
  const { activeOrg } = useOrg();
  const invitationsAvailable = useResourceAvailable(ApiResourceKind.invitation);
  const orgId = activeOrg?.metadata?.id ?? "";
  const manage = useCheckPermission(
    invitationsAvailable && orgId ? { kind: "organization", id: orgId } : null,
    "can_grant_access",
  );

  return (
    <SettingsPage
      title="Invitations"
      description="Links that let people join this organization with the role you choose: single-use for one person, or multi-use to share."
      unavailable={
        !invitationsAvailable &&
        "Invitations come with Stigmer Enterprise and Cloud. On this edition people join the first time they sign in, and you set their roles under Members."
      }
      denied={
        !manage.isLoading && !manage.allowed && orgId !== ""
          ? { title: "Only an admin can open Invitations", description: INVITATIONS_MANAGED_BY_ADMINS }
          : false
      }
    >
      {!orgId ? (
        <NoOrganization what="its invitations" />
      ) : manage.isLoading ? (
        <SettingsSkeleton label="Loading invitations" rows={2} />
      ) : (
        <InvitationManager org={orgId} {...(buildInviteUrl === undefined ? {} : { buildInviteUrl })} />
      )}
    </SettingsPage>
  );
}
