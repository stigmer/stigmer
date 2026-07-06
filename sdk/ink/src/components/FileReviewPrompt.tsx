import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type {
  CapturedFileChange,
  FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  changeSetReviewability,
  fileReviewability,
  deriveEffectiveVerdicts,
  fileDecisionKey,
  type FileDecisionOptions,
} from "@stigmer/react";
import {
  blockReasonNote,
  changeDisplayPath,
  changeSetLineStats,
  kindLetter,
} from "../file-review.js";
import { FileLineStats } from "./FileReviewAtoms.js";

/** Props for {@link FileReviewPrompt}. */
export interface FileReviewPromptProps {
  /** The AWAITING_REVIEW change set this prompt decides. */
  readonly changeSet: FileChangeSet;
  /**
   * Submit a decision for this set (or one file within it). Bound to the active
   * execution by the caller; the terminal analogue of the web dock's
   * `submitFileDecision`.
   */
  readonly onSubmit: (
    changeSetId: string,
    action: FileDecisionAction,
    options?: FileDecisionOptions,
  ) => void;
  /** Keys (via `fileDecisionKey`) currently being submitted — drives busy state. */
  readonly submittingDecisionKeys?: ReadonlySet<string>;
  /** Per-decision failures, keyed via `fileDecisionKey`. */
  readonly decisionErrors?: ReadonlyMap<string, Error>;
  /**
   * Whether this prompt owns the keyboard. False renders a read-only view (no
   * `useInput`) so exactly one decision surface is interactive at a time.
   * Defaults to `true`.
   */
  readonly isActive?: boolean;
}

/**
 * The bulk approve/reject verb labels for a set, mirroring the web card's
 * `bulkLabels`: "Keep" for a binary-only set (its bytes are applied as-is),
 * "Approve" otherwise; "remaining" when some files are already decided.
 */
function bulkLabels(
  total: number,
  decided: number,
  binaryOnly: boolean,
): { approve: string; reject: string } {
  const verb = binaryOnly ? "Keep" : "Approve";
  if (total <= 1) return { approve: verb, reject: "Reject" };
  if (decided > 0 && decided < total) {
    return { approve: `${verb} remaining`, reject: "Reject remaining" };
  }
  return { approve: `${verb} all`, reject: "Reject all" };
}

interface BulkOption {
  readonly label: string;
  readonly shortcut: string;
  readonly color: string;
  readonly run: () => void;
}

/**
 * The terminal file-review decision surface — the linear-log analogue of the
 * web's composer-docked `FileReviewDock`/`FileReviewCard`.
 *
 * Renders `N files awaiting review` and, gated by `changeSetReviewability`:
 * bulk Approve/Keep all + Reject all (a complete set is approvable as-is; a
 * binary-only set is kept with an acknowledgement; a blocked set can only be
 * rejected in bulk), plus a per-file mode (`f`) for keeping/discarding each file
 * — the only way to resolve a blocked or mixed set, since the server refuses a
 * whole-set approve unless every file is complete. Decisions carry the same
 * digests (`aggregate_digest` / `file_digest`) and `acknowledge_unreviewable`
 * semantics as the web; no decision-model change.
 *
 * Keyboard: `a` approve/keep all · `r` reject all · `f` per-file mode; in
 * per-file mode ↑/↓ move, `k` keep, `d` discard, `esc` back. Input is gated by
 * `isActive` so only one decision surface owns the keyboard at a time.
 */
