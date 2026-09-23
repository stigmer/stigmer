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
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { ChevronRight, UsersRound } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { UNSTYLED_LIST } from "../internal/element-resets.js";

/** Props for {@link TeamListPanel}. */
export interface TeamListPanelProps {
  readonly teams: readonly Team[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Fired when a person opens a team. */
  readonly onOpen: (team: Team) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Lists an organization's teams.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * const list = useTeamList(orgSlug);
 * <TeamListPanel {...list} onOpen={(team) => setOpenTeam(team)} />
 * ```
 */
export function TeamListPanel({
  teams,
  isLoading,
  error,
  onOpen,
  className,
}: TeamListPanelProps) {
  if (isLoading) {
    return (
      <div className={cn("stg:space-y-2", className)} aria-busy="true" aria-label="Loading teams">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (teams.length === 0) {
    return (
      <p className={cn("stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs", className)}>
        No teams yet.
      </p>
    );
  }

  return (
    <ul className={cn(UNSTYLED_LIST, "stg:space-y-2", className)} aria-label="Teams">
      {teams.map((team) => {
        const id = team.metadata?.id ?? "";
        const name = team.metadata?.name || id;
        const description = team.spec?.description ?? "";
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onOpen(team)}
              className={cn(
                "stg:flex stg:w-full stg:items-center stg:gap-3 stg:rounded-lg stg:border stg:border-border-muted stg:px-3 stg:py-2.5 stg:text-left",
                "stg:hover:border-border stg:hover:bg-accent-hover stg:transition-colors",
                "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
              )}
            >
              <UsersRound className="stg:h-3.5 stg:w-3.5 stg:shrink-0 stg:text-muted-foreground" aria-hidden="true" />
              <span className="stg:min-w-0 stg:flex-1">
                <span className="stg:block stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
                  {name}
                </span>
                {description && (
                  <span className="stg:block stg:truncate stg:text-xs stg:text-muted-foreground">
                    {description}
                  </span>
                )}
              </span>
              <ChevronRight className="stg:h-3.5 stg:w-3.5 stg:shrink-0 stg:text-muted-foreground" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
