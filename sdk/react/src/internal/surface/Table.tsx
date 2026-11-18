"use client";

// The console's one table: a semantic <table> in a card, its header cells
// 12/16 medium in the muted tone, its rows 14/20 on the list row's padding
// (10px top and bottom, 14px at the sides) with hairlines between them.
// The workbench's ResourceTable draws its cells with the same classes, so a
// table on settings and a Library table are the same object. A table that
// is narrower than 640px of its own width (a phone, a docked panel) draws
// each row as a list row instead: the first column its name, the rest a
// line under it, the row's act at its end. Measured on the table's own
// width, not the window's, as the workbench's narrow view is.
// Internal: the kit's own components use it; no host imports it yet.

import { Fragment, useRef, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { anchorLink, type RenderLink } from "../../button/LinkButton.js";
import { useIsNarrowerThan } from "../useIsNarrowerThan.js";
import { cardClasses } from "./Card.js";
import { List, ListRow } from "./List.js";

/** Below this width of its own, a table draws its rows as list rows. */
export const TABLE_NARROW_BELOW_PX = 640;

/** A header cell's classes: 12/16 medium, muted, on the row's padding. */
export const TABLE_HEADER_CELL_CLASSES =
  "stg:px-3.5 stg:py-2.5 stg:text-left stg:text-xs stg:font-medium stg:text-muted-foreground";

/** The header row's classes: a hairline under it. */
export const TABLE_HEADER_ROW_CLASSES = "stg:border-b stg:border-border";

/** A body row's classes: a faint hairline under it. */
export const TABLE_ROW_CLASSES = "stg:border-b stg:border-border-muted stg:transition-colors";

/** A body cell's classes: 14/20 on the row's padding. */
export const TABLE_CELL_CLASSES = "stg:px-3.5 stg:py-2.5 stg:text-sm stg:text-foreground";

/** A row that opens something: the hover both tables share. */
export const TABLE_ROW_HOVER_CLASSES = "stg:hover:bg-accent-hover";

/** One column of a {@link Table}. */
export interface TableColumn<Row> {
  /** Stable id, used as the cell's key. */
  readonly id: string;
  /** The header cell's words. */
  readonly header: string;
  /** The cell for a row. */
  readonly cell: (row: Row) => ReactNode;
  /** `end` for figures, which line up at the right. @default "start" */
  readonly align?: "start" | "end";
  /**
   * Where the column goes when the table draws as rows: on the line under
   * the name (`line`, the default), beside the name (`adornment`, for a
   * tag), at the row's end (`trailing`, for a pill), or not at all
   * (`hidden`). The first column is always the row's name.
   */
  readonly narrow?: "line" | "adornment" | "trailing" | "hidden";
  /**
   * A quiet line under the cell (an address under a name, an id under a
   * model), outside the row's act, so the act's name is the cell alone.
   * Used on the first column; when the table draws as rows it leads the
   * line under the name.
   */
  readonly detail?: (row: Row) => ReactNode;
}

/** Props for {@link Table}. */
export interface TableProps<Row> {
  /** The columns, in order; the first is each row's name. */
  readonly columns: readonly TableColumn<Row>[];
  /** The rows. */
  readonly rows: readonly Row[];
  /** A stable key for a row. */
  readonly rowKey: (row: Row) => string;
  /** The table's accessible name, when no heading names it. */
  readonly "aria-label"?: string;
  /** The id of the heading that names the table. */
  readonly "aria-labelledby"?: string;
  /** The row opens something: its name is a link to here, stretched over the row. */
  readonly rowHref?: (row: Row) => string;
  /** Draws the name's link; a plain `<a>` when omitted. */
  readonly renderLink?: RenderLink;
  /** The row does something: its name is a button, stretched over the row. */
  readonly onRowClick?: (row: Row) => void;
  /** The row's own acts (an icon button, a menu), in a last column. */
  readonly rowAction?: (row: Row) => ReactNode;
  /** No card around the table, for a table already inside one. */
  readonly bare?: boolean;
  readonly className?: string;
}

/** Whether a column's figures line up at the right. */
function alignsEnd<Row>(column: TableColumn<Row>): boolean {
  return column.align === "end";
}

const STRETCH =
  "stg:text-left stg:text-foreground stg:no-underline stg:outline-none stg:after:absolute stg:after:inset-0 stg:after:content-[''] stg:focus-visible:after:ring-2 stg:focus-visible:after:ring-inset stg:focus-visible:after:ring-ring";

/** A table in a card, drawn as list rows when it is narrower than 640px. */
export function Table<Row>(props: TableProps<Row>) {
  const ref = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrowerThan(ref, TABLE_NARROW_BELOW_PX);
  return (
    <div ref={ref} className={cn("stg:min-w-0", props.className)}>
      {narrow ? <TableAsRows {...props} /> : <WideTable {...props} />}
    </div>
  );
}

function WideTable<Row>({
  columns,
  rows,
  rowKey,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  rowHref,
  renderLink = anchorLink,
  onRowClick,
  rowAction,
  bare,
}: TableProps<Row>) {
  const opens = rowHref != null || onRowClick != null;
  return (
    <div className={cn("stg:overflow-x-auto", !bare && cardClasses({ flush: true }))}>
      <table
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        className="stg:w-full stg:border-collapse stg:text-sm stg:tabular-nums"
      >
        <thead>
          <tr className={TABLE_HEADER_ROW_CLASSES}>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(TABLE_HEADER_CELL_CLASSES, alignsEnd(column) && "stg:text-right")}
              >
                {column.header}
              </th>
            ))}
            {rowAction && (
              <th scope="col" className="stg:w-10 stg:px-3.5 stg:py-2.5">
                <span className="stg:sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(
                TABLE_ROW_CLASSES,
                "stg:last:border-b-0",
                // The row's link or button stretches over it from the first cell.
                opens && cn("stg:relative", TABLE_ROW_HOVER_CLASSES),
              )}
            >
              {columns.map((column, index) => {
                const content = column.cell(row);
                const name =
                  index !== 0 || !opens
                    ? content
                    : rowHref != null
                      ? renderLink({ href: rowHref(row), className: cn(STRETCH, "stg:font-medium"), children: content })
                      : (
                          <button type="button" onClick={() => onRowClick?.(row)} className={cn(STRETCH, "stg:font-medium")}>
                            {content}
                          </button>
                        );
                return (
                  <td
                    key={column.id}
                    className={cn(
                      TABLE_CELL_CLASSES,
                      alignsEnd(column) && "stg:text-right",
                      index === 0 && "stg:font-medium",
                    )}
                  >
                    {name}
                    {column.detail && <CellDetail>{column.detail(row)}</CellDetail>}
                  </td>
                );
              })}
              {rowAction && (
                <td className="stg:relative stg:z-10 stg:w-10 stg:px-3.5 stg:py-2.5 stg:text-right">{rowAction(row)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableAsRows<Row>({
  columns,
  rows,
  rowKey,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  rowHref,
  renderLink,
  onRowClick,
  rowAction,
  bare,
}: TableProps<Row>) {
  const [first, ...rest] = columns;
  if (first === undefined) return null;
  const placed = (where: NonNullable<TableColumn<Row>["narrow"]>) =>
    rest.filter((column) => (column.narrow ?? "line") === where);
  const line = placed("line");
  const adornment = placed("adornment");
  const trailing = placed("trailing");
  return (
    <List bare={bare} aria-label={ariaLabel} aria-labelledby={ariaLabelledby}>
      {rows.map((row) => {
        const parts = [
          ...(first.detail ? [{ id: `${first.id}-detail`, node: first.detail(row) }] : []),
          ...line.map((column) => ({ id: column.id, node: column.cell(row) })),
        ]
          .filter((part) => part.node !== null && part.node !== undefined && part.node !== "" && part.node !== false);
        const description =
          parts.length === 0
            ? undefined
            : parts.map((part, index) => (
                <Fragment key={part.id}>
                  {index > 0 && " · "}
                  {part.node}
                </Fragment>
              ));
        const ends = trailing.map((column) => <Fragment key={column.id}>{column.cell(row)}</Fragment>);
        const action = rowAction?.(row);
        return (
          <ListRow
            key={rowKey(row)}
            name={first.cell(row)}
            description={description}
            nameAdornment={
              adornment.length > 0
                ? adornment.map((column) => <Fragment key={column.id}>{column.cell(row)}</Fragment>)
                : undefined
            }
            trailing={
              ends.length > 0 || action != null ? (
                <>
                  {ends}
                  {action}
                </>
              ) : undefined
            }
            href={rowHref?.(row)}
            renderLink={renderLink}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          />
        );
      })}
    </List>
  );
}

/** The quiet line under a cell: 12/16 in the muted tone, never the row's act. */
function CellDetail({ children }: { readonly children: ReactNode }) {
  if (children === null || children === undefined || children === "" || children === false) return null;
  return <span className="stg:block stg:truncate stg:text-xs stg:font-normal stg:text-muted-foreground">{children}</span>;
}
