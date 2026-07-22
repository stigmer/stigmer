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
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <SyncOutcomeBadge outcome={status.lastSyncOutcome} />
          {syncedAt && (
            <span className="text-xs text-muted-foreground">last synced {syncedAt}</span>
          )}
        </div>
        {status.collections.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No collections have been synced yet.
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Collection</th>
                <th scope="col" className="px-3 py-2 font-medium">State</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Records</th>
              </tr>
            </thead>
            <tbody>
              {status.collections.map((coll) => (
                <tr key={coll.name} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 font-mono text-foreground">{coll.name}</td>
                  <td className="px-3 py-2">
                    <MaterializationBadge state={coll.state} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
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
