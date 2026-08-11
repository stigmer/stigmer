"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { StatusBadge } from "../resource-workbench/components/StatusBadge.js";
import type { WorkbenchColumnDef } from "../resource-workbench/types.js";
import { deriveScheduleState, formatNextFire } from "./scheduleState.js";

/** Options for {@link createScheduleColumns}. */
export interface ScheduleColumnsOptions {
  /**
   * Clock provider for the "next fire" and "last run" columns.
   * Injectable for deterministic tests and Scenar fixtures.
   * @default () => new Date()
   */
  readonly now?: () => Date;
}

/**
 * Column set for a schedule workbench — shared by every console so the
 * list renders identically everywhere (DD-016).
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
export function createScheduleColumns(
  options?: ScheduleColumnsOptions,
): WorkbenchColumnDef<Schedule>[] {
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
        const info = deriveScheduleState(item.spec, item.status);
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
        const info = deriveScheduleState(item.spec, item.status);
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
            {target?.agentRef
              ? `${target.agentRef.org}/${target.agentRef.slug}`
              : "—"}
          </span>
        );
      },
      flex: 1.5,
    },
  ];
}
