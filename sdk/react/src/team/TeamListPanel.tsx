"use client";

/**
 * The organization's teams as a list of rows a person opens to see and
 * manage a team. Presentational: the section owns `useTeamList` and passes
 * its state down, so creating or deleting a team refreshes the list without
 * a child reaching up for a refetch.
 *
 * Rows carry the name and description only. A member count per row would
 * be one membership read per team on every render of the list, and the
 * count lives where the members do: on the team's own page.
 */
import type { Team } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { ChevronRight, UsersRound } from "lucide-react";
import { List, ListRow } from "../internal/surface/List.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import type { EmptyStateAction } from "../empty-state/types.js";

/** Props for {@link TeamListPanel}. */
export interface TeamListPanelProps {
  readonly teams: readonly Team[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Fired when a person opens a team. */
  readonly onOpen: (team: Team) => void;
  /** Reads the list again after a failed read; the error offers Retry when given. */
  readonly onRetry?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * The page's create act, carried by the empty list (the same label and
   * handler as the page header's button). Absent when the caller may not
   * create one, or a create is already open.
   */
  readonly emptyAction?: EmptyStateAction;
}

/**
 * Lists an organization's teams.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * import type { Team } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
 *
 * function Teams({ onOpen }: { onOpen: (team: Team) => void }) {
 *   const list = useTeamList("acme");
 *   return <TeamListPanel {...list} onRetry={list.refetch} onOpen={onOpen} />;
 * }
 * ```
 */
export function TeamListPanel({
  teams,
  isLoading,
  error,
  onOpen,
  onRetry,
  emptyAction,
  className,
}: TeamListPanelProps) {
  if (isLoading) {
    return <SettingsSkeleton label="Loading teams" rows={3} className={className} />;
  }

  if (error) {
    return <ErrorMessage error={error} title="Couldn't load the teams." retry={onRetry} className={className} />;
  }

  if (teams.length === 0) {
    return (
      <EmptyState
        variant="first-use"
        title="No teams yet"
        description="A team is a group of people you share agents, vaults and other resources with at once."
        action={emptyAction}        className={className}
      />
    );
  }

  return (
    <List aria-label="Teams" className={className}>
      {teams.map((team) => {
        const id = team.metadata?.id ?? "";
        const name = team.metadata?.name || id;
        const description = team.spec?.description ?? "";
        return (
          <ListRow
            key={id}
            onClick={() => onOpen(team)}
            leading={<UsersRound className="stg:h-3.5 stg:w-3.5 stg:shrink-0 stg:text-muted-foreground" aria-hidden="true" />}
            name={name}
            description={description || undefined}
            trailing={<ChevronRight className="stg:h-3.5 stg:w-3.5 stg:shrink-0 stg:text-muted-foreground" aria-hidden="true" />}
          />
        );
      })}
    </List>
  );
}
