"use client";

// What a turn produced, right under its answer: the Files it returned under
// Made and the files it changed under Changed, each a card that opens it in
// place. Up to four read as cards; from five on, a list of the first five
// with the rest counted by type and "Show all" opening them in place, so
// twenty Files never become a wall. How the turn ended is the header's
// pill, and for a turn that didn't finish its notice above this block.
//
// Changed is the one place a turn's edits are seen and undone. The edits
// are already in the workspace and stay unless undone (the next message
// keeps what is still undecided), so nothing here asks to approve: a card
// says what happened (New, Deleted, Renamed from …), its line counts, and a
// state only when it says something (Undoing…, Undone, Couldn't undo). A
// host that lets the viewer decide passes `undo` for the newest turn: an
// Undo beside each undecided file and, with two or more, Undo all. The
// card's open control is its name, stretched over the card, so Undo sits
// beside it, never inside another button.

import { useContext, useState, type ReactNode } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import { StigmerContext, fileDecisionKey, type ReviewFileChangesOptions } from "@stigmer/react-core";
import type { TurnChange, TurnOutcomeView } from "./turn-outcome.js";
import { CHANGE_WORDS, changeWords } from "./turn-change-words.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { sizeWords } from "../internal/size-words.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Tag } from "../internal/surface/Tag.js";
import { Button } from "../button/Button.js";
import { IconButton } from "../button/IconButton.js";
import { useFileDownload } from "../file/useFile.js";
import { StatusBadge } from "../status/StatusBadge.js";
import { FileLineStats } from "../run/FileReviewAtoms.js";

/**
 * Undo for a turn's changed files, passed only where the viewer decides and
 * the turn is the newest: `onUndo` sends `undo` for one file or a whole set
 * (`useSessionConversation().reviewFileChanges`, bound to its change set),
 * and the busy and error maps are keyed by `fileDecisionKey`.
 */
export interface TurnOutcomeUndo {
  readonly onUndo: (changeSetId: string, options: Pick<ReviewFileChangesOptions, "scope" | "fileChangeId" | "expectedDigest">) => void;
  readonly busyKeys: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, Error>;
}

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
  /** Undo for the changed files; omitted where the viewer may not decide, or the turn is not the newest. */
  readonly undo?: TurnOutcomeUndo;
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
  /** A changed file's line counts or "Binary", after its detail. */
  readonly extra?: ReactNode;
  /** Its state or act, at the right. */
  readonly trailing?: ReactNode;
  /** Drawn faded and struck through: the change was undone. */
  readonly undone?: boolean;
}

/**
 * A changed file's state and act, from its review file and the decision in
 * flight. `refused` is an undo the server refused to record (it can be sent
 * again); `failed` is one it recorded and could not carry out, which sending
 * again does not retry (the decision stands as recorded).
 */
type ChangeState = "undecided" | "undoing" | "undone" | "failed" | "refused" | "none";

function changeState(change: TurnChange, undo: TurnOutcomeUndo | undefined): ChangeState {
  const review = change.review;
  if (review === undefined) return "none";
  const key = fileDecisionKey(review.changeSetId, review.file.fileChangeId);
  const state = review.file.state;
  if (state === "undone") return "undone";
  if (state === "undo_failed") return "failed";
  if (state === "undoing") return "undoing";
  if (state !== "undecided") return "none";
  if (undo === undefined) return "none";
  if (undo.busyKeys.has(key) || undo.busyKeys.has(review.changeSetId)) return "undoing";
  if (undo.errors.has(key) || undo.errors.has(review.changeSetId)) return "refused";
  return "undecided";
}

/** One file's undo, against the digest of what was shown. */
function undoOne(change: TurnChange, undo: TurnOutcomeUndo): void {
  const review = change.review!;
  undo.onUndo(review.changeSetId, { scope: "file", fileChangeId: review.file.fileChangeId, expectedDigest: review.file.digest });
}

/** Undo every still-undecided file: one decision for a set nobody decided yet, else one per file. */
function undoAll(outcome: TurnOutcomeView, undo: TurnOutcomeUndo): void {
  for (const set of outcome.reviewSets) {
    const undecided = set.files.filter((file) => file.state === "undecided");
    if (undecided.length === 0) continue;
    if (undecided.length === set.files.length) {
      undo.onUndo(set.changeSetId, { scope: "change_set", expectedDigest: set.aggregateDigest });
      continue;
    }
    for (const file of undecided) undo.onUndo(set.changeSetId, { scope: "file", fileChangeId: file.fileChangeId, expectedDigest: file.digest });
  }
}

