import React from "react";
import { Box, Text } from "ink";
import type { FileChangeProgress } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { kindLetter, progressEntryDisplayPath } from "../file-review.js";
import { FileLineStats } from "./FileReviewAtoms.js";

/** Props for {@link FileChangeProgressBar}. */
export interface FileChangeProgressBarProps {
  /**
   * The transient mid-run progress snapshot for the active turn (DD-32). Feed
   * this from `useSessionConversation().fileChangeProgress`. Renders nothing when
   * undefined or when no files have changed yet — the server clears it once the
   * turn's change set leaves CAPTURING, so the strip disappears exactly when the
   * decision surface (`FileReviewPrompt`) takes over.
   */
  readonly progress: FileChangeProgress | undefined;
  /**
   * Whether to reveal the per-file list. The compact one-line summary always
   * shows; the list is progressive disclosure. `SessionView` binds this to its
   * existing Ctrl+O "expand" toggle so no new keybinding is introduced. Defaults
   * to `false`.
   */
  readonly expanded?: boolean;
}

/**
 * The terminal analogue of the web's non-interactive "N files changing…" strip
 * (`@stigmer/react` `FileChangeProgressBar`), for a turn that is still running.
 *
 * WHY IT EXISTS. The transcript streams per-edit tool rows, but a change made by
 * a shell command (a `sed`, a build step) has no tool row, and there is no
 * running net-of-many-edits rollup until the turn ends. This strip fills that
 * gap: a compact, non-interactive count of the workspace delta accumulating
 * during the turn, sitting where the `FileReviewPrompt` will later appear. The
 * two are mutually exclusive per turn (progress shows while CAPTURING; the prompt
 * once AWAITING_REVIEW), so the strip hands off cleanly to the prompt.
 *
 * NEVER A DECISION SURFACE. Progress is non-authoritative and carries no file
 * bodies — it is never reviewable or decidable, and it owns no keyboard input.
 * The reviewed diff is the turn-boundary candidate (`FileReviewPrompt`). A
 * secret-like path is surfaced by name with its counts withheld (zeroed), so the
 * `+N −M` stat renders nothing for it. The quiet/dim register (no border)
 * distinguishes it from the loud, bordered decision prompt.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 * <FileChangeProgressBar progress={conv.fileChangeProgress} expanded={expandTools} />
 * ```
 */
export function FileChangeProgressBar({
  progress,
  expanded = false,
}: FileChangeProgressBarProps) {
  if (!progress || progress.filesChanged === 0) return null;

  const { filesChanged, linesAdded, linesRemoved, entries } = progress;
  const hiddenCount = filesChanged - entries.length;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box gap={1}>
        <Text dimColor>✎</Text>
        <Text dimColor>
          {filesChanged} file{filesChanged === 1 ? "" : "s"} changing…
        </Text>
        <FileLineStats linesAdded={linesAdded} linesRemoved={linesRemoved} />
      </Box>

      {expanded && (
        <Box flexDirection="column" paddingLeft={2}>
          {entries.map((entry, idx) => {
            const path = progressEntryDisplayPath(entry);
            return (
              <Box key={`${path}-${idx}`} gap={1}>
                <Text dimColor>{kindLetter(entry.kind)}</Text>
                <Text dimColor wrap="truncate-end">
                  {path}
                </Text>
                <FileLineStats
                  linesAdded={entry.linesAdded}
                  linesRemoved={entry.linesRemoved}
                />
              </Box>
            );
          })}
          {hiddenCount > 0 && (
            <Box>
              <Text dimColor>… and {hiddenCount} more</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
