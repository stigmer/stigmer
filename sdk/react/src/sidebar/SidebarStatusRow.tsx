"use client";

// A row at the sidebar's foot that says how something on this computer
// stands: the desktop app's agents (ready, working, stopped, couldn't
// start). A dot in the status hues the status pill uses (grey before
// anything runs, green while it runs, red when it stopped), the state in a
// few words, the reason under it when there is one, and the one act that
// helps. The host passes the words; the row only draws them.

import { cn } from "@stigmer/design-tokens";
import { Button } from "../button/Button.js";

/** How the row's subject stands: before anything runs, running, or stopped. */
export type SidebarStatusTone = "quiet" | "live" | "alert";

/** Props for {@link SidebarStatusRow}. */
export interface SidebarStatusRowProps {
  /** How it stands; picks the dot's hue. */
  readonly tone: SidebarStatusTone;
  /** The state in a few words ("Agents ready"). */
  readonly label: string;
  /** Why, when it stopped or couldn't start. */
  readonly detail?: string;
  /** The one act that helps ("Restart", "Try again"). */
  readonly action?: { readonly label: string; readonly onClick: () => void; readonly busy?: boolean };
  readonly className?: string;
}

const DOT: Record<SidebarStatusTone, string> = {
  quiet: "stg:bg-status-pending stg:opacity-60",
  live: "stg:bg-status-ready",
  alert: "stg:bg-status-failed",
};

/**
 * The sidebar foot's status row: a dot, the state, its reason and its act.
 *
 * @example
 * ```tsx
 * function Agents({ restart }: { restart: () => void }) {
 *   return <SidebarStatusRow tone="alert" label="Agents stopped" action={{ label: "Restart", onClick: restart }} />;
 * }
 * ```
 */
export function SidebarStatusRow({ tone, label, detail, action, className }: SidebarStatusRowProps) {
  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-1 stg:px-2 stg:pb-2", className)}>
      <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
        <span aria-hidden="true" className={cn("stg:size-1.5 stg:shrink-0 stg:rounded-full", DOT[tone])} />
        <p role="status" className="stg:m-0 stg:min-w-0 stg:flex-1 stg:text-xs stg:text-sidebar-muted-foreground">
          {label}
        </p>
        {action !== undefined && (
          <Button variant="outline" size="xs" onClick={action.onClick} disabled={action.busy === true} aria-busy={action.busy === true}>
            {action.label}
          </Button>
        )}
      </div>
      {detail !== undefined && (
        <p className="stg:m-0 stg:line-clamp-3 stg:break-words stg:text-xs stg:text-sidebar-muted-foreground">{detail}</p>
      )}
    </div>
  );
}
