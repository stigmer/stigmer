"use client";

/**
 * One team's page: its name and description, its members, and deleting it.
 *
 * Every control follows the model, so no one is offered an action the
 * server refuses: editing needs `can_edit` on the team, deleting needs
 * `can_delete`, managing members needs `can_grant_access` (all three are
 * the organization's administrators); every organization viewer sees the
 * team and who is in it. Renaming (the slug field) needs `can_delete`, as
 * deleting does; memberships and shares name the team by id and stay.
 *
 * An edit names the name and description alone, with the etag the team
 * was loaded at: everything else keeps its stored value, and a team
 * changed since it was loaded refuses the save. Deleting a team takes
 * every membership and every grant made to the team with it, and the
 * confirmation says exactly that, so no one reads it as deleting people.
 */
import { ArrowLeft } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import type { Team } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import { buildTeamProto, getUserMessage } from "@stigmer/client";
import { maskedEdit, saveErrorMessage } from "@stigmer/react-core/internal";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { PermissionGate } from "../grant/PermissionGate.js";
import { TEAM_DESCRIPTION_MAX_LENGTH } from "./CreateTeamForm.js";
import { TeamMembersPanel } from "./TeamMembersPanel.js";
import { useDeleteTeam, useUpdateTeam } from "./useTeamMutations.js";
import { ResourceSlugField } from "../resource-detail/RenameSlugField.js";
import { Button } from "../button/Button.js";
import { Section } from "../resource-detail/Section.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { Field, FieldError, TextArea, TextInput } from "../internal/form/index.js";

/** Props for {@link TeamDetailPanel}. */
export interface TeamDetailPanelProps {
  readonly team: Team;
  /** The organization's id (`metadata.id`), whose members can be added. */
  readonly org: string;
  /** Fired with the saved team after an edit. */
  readonly onUpdated?: (team: Team) => void;
  /** Fired after the team is deleted. */
  readonly onDeleted?: () => void;
  /** Return to the list. */
  readonly onBack?: () => void;
  /**
   * Draw the team's name as the panel's heading. `true` (the default) where
   * the panel stands alone; `false` where the page's own title already
   * names the team (the settings page while one is open).
   */
  readonly showName?: boolean;
  readonly className?: string;
}

/**
 * Shows and manages one team.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function TeamDetailPanel({
  team,
  org,
  onUpdated,
  onDeleted,
  onBack,
  showName = true,
  className,
}: TeamDetailPanelProps) {
  const teamId = team.metadata?.id ?? "";
  const name = team.metadata?.name || teamId;
  const description = team.spec?.description ?? "";
  const gate = { kind: "team", id: teamId };

  const [editing, setEditing] = useState(false);

  return (
    <div className={cn("stg:space-y-4", className)}>
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          {onBack && (
            <Button variant="ghost" size="xs" icon={<ArrowLeft className="stg:size-3" aria-hidden="true" />} onClick={onBack}>
              Back to teams
            </Button>
          )}
          {!editing && (
            <>
              {showName && (
                <h3 className="stg:text-foreground stg:truncate stg:text-sm stg:font-semibold">{name}</h3>
              )}
              {description && (
                <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">{description}</p>
              )}
            </>
          )}
        </div>
        {!editing && (
          <PermissionGate fail="closed" resource={gate} relation="can_edit">
            <Button variant="outline" size="xs" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </PermissionGate>
        )}
      </div>

      {editing && (
        <EditTeamForm
          team={team}
          onSaved={(saved) => {
            setEditing(false);
            onUpdated?.(saved);
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {!editing && (
        <ResourceSlugField
          kind="team"
          resourceId={teamId || null}
          currentSlug={team.metadata?.slug ?? ""}
          onRenamed={(renamed) => onUpdated?.(renamed as Team)}
          className="stg:max-w-md"
        />
      )}

      <Section title="Members">
        <div className="stg:p-4">
          <TeamMembersPanel teamId={teamId} org={org} showHeading={false} />
        </div>
      </Section>

      <PermissionGate fail="closed" resource={gate} relation="can_delete">
        <DeleteTeam teamId={teamId} name={name} onDeleted={onDeleted} />
      </PermissionGate>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal subcomponents
// ---------------------------------------------------------------------------

function EditTeamForm({
  team,
  onSaved,
  onCancel,
}: {
  readonly team: Team;
  readonly onSaved: (team: Team) => void;
  readonly onCancel: () => void;
}) {
  const { update, isUpdating, error, clearError } = useUpdateTeam();
  const [name, setName] = useState(team.metadata?.name ?? "");
  const [description, setDescription] = useState(team.spec?.description ?? "");
  const canSave = name.trim() !== "" && !isUpdating;

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSave) return;
      clearError();
      try {
        const { resource, paths } = maskedEdit(team, buildTeamProto, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
        const saved = await update(resource, paths);
        onSaved(saved);
      } catch {
        // error state is managed by useUpdateTeam
      }
    },
    [canSave, clearError, update, team, name, description, onSaved],
  );

  return (
    <form onSubmit={handleSave} className="stg:space-y-3">
      <Field label="Name">
        <TextInput
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isUpdating}
          autoFocus
        />
      </Field>
      <Field label="Description">
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={TEAM_DESCRIPTION_MAX_LENGTH}
          rows={2}
          disabled={isUpdating}
          className="stg:resize-none"
        />
      </Field>
      {error && (
        <FieldError>
          {saveErrorMessage(error, "team")}
        </FieldError>
      )}
      <div className="stg:flex stg:items-center stg:gap-2">
        <Button type="submit" size="xs" disabled={!canSave} icon={isUpdating ? <SpinnerIcon size={12} /> : undefined}>
          Save
        </Button>
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={isUpdating}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteTeam({
  teamId,
  name,
  onDeleted,
}: {
  readonly teamId: string;
  readonly name: string;
  readonly onDeleted?: () => void;
}) {
  const { deleteTeam } = useDeleteTeam();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();

  const askToDelete = useCallback(async () => {
    const deleted = await confirm({
      title: `Delete the team ${name}?`,
      description: `Everyone in ${name} loses what was shared with the team. Access granted to them directly stays, and nothing they made is deleted.`,
      confirmLabel: "Delete team",
      variant: "destructive",
      action: async () => {
        await deleteTeam({ resourceId: teamId });
      },
      failureTitle: `Couldn't delete ${name}.`,
    });
    if (deleted) onDeleted?.();
  }, [confirm, deleteTeam, teamId, name, onDeleted]);

  return (
    <Section title="Delete this team">
      <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-3 stg:p-4">
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
          Everyone in {name} loses what was shared with the team. Nothing they made is deleted.
        </p>
        <Button variant="outline" size="sm" onClick={() => void askToDelete()}>
          Delete team
        </Button>
      </div>
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </Section>
  );
}
