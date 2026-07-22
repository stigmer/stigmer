"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { getUserMessage, isPermissionDenied } from "@stigmer/sdk";
import {
  DatastoreVerb,
  FieldType,
  type CollectionDeclaration,
  type DatastoreSpec,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import type {
  CollectionDescription,
  RecordEnvelope,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { ResourceTable } from "../resource-workbench/components/ResourceTable.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { toast } from "../feedback/toast.js";
import { FIELD_INPUT_CLASSES } from "./FieldValueControl.js";
import { RecordFilterBuilder } from "./RecordFilterBuilder.js";
import { RecordFormPanel } from "./RecordFormPanel.js";
import { buildRecordFilter, type RecordConditionDraft } from "./recordFilter.js";
import {
  formatFieldValue,
  formatSystemTimestamp,
  isSortableField,
} from "./recordValues.js";
import { useDatastoreDescription } from "./useDatastoreDescription.js";
import { useRecordCollection, type RecordColumnDef } from "./useRecordCollection.js";
import { useDeleteRecord } from "./useDeleteRecord.js";
import type { SortValue } from "../resource-workbench/types.js";

/** Props for {@link CollectionRecordsBrowser}. */
export interface CollectionRecordsBrowserProps {
  /** Organization slug. */
  readonly org: string;
  /** Datastore slug. */
  readonly datastoreSlug: string;
  /** The datastore spec — collections and fields drive the grid columns. */
  readonly spec: DatastoreSpec;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

const PAGE_SIZE = 25;

/**
 * The records browser (DD-008 SD-3): collection selector, partition
 * picker, schema-aware filter builder, typed-cell grid, RPC-paged
 * navigation, and verb-gated write affordances — the console surface
 * that absorbs the Supabase-dashboard capability the datastore
 * primitive retires.
 *
 * Authorization is rendered as the two layers it is:
 * - Write affordances gate on `describeDatastore`'s per-collection
 *   effective verbs (projections, never authority — the server's
 *   record layer stays the enforcer).
 * - **The denied state is a first-class render**, driven primarily by
 *   empty access lists (deny-by-default renders as empty access, never
 *   an error) with a caught reach-level `PERMISSION_DENIED` as the
 *   defensive branch. Both show the relayable message plus operator
 *   guidance — never a silently empty grid.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 */
export function CollectionRecordsBrowser({
  org,
  datastoreSlug,
  spec,
  className,
}: CollectionRecordsBrowserProps) {
  const collections = spec.collections;
  const [collectionName, setCollectionName] = useState(collections[0]?.name ?? "");
  const collection = collections.find((c) => c.name === collectionName);

  const description = useDatastoreDescription(org, datastoreSlug);
  const [partition, setPartition] = useState("default");

  // Filter, sort, and page state — per collection selection.
  const [conditions, setConditions] = useState<readonly RecordConditionDraft[]>([]);
  const [sort, setSort] = useState<SortValue | null>(null);
  const [page, setPage] = useState(1);

  const selectCollection = useCallback((name: string) => {
    setCollectionName(name);
    setConditions([]);
    setSort(null);
    setPage(1);
  }, []);

  const selectPartition = useCallback((name: string) => {
    setPartition(name);
    setPage(1);
  }, []);

  const applyConditions = useCallback((next: readonly RecordConditionDraft[]) => {
    setConditions(next);
    setPage(1);
  }, []);

  if (collections.length === 0) {
    return (
      <p className={cn("px-3 py-6 text-center text-sm text-muted-foreground", className)}>
        This datastore declares no collections.
      </p>
    );
  }
  if (!collection) return null;

  const collectionAccess = description.description?.collections.find(
    (c) => c.name === collection.name,
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          Collection
          <select
            className={cn(FIELD_INPUT_CLASSES, "w-auto")}
            value={collectionName}
            onChange={(e) => selectCollection(e.target.value)}
          >
            {collections.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          Partition
          <select
            className={cn(FIELD_INPUT_CLASSES, "w-auto")}
            value={partition}
            onChange={(e) => selectPartition(e.target.value)}
          >
            {description.partitions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      <RecordsPane
        org={org}
        datastoreSlug={datastoreSlug}
        collection={collection}
        partition={partition}
        conditions={conditions}
        onConditionsChange={applyConditions}
        sort={sort}
        onSortChange={setSort}
        page={page}
        onPageChange={setPage}
        access={collectionAccess}
        describeError={description.error}
        describeLoaded={description.description !== null}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The per-collection pane: denied panel or grid
// ---------------------------------------------------------------------------

function RecordsPane({
  org,
  datastoreSlug,
  collection,
  partition,
  conditions,
  onConditionsChange,
  sort,
  onSortChange,
  page,
  onPageChange,
  access,
  describeError,
  describeLoaded,
}: {
  readonly org: string;
  readonly datastoreSlug: string;
  readonly collection: CollectionDeclaration;
  readonly partition: string;
  readonly conditions: readonly RecordConditionDraft[];
  readonly onConditionsChange: (c: readonly RecordConditionDraft[]) => void;
  readonly sort: SortValue | null;
  readonly onSortChange: (s: SortValue | null) => void;
  readonly page: number;
  readonly onPageChange: (p: number) => void;
  readonly access: CollectionDescription | undefined;
  readonly describeError: Error | null;
  readonly describeLoaded: boolean;
}) {
  const verbs = useMemo(() => {
    const set = new Set<DatastoreVerb>();
    for (const grant of access?.access ?? []) set.add(grant.verb);
    return set;
  }, [access]);
  const canRead = verbs.has(DatastoreVerb.read);
  const canInsert = verbs.has(DatastoreVerb.insert);
  const canUpdate = verbs.has(DatastoreVerb.update);
  const canDelete = verbs.has(DatastoreVerb.delete);

  const scope = { org, datastore: datastoreSlug, collection: collection.name, partition };

  const filter = useMemo(() => buildRecordFilter(conditions), [conditions]);
  const columns = useMemo(() => buildRecordColumns(collection), [collection]);

  // Fetch only once read access is confirmed — the denied panel is the
  // primary render for deny-by-default, not a failed query.
  const records = useRecordCollection({
    org: describeLoaded && canRead ? org : null,
    datastore: datastoreSlug,
    collection: collection.name,
    partition,
    filter,
    page,
    pageSize: PAGE_SIZE,
    sort,
    onSortChange,
    columns,
  });

  // Row actions and write panel state.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecordEnvelope | null>(null);
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const deleteRecord = useDeleteRecord();

  const openInsert = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((record: RecordEnvelope) => {
    setEditing(record);
    setFormOpen(true);
  }, []);

  // Deps narrowed to the specific stable callbacks used (DD-010).
  const deleteRecordFn = deleteRecord.deleteRecord;
  const refetchRecords = records.refetch;
  const collectionName = collection.name;
  const handleDelete = useCallback(
    async (record: RecordEnvelope) => {
      const ok = await confirm({
        title: "Delete record?",
        description: `Record ${record.id} will be permanently deleted.`,
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!ok) return;
      try {
        await deleteRecordFn({
          org,
          datastore: datastoreSlug,
          collection: collectionName,
          partition,
          id: record.id,
        });
        toast.success("Record deleted");
        refetchRecords();
      } catch (err) {
        toast.error(getUserMessage(err));
      }
    },
    [confirm, deleteRecordFn, refetchRecords, org, datastoreSlug, collectionName, partition],
  );

  // --- Denied states (DD-008 SD-3): first-class renders ---------------------
  if (describeError && isPermissionDenied(describeError)) {
    return <DeniedPanel message={getUserMessage(describeError)} />;
  }
  if (describeLoaded && !canRead) {
    return (
      <DeniedPanel
        message={`You do not have record access to “${collection.name}”.`}
      />
    );
  }
  if (records.error && isPermissionDenied(records.error)) {
    return <DeniedPanel message={getUserMessage(records.error)} />;
  }

  const totalPages = Math.max(records.totalPages, 1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <RecordFilterBuilder
          collection={collection}
          conditions={conditions}
          onChange={onConditionsChange}
          className="min-w-0 flex-1"
        />
        {canInsert && (
          <button
            type="button"
            onClick={openInsert}
            className={cn(
              "shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground",
              "hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Insert record
          </button>
        )}
      </div>

      {records.error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-card px-3 py-2 text-sm text-destructive"
        >
          {getUserMessage(records.error)}
        </div>
      ) : records.isLoading ? (
        <div className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Loading records…
        </div>
      ) : records.records.length === 0 ? (
        <div className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {conditions.length > 0
            ? "No records match the current filters."
            : `No records in “${collection.name}” yet.`}
        </div>
      ) : (
        records.table && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <ResourceTable
              table={records.table}
              aria-label={`Records in ${collection.name}`}
              renderRowAction={
                canUpdate || canDelete
                  ? (record) => (
                      <RowActions
                        record={record}
                        canUpdate={canUpdate}
                        canDelete={canDelete}
                        onEdit={openEdit}
                        onDelete={handleDelete}
                      />
                    )
                  : undefined
              }
            />
          </div>
        )
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {records.total} record{records.total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className={paginationButtonClass}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className={paginationButtonClass}
          >
            Next
          </button>
        </div>
      </div>

      <RecordFormPanel
        open={formOpen}
        onOpenChange={setFormOpen}
        scope={scope}
        collection={collection}
        record={editing}
        onSaved={() => records.refetch()}
      />
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </div>
  );
}

const paginationButtonClass = cn(
  "rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground",
  "hover:bg-accent hover:text-accent-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
);

// ---------------------------------------------------------------------------
// Denied panel — an explanation, never an empty grid
// ---------------------------------------------------------------------------

function DeniedPanel({ message }: { readonly message: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted px-4 py-8 text-center"
    >
      <p className="text-sm font-medium text-foreground">{message}</p>
      <p className="max-w-md text-xs text-muted-foreground">
        Record access is granted by the datastore's authorization block. To
        gain access, add a role binding for your principal or set a{" "}
        <code className="font-mono">default_role</code> in the datastore YAML,
        with the verbs you need granted on this collection.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns: typed cells from FieldDeclaration + system columns
// ---------------------------------------------------------------------------

/**
 * Grid columns for a collection: declared fields with typed cells, then
 * `created_at` (visible by default). The remaining system columns
 * (`id`, `updated_at`, `created_by`) stay out of the default grid —
 * they are shown in the record form's read-only summary; a column
 * toggle is recorded growth.
 */
function buildRecordColumns(collection: CollectionDeclaration): RecordColumnDef[] {
  const fieldColumns: RecordColumnDef[] = collection.fields.map((field) => ({
    id: field.name,
    header: field.name,
    sortable: isSortableField(field),
    cell: (record) => (
      <TypedCell
        value={formatFieldValue(field.type, record.fields?.[field.name])}
        numeric={field.type === FieldType.integer || field.type === FieldType.number}
        mono={field.type === FieldType.json}
      />
    ),
  }));

  return [
    ...fieldColumns,
    {
      id: "created_at",
      header: "created_at",
      sortable: true,
      cell: (record) => (
        <TypedCell
          value={
            record.createdAt
              ? formatSystemTimestamp(timestampDate(record.createdAt).toISOString())
              : ""
          }
          mono
        />
      ),
    },
  ];
}

function TypedCell({
  value,
  numeric,
  mono,
}: {
  readonly value: string;
  readonly numeric?: boolean;
  readonly mono?: boolean;
}) {
  const truncated = value.length > 80 ? `${value.slice(0, 79)}…` : value;
  return (
    <span
      title={value.length > 80 ? value : undefined}
      className={cn(
        "block max-w-xs truncate",
        numeric && "text-right tabular-nums",
        mono && "font-mono",
      )}
    >
      {truncated}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

function RowActions({
  record,
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
}: {
  readonly record: RecordEnvelope;
  readonly canUpdate: boolean;
  readonly canDelete: boolean;
  readonly onEdit: (record: RecordEnvelope) => void;
  readonly onDelete: (record: RecordEnvelope) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {canUpdate && (
        <button
          type="button"
          onClick={() => onEdit(record)}
          aria-label={`Edit record ${record.id}`}
          className={rowActionClass}
        >
          Edit
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(record)}
          aria-label={`Delete record ${record.id}`}
          className={cn(rowActionClass, "text-destructive hover:text-destructive")}
        >
          Delete
        </button>
      )}
    </div>
  );
}

const rowActionClass = cn(
  "rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground",
  "hover:bg-accent hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
);
