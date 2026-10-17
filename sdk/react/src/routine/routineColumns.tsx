"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { isDeletedReference } from "@stigmer/sdk";
import type { Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { StatusBadge } from "../resource-workbench/components/StatusBadge.js";
import type { WorkbenchColumnDef } from "../resource-workbench/types.js";
import { deriveRoutineState, formatNextFire } from "./routineState.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";

/** Options for {@link createRoutineColumns}. */
export interface RoutineColumnsOptions {
  /**
   * Clock provider for the "next fire" and "last run" columns.
   * Injectable for deterministic tests and Scenar fixtures.
   * @default () => new Date()
   */
  readonly now?: () => Date;
}

/**
 * Column set for a schedule workbench — shared by every console so the
 * list renders identically everywhere.
 *
 * The columns exist because schedules are listed via the direct query:
 * each row is a full `Schedule` proto, so the operational fields the
 * issue calls for (next fire, last run, enabled/paused state) render
 * straight from the row — no generic `SearchResult` limitations.
 *
 * Columns are not sortable: the direct query has one fixed server-side
 * order (newest first), and a sort affordance that silently does
 * nothing would lie.
 */
export function createRoutineColumns(
  options?: RoutineColumnsOptions,
): WorkbenchColumnDef<Routine>[] {
  const now = options?.now ?? (() => new Date());

  return [
    {
      id: "name",
      header: "Name",
      cell: (item) => (
        <span className="stg:font-medium stg:text-foreground">
          {item.metadata?.name || item.metadata?.slug}
        </span>
      ),
      flex: 2,
    },
    {
      id: "state",
      header: "State",
      cell: (item) => {
        const info = deriveRoutineState(item.spec, item.status);
        return <StatusBadge phase={info.phase} label={info.label} />;
      },
      flex: 1,
    },
    {
      id: "cron",
      header: "Cadence",
      cell: (item) => (
        <span className="stg:inline-flex stg:items-baseline stg:gap-1.5">
          <code className="stg:font-mono stg:text-xs stg:text-foreground">
            {item.spec?.cron || "—"}
          </code>
          <span className="stg:text-xs stg:text-muted-foreground">
            {item.spec?.timeZone}
          </span>
        </span>
      ),
      flex: 1.5,
    },
    {
      id: "next-fire",
      header: "Next fire",
      cell: (item) => {
        const info = deriveRoutineState(item.spec, item.status);
        const nextFireAt = item.status?.nextFireAt;
        return (
          <span className="stg:text-muted-foreground">
            {info.state === "active" && nextFireAt
              ? formatNextFire(timestampDate(nextFireAt), now())
              : "—"}
          </span>
        );
      },
      flex: 1,
    },
    {
      id: "last-run",
      header: "Last run",
      cell: (item) => (
        <span className="stg:text-muted-foreground">
          {item.status?.lastFireAt
            ? formatRelativeTime(timestampDate(item.status.lastFireAt), now())
            : "Never"}
        </span>
      ),
      flex: 1,
    },
    {
      id: "target",
      header: "Target agent",
      cell: (item) => {
        const target =
          item.spec?.target?.case === "agent" ? item.spec.target.value : undefined;
        return (
          <span className="stg:text-muted-foreground">
            {target?.agentRef && isDeletedReference(target.agentRef) ? (
              "deleted agent"
            ) : target?.agentRef ? (
              <QualifiedAgentRef org={target.agentRef.org} slug={target.agentRef.slug} />
            ) : (
              "—"
            )}
          </span>
        );
      },
      flex: 1.5,
    },
  ];
}

/**
 * `<org>/<slug>` for a target agent, its org read as a slug: a stored
 * reference names its org by id. A component so the column's plain render
 * callback can read the person's organizations.
 */
function QualifiedAgentRef({ org, slug }: { readonly org: string; readonly slug: string }) {
  const slugForOrg = useOrgSlugForId();
  return <>{`${slugForOrg(org)}/${slug}`}</>;
}
