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
      <p className={cn("stg:px-3 stg:py-6 stg:text-center stg:text-sm stg:text-muted-foreground", className)}>
        This datastore declares no collections.
      </p>
    );
  }
  if (!collection) return null;

  const collectionAccess = description.description?.collections.find(
    (c) => c.name === collection.name,
  );

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-3", className)}>
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
        <label className="stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground">
          Collection
          <select
            className={cn(FIELD_INPUT_CLASSES, "stg:w-auto")}
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
        <label className="stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground">
          Partition
          <select
            className={cn(FIELD_INPUT_CLASSES, "stg:w-auto")}
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

  // The caller's column-level read access (empty means every field): a
  // field-restricted read grant returns only these fields, so the grid
  // and the filter builder narrow to them — no permanently-empty
  // columns, no filter the server would refuse (DD-008 invariant 2).
  const readableFields = useMemo(
    () => access?.access.find((a) => a.verb === DatastoreVerb.read)?.readableFields ?? [],
    [access],
  );

  const scope = { org, datastore: datastoreSlug, collection: collection.name, partition };

  const filter = useMemo(() => buildRecordFilter(conditions), [conditions]);
  const columns = useMemo(
    () => buildRecordColumns(collection, readableFields),
    [collection, readableFields],
  );

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
    <div className="stg:flex stg:flex-col stg:gap-3">
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
        <RecordFilterBuilder
          collection={collection}
          readableFields={readableFields}
          conditions={conditions}
          onChange={onConditionsChange}
          className="stg:min-w-0 stg:flex-1"
        />
        {canInsert && (
          <button
            type="button"
            onClick={openInsert}
            className={cn(
              "stg:shrink-0 stg:rounded-md stg:bg-primary stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-primary-foreground",
              "stg:hover:bg-primary-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            Insert record
          </button>
        )}
      </div>

      {records.error ? (
        <div
          role="alert"
          className="stg:rounded-md stg:border stg:border-destructive stg:bg-card stg:px-3 stg:py-2 stg:text-sm stg:text-destructive"
        >
          {getUserMessage(records.error)}
        </div>
      ) : records.isLoading ? (
        <div className="stg:rounded-lg stg:border stg:border-border stg:px-3 stg:py-6 stg:text-center stg:text-sm stg:text-muted-foreground">
          Loading records…
        </div>
      ) : records.records.length === 0 ? (
        <div className="stg:rounded-lg stg:border stg:border-border stg:px-3 stg:py-6 stg:text-center stg:text-sm stg:text-muted-foreground">
          {conditions.length > 0
            ? "No records match the current filters."
            : `No records in “${collection.name}” yet.`}
        </div>
      ) : (
        records.table && (
          <div className="stg:overflow-x-auto stg:rounded-lg stg:border stg:border-border">
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

      <div className="stg:flex stg:items-center stg:justify-between stg:text-xs stg:text-muted-foreground">
        <span>
          {records.total} record{records.total === 1 ? "" : "s"}
        </span>
        <div className="stg:flex stg:items-center stg:gap-2">
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
  "stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:text-foreground",
  "stg:hover:bg-accent stg:hover:text-accent-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

// ---------------------------------------------------------------------------
// Denied panel — an explanation, never an empty grid
// ---------------------------------------------------------------------------

function DeniedPanel({ message }: { readonly message: string }) {
  return (
    <div
      role="status"
      className="stg:flex stg:flex-col stg:items-center stg:gap-2 stg:rounded-lg stg:border stg:border-border stg:bg-muted stg:px-4 stg:py-8 stg:text-center"
    >
      <p className="stg:text-sm stg:font-medium stg:text-foreground">{message}</p>
      <p className="stg:max-w-md stg:text-xs stg:text-muted-foreground">
        Record access is granted by the datastore's authorization block. To
        gain access, add a role binding for your principal or set a{" "}
        <code className="stg:font-mono">default_role</code> in the datastore YAML,
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
 *
 * `readableFields` narrows the declared columns to the caller's
 * column-level read access (empty means every field): a hidden field's
 * cells would be permanently empty, which reads as missing data rather
 * than restricted access.
 */
function buildRecordColumns(
  collection: CollectionDeclaration,
  readableFields: readonly string[],
): RecordColumnDef[] {
  const readable = readableFields.length > 0 ? new Set(readableFields) : null;
  const declaredColumns =
    readable === null
      ? collection.fields
      : collection.fields.filter((field) => readable.has(field.name));
  const fieldColumns: RecordColumnDef[] = declaredColumns.map((field) => ({
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
        "stg:block stg:max-w-xs stg:truncate",
        numeric && "stg:text-right stg:tabular-nums",
        mono && "stg:font-mono",
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
    <div className="stg:flex stg:items-center stg:gap-1">
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
          className={cn(rowActionClass, "stg:text-destructive stg:hover:text-destructive")}
        >
          Delete
        </button>
      )}
    </div>
  );
}

const rowActionClass = cn(
  "stg:rounded-md stg:px-1.5 stg:py-0.5 stg:text-xs stg:font-medium stg:text-muted-foreground",
  "stg:hover:bg-accent stg:hover:text-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
);
