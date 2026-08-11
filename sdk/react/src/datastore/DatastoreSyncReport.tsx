"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  CollectionMaterializationState,
  DatastoreSyncOutcome,
  type DatastoreStatus,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/status_pb";
import { Section } from "../resource-detail/Section.js";
import { StatusBadge } from "../resource-workbench/components/StatusBadge.js";

/** Props for {@link DatastoreSyncReport}. */
export interface DatastoreSyncReportProps {
  /** The datastore status — the authoritative source for health (DD-008 SD-5). */
  readonly status: DatastoreStatus;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * The Overview health strip: projects `DatastoreStatus` — last apply
 * outcome, per-collection materialization state, and record counts —
 * so the operator can confirm an apply landed without leaving the
 * console (the cutover choreography's verification surface, DD-009).
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 */
export function DatastoreSyncReport({ status, className }: DatastoreSyncReportProps) {
  const syncedAt = status.lastSyncedAt
    ? timestampDate(status.lastSyncedAt).toLocaleString()
    : null;

  return (
    <Section title="Sync report" className={className}>
      <div className="stg:flex stg:flex-col">
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2 stg:border-b stg:border-border stg:px-3 stg:py-2">
          <SyncOutcomeBadge outcome={status.lastSyncOutcome} />
          {syncedAt && (
            <span className="stg:text-xs stg:text-muted-foreground">last synced {syncedAt}</span>
          )}
        </div>
        {status.collections.length === 0 ? (
          <p className="stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground">
            No collections have been synced yet.
          </p>
        ) : (
          <table className="stg:w-full stg:text-left stg:text-xs">
            <thead>
              <tr className="stg:border-b stg:border-border stg:text-muted-foreground">
                <th scope="col" className="stg:px-3 stg:py-2 stg:font-medium">Collection</th>
                <th scope="col" className="stg:px-3 stg:py-2 stg:font-medium">State</th>
                <th scope="col" className="stg:px-3 stg:py-2 stg:text-right stg:font-medium">Records</th>
              </tr>
            </thead>
            <tbody>
              {status.collections.map((coll) => (
                <tr key={coll.name} className="stg:border-b stg:border-border stg:last:border-b-0">
                  <td className="stg:px-3 stg:py-2 stg:font-mono stg:text-foreground">{coll.name}</td>
                  <td className="stg:px-3 stg:py-2">
                    <MaterializationBadge state={coll.state} />
                  </td>
                  <td className="stg:px-3 stg:py-2 stg:text-right stg:tabular-nums stg:text-foreground">
                    {String(coll.recordCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Section>
  );
}

function SyncOutcomeBadge({ outcome }: { readonly outcome: DatastoreSyncOutcome }) {
  switch (outcome) {
    case DatastoreSyncOutcome.synced:
      return <StatusBadge phase="ready" label="synced" />;
    case DatastoreSyncOutcome.rejected:
      return <StatusBadge phase="failed" label="rejected" />;
    default:
      return <StatusBadge phase="draft" label="never synced" />;
  }
}

function MaterializationBadge({ state }: { readonly state: CollectionMaterializationState }) {
  switch (state) {
    case CollectionMaterializationState.active:
      return <StatusBadge phase="ready" label="active" />;
    case CollectionMaterializationState.pending:
      return <StatusBadge phase="pending" label="pending" />;
    case CollectionMaterializationState.removed:
      // Removed from the spec; data retained until datastore delete.
      return (
        <StatusBadge
          phase="disabled"
          label="removed"
          tooltip="Removed from the spec — records retained until the datastore is deleted"
        />
      );
    default:
      return <StatusBadge phase="draft" label="unknown" />;
  }
}