export function FileReviewPrompt({
  changeSet,
  onSubmit,
  submittingDecisionKeys,
  decisionErrors,
  isActive = true,
}: FileReviewPromptProps) {
  const [perFile, setPerFile] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const changes = changeSet.changes;
  const total = changes.length;
  const reviewability = changeSetReviewability(changeSet);
  const binaryOnly = reviewability === "binary-only";
  const canBulkApprove = reviewability !== "blocked";

  const verdicts = useMemo(
    () => deriveEffectiveVerdicts(changeSet),
    [changeSet],
  );
  const decidedCount = useMemo(() => {
    let n = 0;
    for (const c of changes) if (verdicts.has(c.id)) n++;
    return n;
  }, [changes, verdicts]);

  // The set's aggregate +N −M, shown beside the header so the bar carries the
  // magnitude of what is being decided, not just the file count (web parity).
  const lineStats = useMemo(() => changeSetLineStats(changeSet), [changeSet]);

  const labels = bulkLabels(total, decidedCount, binaryOnly);

  // Busy while any decision for THIS set is in flight (whole-set key or any
  // per-file key). Blocks input to avoid a double-submit mid-request.
  const busy = useMemo(() => {
    if (!submittingDecisionKeys) return false;
    for (const key of submittingDecisionKeys) {
      if (key === changeSet.id || key.startsWith(`${changeSet.id}:`)) return true;
    }
    return false;
  }, [submittingDecisionKeys, changeSet.id]);

  const errorText = useMemo(() => {
    if (!decisionErrors) return null;
    for (const [key, err] of decisionErrors) {
      if (key === changeSet.id || key.startsWith(`${changeSet.id}:`)) {
        return err.message;
      }
    }
    return null;
  }, [decisionErrors, changeSet.id]);

  const submitBulk = (action: FileDecisionAction) => {
    onSubmit(changeSet.id, action, {
      scope: FileDecisionScope.CHANGE_SET,
      expectedDigest: changeSet.aggregateDigest,
      acknowledgeUnreviewable: action === FileDecisionAction.APPROVE && binaryOnly,
    });
  };

  const submitFile = (change: CapturedFileChange, action: FileDecisionAction) => {
    onSubmit(changeSet.id, action, {
      scope: FileDecisionScope.FILE,
      fileChangeId: change.id,
      expectedDigest: change.fileDigest,
      acknowledgeUnreviewable:
        action === FileDecisionAction.APPROVE &&
        fileReviewability(change).kind === "binary",
    });
  };

  // Rebuilt each render (cheap; 2-3 options) so the `run` closures always bind
  // the current `changeSet`/`onSubmit` — a memo keyed on the labels would hold
  // a stale submit closure when the set updates without changing its labels.
  const bulkOptions: BulkOption[] = [];
  if (canBulkApprove) {
    bulkOptions.push({
      label: labels.approve,
      shortcut: "a",
      color: "green",
      run: () => submitBulk(FileDecisionAction.APPROVE),
    });
  }
  bulkOptions.push({
    label: labels.reject,
    shortcut: "r",
    color: "red",
    run: () => submitBulk(FileDecisionAction.REJECT),
  });
  bulkOptions.push({
    label: "Review files",
    shortcut: "f",
    color: "cyan",
    run: () => {
      setSelectedIndex(0);
      setPerFile(true);
    },
  });

  useInput(
    (input, key) => {
      if (busy) return;

      if (perFile) {
        if (key.escape) {
          setPerFile(false);
          return;
        }
        if (key.upArrow) {
          setSelectedIndex((i) => (i > 0 ? i - 1 : total - 1));
          return;
        }
        if (key.downArrow) {
          setSelectedIndex((i) => (i < total - 1 ? i + 1 : 0));
          return;
        }
        const change = changes[selectedIndex];
        if (!change) return;
        if (input === "k") {
          // Keep is refused for a file with no reviewable/keepable bytes.
          if (fileReviewability(change).kind !== "unavailable") {
            submitFile(change, FileDecisionAction.APPROVE);
          }
        } else if (input === "d") {
          submitFile(change, FileDecisionAction.REJECT);
        }
        return;
      }

      // Bulk mode.
      const match = bulkOptions.find((o) => o.shortcut === input.toLowerCase());
      if (match) match.run();
    },
    { isActive: isActive && !busy },
  );

  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
      paddingTop={1}
      paddingBottom={1}
      borderStyle="round"
      borderColor="cyan"
    >
      <Box gap={1}>
        <Text color="cyan" bold>
          ✎ {total} file{total === 1 ? "" : "s"} awaiting review
        </Text>
        <FileLineStats
          linesAdded={lineStats.linesAdded}
          linesRemoved={lineStats.linesRemoved}
        />
      </Box>

      {perFile ? (
        <PerFileList
          changes={changes}
          verdicts={verdicts}
          selectedIndex={selectedIndex}
          interactive={isActive && !busy}
        />
      ) : (
        <Box gap={2} marginTop={1} paddingLeft={2}>
          {bulkOptions.map((opt) => (
            <Text key={opt.shortcut} color={opt.color}>
              [{opt.shortcut}] {opt.label}
            </Text>
          ))}
        </Box>
      )}

      {busy && (
        <Box paddingLeft={2} marginTop={1}>
          <Text dimColor>Submitting...</Text>
        </Box>
      )}

      {errorText && (
        <Box paddingLeft={2} marginTop={1}>
          <Text color="red">Decision failed: {errorText}</Text>
        </Box>
      )}

      {!isActive && !perFile && (
        <Box paddingLeft={2} marginTop={1}>
          <Text dimColor italic>
            Resolve the pending approval first
          </Text>
        </Box>
      )}
    </Box>
  );
}

interface PerFileListProps {
  readonly changes: readonly CapturedFileChange[];
  readonly verdicts: ReadonlyMap<string, FileDecisionAction>;
  readonly selectedIndex: number;
  readonly interactive: boolean;
}

/** The per-file review list: kind letter, path, verdict/keepability, and a hint. */
function PerFileList({
  changes,
  verdicts,
  selectedIndex,
  interactive,
}: PerFileListProps) {
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      {changes.map((change, idx) => {
        const selected = idx === selectedIndex;
        const verdict = verdicts.get(change.id);
        const note = blockReasonNote(change);
        const decided =
          verdict === FileDecisionAction.APPROVE
            ? "kept"
            : verdict === FileDecisionAction.REJECT
              ? "discarded"
              : null;
        return (
          <Box key={change.id} gap={1}>
            <Text color={selected ? "cyan" : undefined}>
              {selected ? "▸" : " "}
            </Text>
            <Text dimColor>{kindLetter(change.kind)}</Text>
            <Text
              color={selected ? "cyan" : undefined}
              bold={selected}
              wrap="truncate-end"
            >
              {changeDisplayPath(change)}
            </Text>
            <FileLineStats
              linesAdded={change.linesAdded}
              linesRemoved={change.linesRemoved}
            />
            {decided && <Text dimColor>({decided})</Text>}
            {!decided && note && <Text color="yellow">— {note}</Text>}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>
          {interactive
            ? "↑/↓ move · [k] keep · [d] discard · [esc] back"
            : "read-only"}
        </Text>
      </Box>
    </Box>
  );
}
