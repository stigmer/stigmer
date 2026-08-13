"use client";

import { memo, useState } from "react";
import type { FileChangeProgress } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { FileKindBadge, FileLineStats } from "./FileReviewAtoms.js";
import { FilePathLink } from "./FilePathLink.js";

/** Props for {@link FileChangeProgressBar}. */
export interface FileChangeProgressBarProps {
  /**
   * The transient mid-run progress snapshot for the active turn (DD-32). Feed
   * this from `useSessionConversation().fileChangeProgress`. Renders nothing when
   * undefined or when no files have changed yet — the server clears it once the
   * turn's change set leaves CAPTURING, so the bar disappears exactly when the
   * decision surface ({@link FileReviewDock}) takes over.
   */
  readonly progress: FileChangeProgress | undefined;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The live "N files changed so far" strip for a turn that is still running.
 *
 * WHY IT EXISTS. The transcript streams per-edit tool rows, but a change made by
 * a shell command (a `sed`, a build step) has no tool row, and there is no
 * running net-of-many-edits rollup until the turn ends. This bar fills that gap:
 * a compact, NON-INTERACTIVE count of the workspace delta accumulating during
 * the turn, pinned above the composer where the {@link FileReviewDock} will later
 * appear. The two are mutually exclusive per turn (progress shows while CAPTURING;
 * the dock shows once AWAITING_REVIEW), so the bar hands off cleanly to the dock.
 *
 * NEVER A DECISION SURFACE. Progress is non-authoritative and carries no file
 * bodies — it is never reviewable or decidable. The reviewed diff is the
 * turn-boundary candidate ({@link FileReviewDock} / the stamped transcript rows).
 * A secret-like path is surfaced by name with its counts withheld (zeroed), so
 * `FileLineStats` renders nothing for it.
 *
 * A11Y. Only the summary count is an `aria-live` region — the per-file list is
 * not — so a screen reader hears "3 files changing" as the count moves, not a
 * per-file barrage on every ~2s refresh.
 *
 * Purely presentational (headless-first, DD-003): the data lives in
 * `useSessionConversation().fileChangeProgress`. `SessionViewer` mounts it above
 * the dock by default.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId);
 * <FileChangeProgressBar progress={conv.fileChangeProgress} />
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
    <div
      role="region"
      aria-label="File changes in progress"
      data-cursor-target="file-change-progress-bar"
      className={cn("stg:border-t stg:border-border-muted stg:px-4 stg:py-2", className)}
    >
      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-2 stg:text-left stg:text-xs stg:text-muted-foreground stg:hover:text-foreground"
        >
          <span
            aria-hidden="true"
            className={cn("stg:shrink-0 stg:transition-transform", expanded && "stg:rotate-90")}
          >
            ▸
          </span>
          {/* Only the count is live: a screen reader hears the aggregate move,
              not a per-file announcement on every refresh. */}
          <span aria-live="polite" className="stg:min-w-0 stg:truncate">
            {filesChanged} {filesChanged === 1 ? "file" : "files"} changing…
          </span>
        </button>
        <FileLineStats linesAdded={linesAdded} linesRemoved={linesRemoved} />
      </div>
      {expanded && (
        <ul className={cn(UNSTYLED_LIST, "stg:mt-2 stg:max-h-[30vh] stg:space-y-1 stg:overflow-y-auto")}>
          {entries.map((entry) => {
            const path = entry.pathAfter || entry.pathBefore;
            return (
              <li key={path} className="stg:flex stg:items-center stg:gap-2">
                <FileKindBadge kind={entry.kind} />
                <FilePathLink
                  path={path}
                  dirDisplay="dim"
                  className="stg:min-w-0 stg:flex-1 stg:text-xs"
                />
                <FileLineStats
                  linesAdded={entry.linesAdded}
                  linesRemoved={entry.linesRemoved}
                />
              </li>
            );
          })}
          {hiddenCount > 0 && (
            <li className="stg:text-xs stg:text-muted-foreground-faint">
              … and {hiddenCount} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
});
