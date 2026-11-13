"use client";

import { memo, useState } from "react";
import type { FileChangeProgress } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { cn } from "@stigmer/design-tokens";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { ComposerStrip } from "../session/ComposerStrip.js";
import { changeWords } from "../session/turn-change-words.js";
import { FileLineStats } from "./FileReviewAtoms.js";

/** Props for {@link FileChangeProgressBar}. */
export interface FileChangeProgressBarProps {
  /**
   * The transient mid-run progress snapshot for the active turn. Feed
   * this from `useSessionConversation().fileChangeProgress`. Renders nothing when
   * undefined or when no files have changed yet: the server clears it once the
   * turn's changes are captured, when the same files show under the finished
   * turn's Changed group.
   */
  readonly progress: FileChangeProgress | undefined;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The live "Changing 2 files" strip for a turn that is still running.
 *
 * WHY IT EXISTS. The transcript streams per-edit tool rows, but a change made by
 * a shell command (a `sed`, a build step) has no tool row, and there is no
 * running net-of-many-edits rollup until the turn ends. This strip fills that
 * gap above the composer: the count and line counts so far, opening to each
 * file in the same words the finished turn's Changed group uses (New,
 * Deleted, nothing for an edit), so the files read as one thing moving from
 * changing to changed.
 *
 * NEVER A DECISION SURFACE. Progress is non-authoritative and carries no file
 * bodies. A secret-like path is surfaced by name with its counts withheld
 * (zeroed), so `FileLineStats` renders nothing for it.
 *
 * A11Y. Only the summary count is an `aria-live` region; the per-file list is
 * not, so a screen reader hears the count move, not a per-file barrage on
 * every refresh.
 *
 * Purely presentational (headless-first): the data lives in
 * `useSessionConversation().fileChangeProgress`. `SessionViewer` mounts it
 * above the composer.
 *
 * @example
 * ```tsx
 * function ChangeProgress({ sessionId, org }: { sessionId: string; org: string }) {
 *   const conv = useSessionConversation(sessionId, org);
 *   return <FileChangeProgressBar progress={conv.fileChangeProgress} />;
 * }
 * ```
 */
export const FileChangeProgressBar = memo(function FileChangeProgressBar({
  progress,
  className,
}: FileChangeProgressBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (!progress || progress.filesChanged === 0) return null;

  const { filesChanged, linesAdded, linesRemoved, entries } = progress;
  const hiddenCount = filesChanged - entries.length;

  return (
    <ComposerStrip
      role="region"
      aria-label="File changes in progress"
      data-cursor-target="file-change-progress-bar"
      className={className}
      tone="working"
      icon={<SpinnerIcon size={12} className="stg:text-status-running stg:motion-reduce:animate-none" />}
      expanded={expanded}
      onToggle={() => setExpanded((prev) => !prev)}
      below={
        <ul className={cn(UNSTYLED_LIST, "stg:max-h-[30vh] stg:space-y-1 stg:overflow-y-auto")}>
          {entries.map((entry) => {
            const path = entry.pathAfter || entry.pathBefore;
            const at = path.lastIndexOf("/");
            const words = changeWords(entry.kind);
            return (
              <li key={path} className="stg:flex stg:min-w-0 stg:items-center stg:gap-2 stg:text-sm">
                <span className="stg:min-w-0 stg:truncate stg:font-medium stg:text-foreground">{path.slice(at + 1)}</span>
                <span className="stg:min-w-0 stg:truncate stg:text-xs stg:text-muted-foreground">
                  {[at > 0 ? path.slice(0, at) : "", words].filter((part) => part !== "").join(" · ")}
                </span>
                <FileLineStats linesAdded={entry.linesAdded} linesRemoved={entry.linesRemoved} />
              </li>
            );
          })}
          {hiddenCount > 0 && <li className="stg:text-xs stg:text-muted-foreground">and {hiddenCount} more</li>}
        </ul>
      }
    >
      <span className="stg:inline-flex stg:items-center stg:gap-2">
        {/* Only the count is live: a screen reader hears the aggregate move,
            not a per-file announcement on every refresh. */}
        <span aria-live="polite">
          Changing {filesChanged} {filesChanged === 1 ? "file" : "files"}
        </span>
        <FileLineStats linesAdded={linesAdded} linesRemoved={linesRemoved} />
      </span>
    </ComposerStrip>
  );
});
