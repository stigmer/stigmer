"use client";

/**
 * The Teams settings page: an organization's teams, creating one, and each
 * team's own page where its members are managed.
 *
 * Teams are an Enterprise and Cloud kind. The section is always listed in
 * the settings navigation, as Identity Providers is, and where the edition
 * does not serve teams it says so instead of showing an empty list; the
 * navigation hides nothing by edition. "New team" is offered only to those
 * who hold `can_create_team` on the organization, its administrators.
 *
 * The section owns the list's data and passes it down, so a create, an edit
 * or a delete refreshes the list here without a child reaching up.
 */
import { useCallback, useId, useState } from "react";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
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
  const headingId = useId();
  const { activeOrg } = useOrg();
  const teamsServed = useResourceAvailable(ApiResourceKind.team);
  const orgSlug = activeOrg?.metadata?.slug ?? "";
  const orgId = activeOrg?.metadata?.id ?? "";

  const list = useTeamList(teamsServed && orgSlug ? orgSlug : null);
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
    <section aria-labelledby={headingId}>
      <div className="stg:mb-3 stg:flex stg:items-center stg:justify-between">
        <h2 id={headingId} className="stg:text-foreground stg:text-sm stg:font-semibold">
          Teams
        </h2>

        {teamsServed && orgId && flow.phase === "idle" && (
          <PermissionGate resource={{ kind: "organization", id: orgId }} relation="can_create_team">
            <button
              type="button"
              onClick={() => setFlow({ phase: "creating" })}
              className="stg:text-primary stg:hover:text-foreground stg:text-xs stg:font-medium stg:transition-colors"
            >
              + New team
            </button>
          </PermissionGate>
        )}
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Teams group people so agents, workflows and other resources can be
        shared with everyone in the team at once. Adding someone to a team
        gives them everything shared with it; removing them, or their leaving
        the organization, takes it away.
      </p>

      {!teamsServed ? (
        <CloudFeatureNotice>
          Teams are available in Stigmer Enterprise and Cloud. This edition
          shares resources with people and with the whole organization.
        </CloudFeatureNotice>
      ) : !orgSlug ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to manage teams.
        </p>
      ) : flow.phase === "creating" ? (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <CreateTeamForm
            org={orgSlug}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : flow.phase === "viewing" ? (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <TeamDetailPanel
            key={flow.team.metadata?.id}
            team={flow.team}
            orgId={orgId}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
            onBack={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : (
        <TeamListPanel
          teams={list.teams}
          isLoading={list.isLoading}
          error={list.error}
          onOpen={(team) => setFlow({ phase: "viewing", team })}
        />
      )}
    </section>
  );
}
