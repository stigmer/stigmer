"use client";

// The block that closes a turn: how it ended and how long it took, the
// files it changed and the Files it returned, each a button that opens it
// in place. Black and white: the block is set apart by a rule and type,
// and a failed turn by its words.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import { durationWords } from "./duration-words.js";
import { endingWord } from "./turn-endings.js";
import type { TurnChange, TurnOutcomeView } from "./turn-outcome.js";

/** Props for {@link TurnOutcome}. */
export interface TurnOutcomeProps {
  readonly outcome: TurnOutcomeView;
  /** Opens a File the turn returned; omitted where nothing can open it. */
  readonly onOpenFile?: (file: StigmerFile) => void;
  /**
   * Opens a changed path; omitted where nothing can open it. Return false
   * for a change this viewer cannot show, and its chip reads as a label.
   */
  readonly canOpenChange?: (change: TurnChange) => boolean;
  readonly onOpenChange?: (change: TurnChange) => void;
  readonly className?: string;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function sizeWords(bytes: bigint | undefined): string {
  const n = Number(bytes ?? BigInt(0));
  if (n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Chip({ label, detail, onClick }: { readonly label: string; readonly detail?: string; readonly onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={onClick === undefined}
      className="stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:border stg:border-border stg:bg-card stg:px-2 stg:py-1 stg:font-mono stg:text-xs stg:hover:bg-muted stg:disabled:cursor-default"
    >
      {label}
      {detail !== undefined && detail !== "" && <span className="stg:font-sans stg:text-muted-foreground">{detail}</span>}
    </button>
  );
}

/** A turn's closing block (module header). */
export function TurnOutcome({ outcome, onOpenFile, canOpenChange, onOpenChange, className }: TurnOutcomeProps) {
  if (outcome.phase === undefined) return null;
  const ending = endingWord(outcome.phase);
  return (
    <section
      aria-label="What this turn produced"
      className={cn("stg:mx-4 stg:space-y-2 stg:border-t stg:border-border stg:pt-3", className)}
    >
      <p className="stg:text-xs stg:text-muted-foreground">
        <span className="stg:font-medium stg:text-foreground">{ending}</span> · {durationWords(outcome.elapsedMs)}
      </p>
      {outcome.changes.length > 0 && (
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-1.5">
          <span className="stg:w-16 stg:text-xs stg:text-muted-foreground">Changed</span>
          {outcome.changes.map((change) => (
            <Chip
              key={change.path}
              label={baseName(change.path)}
              onClick={onOpenChange && (canOpenChange?.(change) ?? true) ? () => onOpenChange(change) : undefined}
            />
          ))}
        </div>
      )}
      {outcome.files.length > 0 && (
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-1.5">
          <span className="stg:w-16 stg:text-xs stg:text-muted-foreground">Made</span>
          {outcome.files.map((file) => (
            <Chip
              key={file.metadata?.id}
              label={file.spec?.filename ?? ""}
              detail={sizeWords(file.status?.sizeBytes)}
              onClick={onOpenFile && (() => onOpenFile(file))}
            />
          ))}
        </div>
      )}
    </section>
  );
}
