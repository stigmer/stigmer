// The terminal's decision surface for a turn's file changes: keep or undo
// the whole set, or each file, against the digests the reviewer saw. What is
// decided comes from the session's fold (`FileReviewSet`); the selected
// file's diff renders from the run's captured bytes when the caller holds
// them.
import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { FileReviewFile, FileReviewSet } from "@stigmer/sdk";
import {
  changeSetReviewability,
  fileChangeKindOf,
  fileReviewability,
  type FileReviewAction,
  type ReviewFileChangesOptions,
} from "@stigmer/react";
import {
  blockReasonNote,
  changeSetLineStats,
  fileDisplayPath,
  kindLetter,
} from "../file-review.js";
import { FileLineStats } from "./FileReviewAtoms.js";
import { FileDiffBody } from "./FileDiffBody.js";

/** Props for {@link FileReviewPrompt}. */
export interface FileReviewPromptProps {
  /** The set with files still undecided this prompt decides (`Turn.fileReview`). */
  readonly fileReviewSet: FileReviewSet;
  /**
   * The set's captured bytes (its run's change set), when the caller holds
   * them (`useSessionConversation().fileChangeCaptures`): the per-file mode
   * renders the selected file's diff from them.
   */
  readonly capture?: FileChangeSet | null;
  /**
   * Submit a decision for this set (or one file within it), bound to the
   * session by the caller (`useSessionConversation().reviewFileChanges`).
   */
  readonly onSubmit: (
    changeSetId: string,
    action: FileReviewAction,
    options: ReviewFileChangesOptions,
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
 * bulk Approve/Keep all + Reject all (a complete set is keepable as-is; a
 * binary-only set is kept with an acknowledgement; a blocked set can only be
 * undone in bulk), plus a per-file mode (`f`) for keeping/discarding each file
 * — the only way to resolve a blocked or mixed set, since the server refuses a
 * whole-set keep unless every file is complete. Decisions carry the same
 * digests (the set's aggregate digest / the file's digest) and the
 * acknowledgement semantics as the web.
 *
 * Keyboard: `a` approve/keep all · `r` reject all · `f` per-file mode; in
 * per-file mode ↑/↓ move, `k` keep, `d` discard, `esc` back. Input is gated by
 * `isActive` so only one decision surface owns the keyboard at a time.
 */
export function FileReviewPrompt({
  fileReviewSet,
  capture = null,
  onSubmit,
  submittingDecisionKeys,
  decisionErrors,
  isActive = true,
}: FileReviewPromptProps) {
  const [perFile, setPerFile] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const files = fileReviewSet.files;
  const total = files.length;
  const setId = fileReviewSet.changeSetId;
  const reviewability = changeSetReviewability(fileReviewSet);
  const binaryOnly = reviewability === "binary-only";
  const canBulkApprove = reviewability !== "blocked";

  const decidedCount = useMemo(
    () => files.filter((file) => file.state !== "undecided").length,
    [files],
  );

  // The set's aggregate +N −M, shown beside the header so the bar carries the
  // magnitude of what is being decided, not just the file count (web parity).
  const lineStats = useMemo(() => changeSetLineStats(fileReviewSet), [fileReviewSet]);

  const labels = bulkLabels(total, decidedCount, binaryOnly);

  // Busy while any decision for THIS set is in flight (whole-set key or any
  // per-file key). Blocks input to avoid a double-submit mid-request.
  const busy = useMemo(() => {
    if (!submittingDecisionKeys) return false;
    for (const key of submittingDecisionKeys) {
      if (key === setId || key.startsWith(`${setId}:`)) return true;
    }
    return false;
  }, [submittingDecisionKeys, setId]);

  const errorText = useMemo(() => {
    if (!decisionErrors) return null;
    for (const [key, err] of decisionErrors) {
      if (key === setId || key.startsWith(`${setId}:`)) {
        return err.message;
      }
    }
    return null;
  }, [decisionErrors, setId]);

  const submitBulk = (action: FileReviewAction) => {
    onSubmit(setId, action, {
      scope: "change_set",
      expectedDigest: fileReviewSet.aggregateDigest,
      acknowledgeUnreviewable: action === "keep" && binaryOnly,
    });
  };

  const submitFile = (file: FileReviewFile, action: FileReviewAction) => {
    onSubmit(setId, action, {
      scope: "file",
      fileChangeId: file.fileChangeId,
      expectedDigest: file.digest,
      acknowledgeUnreviewable: action === "keep" && fileReviewability(file).kind === "binary",
    });
  };

  // Rebuilt each render (cheap; 2-3 options) so the `run` closures always bind
  // the current set and `onSubmit` — a memo keyed on the labels would hold a
  // stale submit closure when the set updates without changing its labels.
  const bulkOptions: BulkOption[] = [];
  if (canBulkApprove) {
    bulkOptions.push({
      label: labels.approve,
      shortcut: "a",
      color: "green",
      run: () => submitBulk("keep"),
    });
  }
  bulkOptions.push({
    label: labels.reject,
    shortcut: "r",
    color: "red",
    run: () => submitBulk("undo"),
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
        const file = files[selectedIndex];
        if (!file) return;
        if (input === "k") {
          // Keep is refused for a file with no reviewable/keepable bytes.
          if (fileReviewability(file).kind !== "unavailable") {
            submitFile(file, "keep");
          }
        } else if (input === "d") {
          submitFile(file, "undo");
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
          files={files}
          capture={capture}
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
  readonly files: readonly FileReviewFile[];
  readonly capture: FileChangeSet | null;
  readonly selectedIndex: number;
  readonly interactive: boolean;
}

/** A file's decided state, as the per-file list reads it; `null` while undecided. */
const DECIDED_LABEL: Readonly<Record<FileReviewFile["state"], string | null>> = {
  undecided: null,
  kept: "kept",
  undoing: "discarded",
  undone: "discarded",
  undo_failed: "undo failed",
};

/**
 * The per-file review list: kind letter, path, verdict/keepability, and a hint,
 * followed by a master-detail diff pane for the selected file. The list itself
 * stays stable as the selection moves (the diff renders in a fixed pane below,
 * not inline between rows), so navigating never reflows the rows above.
 */
function PerFileList({
  files,
  capture,
  selectedIndex,
  interactive,
}: PerFileListProps) {
  const selectedFile = files[selectedIndex];
  const selectedChange = selectedFile
    ? capture?.changes.find((change) => change.id === selectedFile.fileChangeId)
    : undefined;
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      {files.map((file, idx) => {
        const selected = idx === selectedIndex;
        const note = blockReasonNote(file);
        const decided = DECIDED_LABEL[file.state];
        return (
          <Box key={file.fileChangeId} gap={1}>
            <Text color={selected ? "cyan" : undefined}>
              {selected ? "▸" : " "}
            </Text>
            <Text dimColor>{kindLetter(fileChangeKindOf(file.change))}</Text>
            <Text
              color={selected ? "cyan" : undefined}
              bold={selected}
              wrap="truncate-end"
            >
              {fileDisplayPath(file)}
            </Text>
            <FileLineStats
              linesAdded={file.linesAdded}
              linesRemoved={file.linesRemoved}
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

      {/* Master-detail: the selected file's diff renders here (keyed by id so it
          remounts — and lazily re-resolves any offloaded body — as the selection
          moves), below the list so the controls above never shift. Without the
          run's captured bytes there is no diff to show. */}
      {selectedChange ? (
        <FileDiffBody key={selectedChange.id} change={selectedChange} />
      ) : (
        selectedFile && (
          <Box marginTop={1}>
            <Text dimColor>No diff available.</Text>
          </Box>
        )
      )}
    </Box>
  );
}
