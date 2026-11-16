"use client";

// What every Library list section shares: the page header (the kind's name,
// what it is for, its acts) above the section's list; the row a kind you open
// draws (its icon, name, tags, one line and when it last changed); the row's
// acts, each offered only when the server allows it (Copy ID always, Delete
// only on the server's yes for that row); and the three columns a kind listed
// through search shows in a table. Each section is then its own kind's words
// and acts, not a copy of this.

import { useCallback, useReducer, type ReactNode } from "react";
import { Copy, Trash2 } from "lucide-react";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { ResourceActionBar } from "../resource-detail/ResourceActionBar.js";
import type { DetailAction } from "../resource-detail/types.js";
import type { PermissionCheckResource } from "../grant/useCheckPermission.js";
import { Tag } from "../internal/surface/Tag.js";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { PageHeader } from "../page/PageHeader.js";
import { OrgSlugText } from "../organization/OrgSlugText.js";
import { toast } from "../feedback/toast.js";
import type { WorkbenchColumnDef } from "../resource-workbench/types.js";

/** Props for {@link LibrarySectionFrame}. */
export interface LibrarySectionFrameProps {
  /** The kind's name, the page's heading. */
  readonly title: string;
  /** One line on what the kind is for. */
  readonly description?: ReactNode;
  /** The page's acts, at the right of the title. */
  readonly actions?: ReactNode;
  /** The section's list and its dialogs. */
  readonly children: ReactNode;
}

/** A Library list page: its header, then its list. */
export function LibrarySectionFrame({ title, description, actions, children }: LibrarySectionFrameProps) {
  return (
    <>
      <PageHeader className="stg:mb-6" headingLevel={1} title={title} description={description} actions={actions} />
      {children}
    </>
  );
}

/** Props for {@link LibraryRow}. */
export interface LibraryRowProps {
  /** The kind's icon, drawn in a 32px square before the name. */
  readonly icon: ReactNode;
  /** What the thing is called. */
  readonly name: string;
  /** Tags beside the name: who can see it when that is not the whole organization, its network. */
  readonly tags?: readonly string[];
  /** One line on what it is. */
  readonly description?: string;
  /** When it last changed, drawn at the row's end ("2h", "Jul 12"). */
  readonly changedAt?: Timestamp;
}

/** One row of a Library list you open: its icon, name and tags, one line under them, and when it last changed. */
export function LibraryRow({ icon, name, tags = [], description, changedAt }: LibraryRowProps) {
  return (
    <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-3">
      <span
        aria-hidden="true"
        className="stg:grid stg:size-8 stg:shrink-0 stg:place-items-center stg:rounded-lg stg:border stg:border-border stg:bg-card stg:text-muted-foreground stg:[&_svg]:size-4"
      >
        {icon}
      </span>
      <div className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-col">
        <span className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
          <span className="stg:truncate stg:font-medium stg:text-foreground">{name}</span>
          {tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </span>
        {description && <span className="stg:truncate stg:text-xs stg:text-muted-foreground">{description}</span>}
      </div>
      {changedAt && (
        <span className="stg:shrink-0 stg:text-xs stg:tabular-nums stg:text-muted-foreground">
          {formatRelativeTime(timestampDate(changedAt))}
        </span>
      )}
    </div>
  );
}

/** Props for {@link LibraryRowActions}. */
export interface LibraryRowActionsProps {
  /** The row's resource, which Delete's permission is asked on. */
  readonly resource: PermissionCheckResource;
  /** The row's name, for the menu's accessible name ("Actions for linear"). */
  readonly name: string;
  /** Copies the row's reference. */
  readonly onCopyId: () => void;
  /** Deletes the row after its confirmation; offered only on the server's yes for `can_delete`. */
  readonly onDelete?: () => void;
  /** The destructive act's word. @default "Delete" */
  readonly deleteLabel?: string;
}

/**
 * A Library row's acts behind one icon button: Copy ID always, and Delete
 * only when the server answered yes for this row (asked once per row, fail
 * closed), so a person is never offered an act the server refuses.
 */
export function LibraryRowActions({ resource, name, onCopyId, onDelete, deleteLabel = "Delete" }: LibraryRowActionsProps) {
  const actions: DetailAction[] = [
    { id: "copy-id", label: "Copy ID", icon: <Copy className="stg:size-4" />, group: "row", onAction: onCopyId },
  ];
  if (onDelete) {
    actions.push({
      id: "delete",
      label: deleteLabel,
      icon: <Trash2 className="stg:size-4" />,
      variant: "destructive",
      group: "danger",
      requires: "can_delete",
      onAction: onDelete,
    });
  }
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <ResourceActionBar resource={resource} menuLabel={`Actions for ${name}`} actions={actions} />
    </div>
  );
}

