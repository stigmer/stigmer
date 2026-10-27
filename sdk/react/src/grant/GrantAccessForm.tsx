"use client";

/**
 * The grant form: choose who (a person, or a team where the resource can be
 * shared with teams) and which role, then create the grant.
 *
 * The role list follows the chosen grantee: a team is offered only the
 * kind's team roles. Switching the choice from a person to a team clears a
 * role the team cannot hold instead of submitting it for the server to
 * refuse. The grant's grantee is built only through `granteeRef`, so a
 * team always reaches the wire as its members.
 */
import { useCallback, useState, type FormEvent } from "react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import type { Grant } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import {
  ApiResourceRefSchema,
  GrantSpecSchema,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import { cn } from "@stigmer/design-tokens";
import {
  getUserMessage,
  granteeRef,
  iamRoleToString,
  isRoleGrantable,
  isRoleTeamGrantable,
  type Grantee,
} from "@stigmer/client";
import { useCreateGrant } from "./useCreateGrant.js";
import { RoleSelector } from "./RoleSelector.js";
import { PrincipalPicker, type SelectedGrantee } from "./PrincipalPicker.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link GrantAccessForm}. */
export interface GrantAccessFormProps {
  /** Resource kind being granted access to. Determines which roles appear. */
  readonly resourceKind: ApiResourceKind;
  /** Resource kind string (e.g. "organization") for the API resource ref. */
  readonly resourceKindString: string;
  /** ID of the resource being granted access to. */
  readonly resourceId: string;
  /**
   * Organization whose people (and teams) can be granted access. Drives
   * the {@link PrincipalPicker} typeahead.
   */
  readonly org: string;
  /**
   * Offer the organization's teams beside its people. Set it where the
   * resource can be shared with a team (`useShareFlow().canShareWithTeams`).
   */
  readonly includeTeams?: boolean;
  /** Grantees that already have access (shown disabled in the picker). */
  readonly excludeGrantees?: readonly Grantee[];
  /** Fired after a grant is successfully created. */
  readonly onGranted?: (grant: Grant) => void;
  /** Fired when the user cancels. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * What sharing a conversation as Participant means beyond the role's own
 * sentence: whose workspace and logins a participant's message runs with,
 * and which decisions stay with the conversation's owner.
 */
const SESSION_PARTICIPANT_NOTE =
  "Participants send messages. The agent answers in this conversation's workspace, using only the vaults the conversation names; stopping and approving stay with its owner.";

/**
 * What granting Participant on a routine lends: every run a participant
 * starts acts as the routine's creator, and the note they send reaches the
 * agent fenced as information, never as instructions.
 */
const ROUTINE_PARTICIPANT_NOTE =
  "Participants start this routine, with a note, and see its runs. Every run acts as the person who created it; the note reaches the agent as information, not instructions.";

/** What Participant means, for each kind whose Participant needs saying. */
const PARTICIPANT_NOTES: Partial<Record<ApiResourceKind, string>> = {
  [ApiResourceKind.session]: SESSION_PARTICIPANT_NOTE,
  [ApiResourceKind.routine]: ROUTINE_PARTICIPANT_NOTE,
};

/** The note under the role picker for a role on a kind, or `null`. */
function participantNote(kind: ApiResourceKind, role: IamRole | null): string | null {
  return role === IamRole.participant ? (PARTICIPANT_NOTES[kind] ?? null) : null;
}

/**
 * Form for granting a person or a team access to a resource.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <GrantAccessForm
 *   resourceKind={ApiResourceKind.agent}
 *   resourceKindString="agent"
 *   resourceId={agentId}
 *   org={org}
 *   includeTeams={share.canShareWithTeams}
 *   onGranted={() => share.refetch()}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function GrantAccessForm({
  resourceKind,
  resourceKindString,
  resourceId,
  org,
  includeTeams = false,
  excludeGrantees,
  onGranted,
  onCancel,
  className,
}: GrantAccessFormProps) {
  const { create: createGrant, isCreating, error, clearError } =
    useCreateGrant();

  const [grantee, setGrantee] = useState<SelectedGrantee | null>(null);
  const [selectedRole, setSelectedRole] = useState<IamRole | null>(null);

  const chooseGrantee = useCallback(
    (next: SelectedGrantee | null) => {
      setGrantee(next);
      setSelectedRole((role) => {
        if (role === null || next === null) return role;
        const holdable =
          next.kind === "team"
            ? isRoleTeamGrantable(resourceKind, role)
            : isRoleGrantable(resourceKind, role);
        return holdable ? role : null;
      });
    },
    [resourceKind],
  );

  const canSubmit = grantee !== null && selectedRole !== null && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit || selectedRole === null || grantee === null) return;

      clearError();
      try {
        const spec = create(GrantSpecSchema, {
          principal: granteeRef(grantee.grantee),
          resource: create(ApiResourceRefSchema, {
            kind: resourceKindString,
            id: resourceId,
          }),
          relation: iamRoleToString(selectedRole),
        });
        const grant = await createGrant(spec);
        onGranted?.(grant);
      } catch {
        // error state is managed by useCreateGrant
      }
    },
    [
      canSubmit,
      selectedRole,
      grantee,
      resourceKindString,
      resourceId,
      createGrant,
      clearError,
      onGranted,
    ],
  );

  const roleNote = participantNote(resourceKind, selectedRole);

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
      <div className="stg:space-y-3">
        <PrincipalPicker
          org={org}
          value={grantee}
          onChange={chooseGrantee}
          includeTeams={includeTeams}
          excludeGrantees={excludeGrantees}
          disabled={isCreating}
        />

        <RoleSelector
          kind={resourceKind}
          granteeKind={grantee?.kind ?? "identity_account"}
          selected={selectedRole}
          onSelect={setSelectedRole}
          disabled={isCreating}
        />

        {roleNote && (
          <p className="stg:text-2xs stg:text-muted-foreground">
            {roleNote}
          </p>
        )}
      </div>

      {error && (
        <p className="stg:text-destructive stg:text-2xs" role="alert">
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
          Grant access
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
