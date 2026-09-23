"use client";

/**
 * One team's page: its name and description, its members, and deleting it.
 *
 * Every control follows the model, so no one is offered an action the
 * server refuses: editing needs `can_edit` on the team, deleting needs
 * `can_delete`, managing members needs `can_grant_access` (all three are
 * the organization's administrators); every organization viewer sees the
 * team and who is in it.
 *
 * An edit spreads `toTeamUpdateInput(team)` before overriding the name and
 * description: the update replaces the whole resource, and anything not
 * carried forward (labels, the slug) would be wiped. Deleting a team takes
 * every membership and every grant made to the team with it, and the
 * confirmation says exactly that, so no one reads it as deleting people.
 */
import { useCallback, useState, type FormEvent } from "react";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { cn } from "@stigmer/theme";
import { getUserMessage, toTeamUpdateInput } from "@stigmer/sdk";
import { Field, INPUT_CLASSES } from "../internal/form-primitives.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { TEAM_DESCRIPTION_MAX_LENGTH } from "./CreateTeamForm.js";
import { TeamMembersPanel } from "./TeamMembersPanel.js";
import { useDeleteTeam, useUpdateTeam } from "./useTeamMutations.js";

/** Props for {@link TeamDetailPanel}. */
export interface TeamDetailPanelProps {
  readonly team: Team;
  /** The organization's id (`metadata.id`), whose members can be added. */
  readonly orgId: string;
  /** Fired with the saved team after an edit. */
  readonly onUpdated?: (team: Team) => void;
  /** Fired after the team is deleted. */
  readonly onDeleted?: () => void;
  /** Return to the list. */
  readonly onBack?: () => void;
  readonly className?: string;
}

/**
 * Shows and manages one team.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function TeamDetailPanel({
  team,
  orgId,
  onUpdated,
  onDeleted,
  onBack,
  className,
}: TeamDetailPanelProps) {
  const teamId = team.metadata?.id ?? "";
  const name = team.metadata?.name || teamId;
  const description = team.spec?.description ?? "";
  const gate = { kind: "team", id: teamId };

  const [editing, setEditing] = useState(false);

  return (
    <div className={cn("stg:space-y-5", className)}>
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="stg:text-muted-foreground stg:hover:text-foreground stg:mb-1 stg:flex stg:items-center stg:gap-1 stg:text-xs stg:transition-colors"
            >
              <ArrowLeftIcon />
              Back to teams
            </button>
          )}
          {!editing && (
            <>
              <h3 className="stg:text-foreground stg:truncate stg:text-sm stg:font-semibold">{name}</h3>
              {description && (
                <p className="stg:text-muted-foreground stg:mt-0.5 stg:text-xs">{description}</p>
              )}
            </>
          )}
        </div>
        {!editing && (
          <PermissionGate resource={gate} relation="can_edit">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(
                "stg:shrink-0 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
                "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
                "stg:transition-colors",
              )}
            >
              Edit
            </button>
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

      <section aria-label="Members">
        <TeamMembersPanel teamId={teamId} orgId={orgId} />
      </section>

      <PermissionGate resource={gate} relation="can_delete">
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
        const saved = await update({
          ...toTeamUpdateInput(team),
          name: name.trim(),
          description: description.trim() || undefined,
        });
        onSaved(saved);
      } catch {
        // error state is managed by useUpdateTeam
      }
    },
    [canSave, clearError, update, team, name, description, onSaved],
  );

  return (
    <form onSubmit={handleSave} className="stg:space-y-3">
      <Field label="Name" required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isUpdating}
          autoFocus
          className={INPUT_CLASSES}
        />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={TEAM_DESCRIPTION_MAX_LENGTH}
          rows={2}
          disabled={isUpdating}
          className={cn(INPUT_CLASSES, "stg:resize-none")}
        />
      </Field>
      {error && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}
      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isUpdating && <SpinnerIcon size={12} />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isUpdating}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          Cancel
        </button>
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
  const { deleteTeam, isDeleting, error } = useDeleteTeam();
  const [confirming, setConfirming] = useState(false);

  const handleDelete = useCallback(async () => {
    try {
      await deleteTeam({ resourceId: teamId });
      onDeleted?.();
    } catch {
      // error state is managed by useDeleteTeam
    }
  }, [deleteTeam, teamId, onDeleted]);

  if (!confirming) {
    return (
      <div className="stg:border-t stg:border-border stg:pt-4">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={cn(
            "stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:text-destructive stg:hover:bg-destructive-subtle stg:transition-colors",
          )}
        >
          Delete team
        </button>
      </div>
    );
  }

  return (
    <div className="stg:space-y-2 stg:rounded-lg stg:border stg:border-border stg:bg-destructive-subtle stg:px-3 stg:py-2.5">
      <p className="stg:text-xs stg:text-foreground">
        Delete <span className="stg:font-medium">{name}</span>? Everyone in {name} loses
        the access shared with the team. Access granted to them directly stays.
      </p>
      {error && (
        <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}
      <div className="stg:flex stg:items-center stg:gap-1.5">
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            "stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          {isDeleting && <SpinnerIcon size={12} />}
          Delete team
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isDeleting}
          className={cn(
            "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3L5 8l5 5" />
    </svg>
  );
}
