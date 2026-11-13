"use client";

/**
 * The Teams settings page: an organization's teams, creating one, and each
 * team's own page where its members are managed.
 *
 * Teams are an Enterprise and Cloud kind. The section is always listed in
 * the settings navigation, as Federation Issuers is, and where the edition
 * does not serve teams it says so instead of showing an empty list; the
 * navigation hides nothing by edition. "New team" is offered only to those
 * who hold `can_create_team` on the organization, its administrators.
 *
 * The section owns the list's data and passes it down, so a create, an edit
 * or a delete refreshes the list here without a child reaching up.
 *
 * On Stigmer Cloud, teams are a plan feature: where the organization's plan
 * lacks them, the section names the cheapest plan that includes them and
 * links to the plans in place of "New team", and its existing teams stay
 * readable and usable. Only Cloud reads
 * the plan; on Enterprise a license never lists teams and every
 * organization has them, so the read would refuse Enterprise its own teams.
 */
import { useCallback, useState } from "react";
import type { Team } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import { UpgradeNotice } from "../billing/UpgradeNotice.js";
import { unlockingPlanName } from "../billing/plan-features.js";
import { useEntitlements } from "../billing/useEntitlements.js";
import { usePlans } from "../billing/usePlans.js";
import { useDeploymentMode, useResourceAvailable } from "@stigmer/react-core";
import { ApiResourceKind } from "@stigmer/react-core/internal";
import { Button } from "../button/Button.js";
import { Card } from "../internal/surface/Card.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";
import { PermissionGate } from "../grant/PermissionGate.js";
import { useOrg } from "../organization/OrgProvider.js";
import { CreateTeamForm } from "../team/CreateTeamForm.js";
import { TeamDetailPanel } from "../team/TeamDetailPanel.js";
import { TeamListPanel } from "../team/TeamListPanel.js";
import { useTeamList } from "../team/useTeamList.js";

type FlowState =
  | { readonly phase: "idle" }
  | { readonly phase: "creating" }
  | { readonly phase: "viewing"; readonly team: Team };

/** Settings section for an organization's teams. */
export function TeamsSection() {
  const { activeOrg } = useOrg();
  const teamsServed = useResourceAvailable(ApiResourceKind.team);
  const orgId = activeOrg?.metadata?.id ?? "";

  const onCloud = useDeploymentMode() === "cloud";
  const plan = useEntitlements(orgId || null, { enabled: onCloud && teamsServed });
  const planLacksTeams = plan.allows(Feature.teams) === false;
  const catalog = usePlans({ enabled: planLacksTeams });
  const unlockingPlan = unlockingPlanName(catalog.plans ?? [], Feature.teams);
  const list = useTeamList(teamsServed && orgId ? orgId : null);
  const { refetch } = list;
  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });

  const handleCreated = useCallback(
    (team: Team) => {
      refetch();
      setFlow({ phase: "viewing", team });
    },
    [refetch],
  );

  const handleUpdated = useCallback(
    (team: Team) => {
      refetch();
      setFlow({ phase: "viewing", team });
    },
    [refetch],
  );

  const handleDeleted = useCallback(() => {
    refetch();
    setFlow({ phase: "idle" });
  }, [refetch]);

  return (
    <SettingsPage
      title="Teams"
      description="Groups of people you share agents and other resources with at once. Someone added to a team gets what is shared with it; leaving the team or the organization takes it away."
      actions={
        orgId &&
        flow.phase === "idle" &&
        !planLacksTeams && (
          <PermissionGate resource={{ kind: "organization", id: orgId }} relation="can_create_team">
            <Button size="sm" onClick={() => setFlow({ phase: "creating" })}>
              New team
            </Button>
          </PermissionGate>
        )
      }
      unavailable={
        !teamsServed &&
        "Teams come with Stigmer Enterprise and Cloud. On this edition roles are granted on the organization only: people get access through their role in it, and nothing is shared with individual people or teams."
      }
    >
      {orgId && planLacksTeams && <UpgradeNotice feature={Feature.teams} unlockingPlanName={unlockingPlan} />}
      {!orgId ? (
        <NoOrganization what="its teams" />
      ) : flow.phase === "creating" ? (
        <Card>
          <CreateTeamForm org={orgId} onCreated={handleCreated} onCancel={() => setFlow({ phase: "idle" })} />
        </Card>
      ) : flow.phase === "viewing" ? (
        <Card>
          <TeamDetailPanel
            key={flow.team.metadata?.id}
            team={flow.team}
            org={orgId}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
            onBack={() => setFlow({ phase: "idle" })}
          />
        </Card>
      ) : (
        <TeamListPanel
          teams={list.teams}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={refetch}
          onOpen={(team) => setFlow({ phase: "viewing", team })}
        />
      )}
    </SettingsPage>
  );
}