/** Props for {@link ColumnsAsRow}. */
export interface ColumnsAsRowProps<TData> {
  /** The table's columns: the first is the row's name; the rest read as one line under it. */
  readonly columns: readonly WorkbenchColumnDef<TData>[];
  /** The row's item. */
  readonly item: TData;
  /** Columns drawn beside the name rather than under it (a state pill). */
  readonly besideName?: readonly string[];
  /** The kind's icon, drawn in a 32px square before the name. */
  readonly icon: ReactNode;
}

/**
 * A table's row read as a list row, for a table that compares columns on a
 * phone: its first column as the name, chosen columns beside it, the rest
 * as one line under it, dots between.
 */
export function ColumnsAsRow<TData>({ columns, item, besideName = [], icon }: ColumnsAsRowProps<TData>) {
  const [first, ...rest] = columns;
  const beside = rest.filter((column) => besideName.includes(column.id));
  const under = rest.filter((column) => !besideName.includes(column.id));
  return (
    <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-3">
      <span
        aria-hidden="true"
        className="stg:grid stg:size-8 stg:shrink-0 stg:place-items-center stg:rounded-lg stg:border stg:border-border stg:bg-card stg:text-muted-foreground stg:[&_svg]:size-4"
      >
        {icon}
      </span>
      <div className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-col">
        <span className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
          {first && <span className="stg:min-w-0 stg:truncate">{first.cell(item)}</span>}
          {beside.map((column) => (
            <span key={column.id} className="stg:shrink-0">
              {column.cell(item)}
            </span>
          ))}
        </span>
        {under.length > 0 && (
          <span className="stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-x-1.5 stg:text-xs stg:text-muted-foreground stg:[&_*]:text-xs">
            {under.map((column, index) => (
              <span key={column.id} className="stg:inline-flex stg:items-center stg:gap-1.5">
                {index > 0 && <span aria-hidden="true">·</span>}
                {column.cell(item)}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** Who can see a row, as its tag: none for the whole organization (the usual case), "Private" when only its owner can. */
export function visibilityTag(visibility: ApiResourceVisibility | undefined): readonly string[] {
  return visibility === ApiResourceVisibility.visibility_private ? ["Private"] : [];
}

/**
 * A counter a section bumps after an out-of-band change (Apply YAML, a
 * delete, an upload) to read its list again in place: no remount flash,
 * paging and sort kept.
 */
export function useRefetchToken(): readonly [number, () => void] {
  const [token, bump] = useReducer((n: number) => n + 1, 0);
  const refetch = useCallback(() => bump(), []);
  return [token, refetch];
}

/** Copies a row's `<org slug>/<slug>` reference, the one a person types elsewhere, and says so. */
export function copyReference(orgSlug: string, slug: string, noun: string): void {
  void navigator.clipboard.writeText(`${orgSlug}/${slug}`);
  toast.success(`Copied ${noun} ID`);
}

/** The columns of a kind listed through search: its name, its organization (by slug), and its description. */
export const SEARCH_RESULT_COLUMNS: WorkbenchColumnDef<SearchResult>[] = [
  {
    id: "name",
    header: "Name",
    cell: (item) => <span className="stg:font-medium stg:text-foreground">{item.name || item.slug}</span>,
    sortable: true,
    flex: 2,
  },
  {
    id: "org",
    header: "Organization",
    cell: (item) => <OrgSlugText orgId={item.org} className="stg:text-muted-foreground" />,
    flex: 1,
  },
  {
    id: "description",
    header: "Description",
    cell: (item) => <span className="stg:line-clamp-1 stg:text-muted-foreground">{item.description || "—"}</span>,
    flex: 3,
  },
];