/** "1 undone, 1 couldn't be undone": what a polite region says as the states move. */
function stateSummary(states: readonly ChangeState[]): string {
  const count = (state: ChangeState) => states.filter((s) => s === state).length;
  return [
    count("undoing") > 0 ? `${count("undoing")} undoing` : "",
    count("undone") > 0 ? `${count("undone")} undone` : "",
    count("failed") + count("refused") > 0 ? `${count("failed") + count("refused")} couldn't be undone` : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
}

/** A turn's outcome (module header). */
export function TurnOutcome({ outcome, onOpenFile, canOpenChange, onOpenChange, undo, className }: TurnOutcomeProps) {
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
      // Every File the turn made can be saved from its card.
      ...(file.metadata?.id ? { trailing: <FileDownloadButton fileId={file.metadata.id} filename={name} /> } : {}),
    };
  });
  const states = outcome.changes.map((change) => changeState(change, undo));
  const changed: OutcomeItem[] = outcome.changes.map((change, index) => {
    const name = baseName(change.path);
    const file = change.review?.file;
    const state = states[index]!;
    const words = file === undefined ? "" : changeWords(file.change, file.previousPath);
    return {
      key: change.path,
      name,
      detail: [folderOf(change.path), words].filter((part) => part !== "").join(" · "),
      kind: fileKind(name, ""),
      icon: "edit",
      extra:
        file === undefined ? undefined : file.reviewable === "binary" ? (
          <span>{CHANGE_WORDS.binary}</span>
        ) : (
          <FileLineStats linesAdded={file.linesAdded} linesRemoved={file.linesRemoved} />
        ),
      // Nothing at the right for a kept file, or one nobody here may undo.
      trailing:
        state === "none" || (state === "undecided" && undo === undefined) ? undefined : (
          <ChangeTrailing name={name} state={state} onUndo={undo === undefined ? undefined : () => undoOne(change, undo)} />
        ),
      undone: state === "undone",
      ...(onOpenChange !== undefined && (canOpenChange?.(change) ?? true) ? { onOpen: () => onOpenChange(change) } : {}),
    };
  });
  const undecided = states.filter((state) => state === "undecided").length;
  const busy = states.some((state) => state === "undoing");
  // How a turn that didn't finish ended is said once, by its notice above
  // and the session's pill; this block says only what the turn produced.
  if (made.length === 0 && changed.length === 0) return null;
  return (
    <section aria-label="What this turn produced" className={cn("stg:space-y-4", className)}>
      {made.length > 0 && <OutcomeGroup title="Made" items={made} />}
      {changed.length > 0 && (
        <OutcomeGroup
          title="Changed"
          items={changed}
          act={
            undo !== undefined && undecided >= 2 ? (
              // Quiet, as drawn: the muted tone until the pointer comes to it.
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => undoAll(outcome, undo)} data-cursor-target="turn-file-undo-all" className="stg:text-muted-foreground stg:hover:text-foreground">
                <UndoGlyph />
                {CHANGE_WORDS.undoAll}
              </Button>
            ) : undefined
          }
          status={changed.some((item) => item.trailing !== undefined) ? stateSummary(states) : undefined}
        />
      )}
    </section>
  );
}

