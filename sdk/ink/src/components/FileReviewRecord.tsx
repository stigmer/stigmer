import React from "react";
import { Box, Text } from "ink";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { deriveEffectiveVerdicts } from "@stigmer/react";
import {
  changeDisplayPath,
  changeSetLineStats,
  kindLetter,
  settledSummary,
} from "../file-review.js";
import { FileLineStats } from "./FileReviewAtoms.js";

/** Props for {@link FileReviewRecord}. */
export interface FileReviewRecordProps {
  /** A settled (decided / reconciled / failed) change set to record. */
  readonly fileChangeSet: FileChangeSet;
}

/**
 * A read-only, append-only record of a SETTLED file-review change set — the
 * terminal analogue of the web's in-thread `FileReviewRecordRow` (DD-27 D2).
 *
 * Its primary job is the no-stamped-row case: a set changed only via shell
 * commands stamps no edit rows, so the per-row badges leave no trace and this
 * record is the only evidence of what was reviewed and decided. Sets with
 * stamped rows already carry their outcome on the (frozen) row badges; this
 * record complements them with a one-line summary and file list.
 */
export function FileReviewRecord({ fileChangeSet }: FileReviewRecordProps) {
  const failed = fileChangeSet.status === FileChangeSetStatus.FAILED;
  const verdicts = deriveEffectiveVerdicts(fileChangeSet);
  const summary = failed ? "review failed" : settledSummary(fileChangeSet);
  const lineStats = changeSetLineStats(fileChangeSet);

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
      {fileChangeSet.changes.map((change) => {
        const verdict = verdicts.get(change.id);
        const label = failed
          ? null
          : verdict === FileDecisionAction.APPROVE
            ? "kept"
            : verdict === FileDecisionAction.REJECT
              ? "discarded"
              : "not reviewed";
        return (
          <Box key={change.id} paddingLeft={2} gap={1}>
            <Text dimColor>{kindLetter(change.kind)}</Text>
            <Text dimColor wrap="truncate-end">
              {changeDisplayPath(change)}
            </Text>
            <FileLineStats
              linesAdded={change.linesAdded}
              linesRemoved={change.linesRemoved}
            />
            {label && <Text dimColor>({label})</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
