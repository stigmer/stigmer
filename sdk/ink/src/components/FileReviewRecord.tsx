// A settled file review's read-only terminal record: what a turn changed and
// how each file was decided, read from the session's fold (`FileReviewSet`).
import React from "react";
import { Box, Text } from "ink";
import type { FileReviewFile, FileReviewSet } from "@stigmer/client";
import { fileChangeKindOf } from "@stigmer/react-core";
import {
  changeSetLineStats,
  fileDisplayPath,
  kindLetter,
  settledSummary,
} from "../file-review.js";
import { FileLineStats } from "./FileReviewAtoms.js";

/** Props for {@link FileReviewRecord}. */
export interface FileReviewRecordProps {
  /** A settled set (every file decided, or its turn ended) to record. */
  readonly fileReviewSet: FileReviewSet;
}

/** Each file's outcome, as the record labels it. */
const OUTCOME_LABEL: Readonly<Record<FileReviewFile["state"], string>> = {
  undecided: "not reviewed",
  kept: "kept",
  undoing: "discarded",
  undone: "discarded",
  undo_failed: "undo failed",
};

/**
 * A read-only, append-only record of a SETTLED file review — the terminal
 * analogue of the web's in-thread `FileReviewRecordRow`.
 *
 * Its primary job is the shell-made case: changes made by shell commands
 * have no edit row, so the per-row badges leave no trace and this record is
 * the only evidence of what was reviewed and decided. Changes with edit rows
 * already carry their outcome on the (frozen) row badges; this record
 * complements them with a one-line summary and file list.
 */
export function FileReviewRecord({ fileReviewSet }: FileReviewRecordProps) {
  const summary = settledSummary(fileReviewSet);
  const lineStats = changeSetLineStats(fileReviewSet);

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box gap={1}>
        <Text dimColor>✎</Text>
        <Text dimColor>File review — {summary}</Text>
        <FileLineStats
          linesAdded={lineStats.linesAdded}
          linesRemoved={lineStats.linesRemoved}
        />
      </Box>
      {fileReviewSet.files.map((file) => (
        <Box key={file.fileChangeId} paddingLeft={2} gap={1}>
          <Text dimColor>{kindLetter(fileChangeKindOf(file.change))}</Text>
          <Text dimColor wrap="truncate-end">
            {fileDisplayPath(file)}
          </Text>
          <FileLineStats
            linesAdded={file.linesAdded}
            linesRemoved={file.linesRemoved}
          />
          <Text dimColor>({OUTCOME_LABEL[file.state]})</Text>
        </Box>
      ))}
    </Box>
  );
}
