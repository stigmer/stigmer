"use client";

/**
 * Create a team: a name and an optional description, the whole of a team's
 * spec. People are added on the team's page once it exists, through the
 * same member list that manages them afterwards, so creation has one job.
 */
import { useCallback, useState, type FormEvent } from "react";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { Field, INPUT_CLASSES } from "../internal/form-primitives.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { useCreateTeam } from "./useTeamMutations.js";

/** The longest description the contract accepts (`TeamSpec.description`). */
export const TEAM_DESCRIPTION_MAX_LENGTH = 500;

/** Props for {@link CreateTeamForm}. */
export interface CreateTeamFormProps {
  /** Organization slug the team is created in. */
  readonly org: string;
  /** Fired with the created team. */
  readonly onCreated?: (team: Team) => void;
  readonly onCancel?: () => void;
  readonly className?: string;
}

/**
 * Form that creates a team in an organization.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function CreateTeamForm({ org, onCreated, onCancel, className }: CreateTeamFormProps) {
  const { create, isCreating, error, clearError } = useCreateTeam();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const canSubmit = name.trim() !== "" && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      clearError();
      try {
        const team = await create({
          name: name.trim(),
          org,
          description: description.trim() || undefined,
        });
        onCreated?.(team);
      } catch {
        // error state is managed by useCreateTeam
      }
    },
    [canSubmit, clearError, create, name, org, description, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
      <h3 className="stg:text-foreground stg:text-sm stg:font-semibold">New team</h3>
      <Field label="Name" required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Site Reliability"
          disabled={isCreating}
          autoFocus
          className={INPUT_CLASSES}
        />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Who is on this team and what it is for"
          maxLength={TEAM_DESCRIPTION_MAX_LENGTH}
          rows={2}
          disabled={isCreating}
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
          disabled={!canSubmit}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon size={12} />}
          Create team
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