/** One titled group: cards up to {@link MAX_CARDS}, else a list with "Show all". */
function OutcomeGroup({
  title,
  items,
  act,
  status,
}: {
  readonly title: string;
  readonly items: readonly OutcomeItem[];
  /** An act on the title's line (Undo all). */
  readonly act?: ReactNode;
  /** What a polite region announces as the items' states move. */
  readonly status?: string;
}) {
  const [all, setAll] = useState(false);
  const asList = items.length > MAX_CARDS;
  const shown = asList && !all ? items.slice(0, LIST_HEAD) : items;
  const rest = items.slice(LIST_HEAD);
  return (
    <div role="group" aria-label={title}>
      {act === undefined ? (
        <p className="stg:mb-2 stg:text-xs stg:font-medium stg:text-muted-foreground">
          {title}
          {asList && ` · ${items.length} files`}
        </p>
      ) : (
        // With an act, the title shares its line: the same place as a plain
        // title (its paragraph's default top margin), the act centred on it.
        <div className="stg:mb-2 stg:mt-1.5 stg:flex stg:min-h-7 stg:items-center stg:justify-between stg:gap-2">
          <p className="stg:m-0 stg:text-xs stg:font-medium stg:text-muted-foreground">
            {title}
            {asList && ` · ${items.length} files`}
          </p>
          {act}
        </div>
      )}
      {status !== undefined && (
        <p role="status" aria-live="polite" className="stg:sr-only">
          {status}
        </p>
      )}
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
              <Button variant="outline" size="xs" onClick={() => setAll(true)}>
                Show all {items.length}
              </Button>
            </div>
          )}
        </div>
      ) : (
        // Up to four cards fill the row in halves, as the drawing lays them;
        // in a narrow session (under 448px of its width) one to a row.
        <div className="stg:grid stg:grid-cols-1 stg:gap-2 stg:@min-[28rem]/session:grid-cols-2">
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

/**
 * One File or change: a card, or a list row. When it opens, its name is the
 * button, stretched over the item; its state and Undo sit above that, so no
 * button is nested in another (the list row's idiom, internal/surface/List).
 */
function OutcomeEntry({ item, layout }: { readonly item: OutcomeItem; readonly layout: "card" | "row" }) {
  const nameClasses = cn("stg:block stg:truncate stg:text-sm stg:font-medium", item.undone ? "stg:text-muted-foreground stg:line-through" : "stg:text-foreground");
  const name =
    item.onOpen === undefined ? (
      <span className={nameClasses}>{item.name}</span>
    ) : (
      <button
        type="button"
        onClick={item.onOpen}
        // Named as the whole item reads (its name, then its detail), as the
        // card was when the card itself was the button.
        aria-label={item.detail === "" ? item.name : `${item.name} ${item.detail}`}
        className={cn(
          nameClasses,
          "stg:max-w-full stg:text-left stg:outline-none stg:after:absolute stg:after:inset-0 stg:after:rounded-[inherit] stg:after:content-[''] stg:focus-visible:after:ring-2 stg:focus-visible:after:ring-ring",
        )}
      >
        {item.name}
      </button>
    );
  const detail =
    item.detail !== "" || item.extra !== undefined ? (
      // One spacing for every dot in the line: the detail's own " · " joins
      // and the one before the counts read alike.
      <span className="stg:flex stg:min-w-0 stg:items-center stg:text-xs stg:text-muted-foreground">
        {item.detail !== "" && <span className="stg:min-w-0 stg:truncate">{item.detail}</span>}
        {item.detail !== "" && item.extra !== undefined && <span aria-hidden="true" className="stg:whitespace-pre">{" · "}</span>}
        {item.extra}
      </span>
    ) : null;
  return (
    <div
      className={cn(
        "stg:relative stg:flex stg:w-full stg:min-w-0 stg:items-center stg:gap-3",
        layout === "card" ? cn("stg:rounded-lg stg:border stg:border-border stg:bg-card stg:py-2 stg:pl-3", item.trailing === undefined ? "stg:pr-3" : "stg:pr-2") : "stg:px-3 stg:py-2",
        item.onOpen !== undefined && "stg:hover:bg-muted-subtle",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "stg:flex stg:shrink-0 stg:items-center stg:justify-center stg:text-muted-foreground",
          layout === "card" ? "stg:h-8 stg:w-8 stg:rounded-md stg:bg-muted" : "stg:h-5 stg:w-5",
        )}
      >
        <EntryIcon icon={item.icon} />
      </span>
      <span className="stg:min-w-0 stg:flex-1">
        {name}
        {layout === "card" && detail}
      </span>
      {layout === "row" && detail !== null && <span className="stg:shrink-0 stg:tabular-nums">{detail}</span>}
      {item.trailing !== undefined && <span className="stg:relative stg:z-10 stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">{item.trailing}</span>}
    </div>
  );
}

/** A changed file's state and act: Undo, Undoing…, Undone, or Couldn't undo with Try again; nothing for a kept file. */
function ChangeTrailing({ name, state, onUndo }: { readonly name: string; readonly state: ChangeState; readonly onUndo: (() => void) | undefined }) {
  if (state === "undone") return <Tag>{CHANGE_WORDS.undone}</Tag>;
  if (state === "undoing") {
    return (
      <span className="stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground">
        <SpinnerIcon size={12} />
        {CHANGE_WORDS.undoing}
      </span>
    );
  }
  if (state === "failed") return <StatusBadge phase="failed" label={CHANGE_WORDS.undoFailed} />;
  if (state === "refused") {
    return (
      <>
        <StatusBadge phase="failed" label={CHANGE_WORDS.undoFailed} />
        {onUndo !== undefined && (
          <Button variant="ghost" size="xs" onClick={onUndo}>
            {CHANGE_WORDS.tryAgain}
          </Button>
        )}
      </>
    );
  }
  // An undecided file, for whoever may undo it (the caller draws nothing otherwise).
  return onUndo === undefined ? null : <IconButton size="xs" label={CHANGE_WORDS.undo(name)} icon={<UndoGlyph />} onClick={onUndo} data-cursor-target="turn-file-undo" />;
}

function UndoGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
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

/**
 * A made File's Download: a fresh link minted on the click, since a link
 * expires. Drawn only where a client is provided to mint the link with.
 */
function FileDownloadButton(props: { readonly fileId: string; readonly filename: string }) {
  const client = useContext(StigmerContext);
  return client === null ? null : <ProvidedFileDownloadButton {...props} />;
}

function ProvidedFileDownloadButton({ fileId, filename }: { readonly fileId: string; readonly filename: string }) {
  const { download, isDownloading } = useFileDownload();
  return (
    <IconButton
      label={`Download ${filename}`}
      size="xs"
      icon={<DownloadGlyph />}
      disabled={isDownloading}
      onClick={() => void download(fileId, filename)}
    />
  );
}

function DownloadGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}
