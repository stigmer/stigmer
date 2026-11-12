"use client";

// What a turn produced, right under its answer: the Files it returned under
// Made and the files it changed under Changed, each a card that opens it in
// place. Up to four read as cards; from five on, a list of the first five
// with the rest counted by type and "Show all" opening them in place, so
// twenty Files never become a wall. How the turn ended is the header's
// pill, and for a turn that didn't finish its notice above this block.

import { useState } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import type { TurnChange, TurnOutcomeView } from "./turn-outcome.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";

/** Props for {@link TurnOutcome}. */
export interface TurnOutcomeProps {
  readonly outcome: TurnOutcomeView;
  /** Opens a File the turn returned; omitted where nothing can open it. */
  readonly onOpenFile?: (file: StigmerFile) => void;
  /**
   * Opens a changed path; omitted where nothing can open it. Return false
   * for a change this viewer cannot show, and its card reads as a label.
   */
  readonly canOpenChange?: (change: TurnChange) => boolean;
  readonly onOpenChange?: (change: TurnChange) => void;
  readonly className?: string;
}

/** The most items drawn as cards; more become a list. */
const MAX_CARDS = 4;
/** How many items the list shows before "Show all". */
const LIST_HEAD = 5;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "" : path.slice(0, at);
}

function sizeWords(bytes: bigint | undefined): string {
  const n = Number(bytes ?? BigInt(0));
  if (n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A File's kind, in words a person uses: from its type, else its extension. */
export function fileKind(name: string, mimeType: string): string {
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (mimeType === "text/markdown" || extension === "md") return "Markdown";
  if (mimeType === "text/csv" || extension === "csv" || extension === "xlsx") return "Spreadsheet";
  if (mimeType === "application/pdf" || extension === "pdf") return "PDF";
  if (mimeType === "application/json" || extension === "json") return "JSON";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("text/") || extension === "txt") return "Text";
  return extension === "" ? "File" : extension.toUpperCase();
}

/** One item of Made or Changed: its words and how it opens. */
interface OutcomeItem {
  readonly key: string;
  readonly name: string;
  readonly detail: string;
  /** The kind counted when the item sits beyond the list's head. */
  readonly kind: string;
  readonly icon: "file" | "table" | "edit";
  readonly onOpen?: () => void;
}

/** A turn's outcome (module header). */
export function TurnOutcome({ outcome, onOpenFile, canOpenChange, onOpenChange, className }: TurnOutcomeProps) {
  if (outcome.phase === undefined) return null;
  const made: OutcomeItem[] = outcome.files.map((file) => {
    const name = file.spec?.filename ?? "";
    const kind = fileKind(name, file.spec?.mimeType ?? "");
    const size = sizeWords(file.status?.sizeBytes);
    return {
      key: file.metadata?.id ?? name,
      name,
      detail: size === "" ? kind : `${kind} · ${size}`,
      kind,
      icon: kind === "Spreadsheet" ? "table" : "file",
      ...(onOpenFile === undefined ? {} : { onOpen: () => onOpenFile(file) }),
    };
  });
  const changed: OutcomeItem[] = outcome.changes.map((change) => ({
    key: change.path,
    name: baseName(change.path),
    detail: folderOf(change.path),
    kind: fileKind(baseName(change.path), ""),
    icon: "edit",
    ...(onOpenChange !== undefined && (canOpenChange?.(change) ?? true) ? { onOpen: () => onOpenChange(change) } : {}),
  }));
  // How a turn that didn't finish ended is said once, by its notice above
  // and the session's pill; this block says only what the turn produced.
  if (made.length === 0 && changed.length === 0) return null;
  return (
    <section aria-label="What this turn produced" className={cn("stg:mx-4 stg:space-y-4", className)}>
      {made.length > 0 && <OutcomeGroup title="Made" items={made} />}
      {changed.length > 0 && <OutcomeGroup title="Changed" items={changed} />}
    </section>
  );
}

/** One titled group: cards up to {@link MAX_CARDS}, else a list with "Show all". */
function OutcomeGroup({ title, items }: { readonly title: string; readonly items: readonly OutcomeItem[] }) {
  const [all, setAll] = useState(false);
  const asList = items.length > MAX_CARDS;
  const shown = asList && !all ? items.slice(0, LIST_HEAD) : items;
  const rest = items.slice(LIST_HEAD);
  return (
    <div role="group" aria-label={title}>
      <p className="stg:mb-2 stg:text-xs stg:font-medium stg:text-muted-foreground">
        {title}
        {asList && ` · ${items.length} files`}
      </p>
      {asList ? (
        <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border stg:bg-card">
          <ul role="list" className={UNSTYLED_LIST}>
            {shown.map((item) => (
              <li key={item.key} className="stg:border-b stg:border-border-muted stg:last:border-b-0">
                <OutcomeEntry item={item} layout="row" />
              </li>
            ))}
          </ul>
          {rest.length > 0 && !all && (
            <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-2 stg:border-t stg:border-border-muted stg:bg-muted-faint stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground">
              <span>
                {rest.length} more: {countByKind(rest)}
              </span>
              <button
                type="button"
                onClick={() => setAll(true)}
                className="stg:rounded-md stg:border stg:border-border stg:bg-card stg:px-2 stg:py-1 stg:font-medium stg:text-foreground stg:hover:bg-muted"
              >
                Show all {items.length}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="stg:grid stg:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] stg:gap-2">
          {items.map((item) => (
            <OutcomeEntry key={item.key} item={item} layout="card" />
          ))}
        </div>
      )}
    </div>
  );
}

/** "12 Markdown, 3 PDF": the items counted by kind, the largest first. */
function countByKind(items: readonly OutcomeItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${count} ${kind}`)
    .join(", ");
}

/** One File or change: a card, or a list row; a button when it opens. */
function OutcomeEntry({ item, layout }: { readonly item: OutcomeItem; readonly layout: "card" | "row" }) {
  const inner = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "stg:flex stg:shrink-0 stg:items-center stg:justify-center stg:text-muted-foreground",
          layout === "card" ? "stg:h-8 stg:w-8 stg:rounded-md stg:bg-muted" : "stg:h-5 stg:w-5",
        )}
      >
        <EntryIcon icon={item.icon} />
      </span>
      <span className="stg:min-w-0 stg:flex-1 stg:text-left">
        <span className="stg:block stg:truncate stg:text-sm stg:font-medium stg:text-foreground">{item.name}</span>
        {layout === "card" && item.detail !== "" && <span className="stg:block stg:truncate stg:text-xs stg:text-muted-foreground">{item.detail}</span>}
      </span>
      {layout === "row" && item.detail !== "" && <span className="stg:shrink-0 stg:text-xs stg:tabular-nums stg:text-muted-foreground">{item.detail}</span>}
    </>
  );
  const classes = cn(
    "stg:flex stg:w-full stg:min-w-0 stg:items-center stg:gap-3",
    layout === "card" ? "stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3 stg:py-2" : "stg:px-3 stg:py-2",
  );
  if (item.onOpen === undefined) return <div className={classes}>{inner}</div>;
  return (
    <button type="button" onClick={item.onOpen} className={cn(classes, "stg:hover:bg-muted-subtle stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring")}>
      {inner}
    </button>
  );
}

function EntryIcon({ icon }: { readonly icon: OutcomeItem["icon"] }) {
  const paths =
    icon === "edit" ? (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" />
      </>
    ) : icon === "table" ? (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M3 15h18M9 4v16" />
      </>
    ) : (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </>
    );
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  );
}
