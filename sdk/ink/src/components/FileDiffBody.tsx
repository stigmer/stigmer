import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  computeDiff,
  useFileChangeContent,
  type DiffHunk,
} from "@stigmer/react";
import { toDisplayFileChange } from "@stigmer/sdk";

/**
 * The most diff lines a single file's body renders before it is capped. A
 * terminal has no scroll-within-region, so an unbounded diff would flood the
 * scrollback; beyond this the remainder is summarized in a `… K more lines`
 * footer (the terminal analogue of the web's `BoundedContent` clamp).
 */
const DIFF_MAX_LINES = 200;

/** Props for {@link FileDiffBody}. */
export interface FileDiffBodyProps {
  /** The captured file change whose before/after diff to render. */
  readonly change: CapturedFileChange;
}

/**
 * The terminal analogue of `@stigmer/react`'s `FileChangeDiff` — the whole-file
 * branch. Renders a single `CapturedFileChange`'s unified diff for review in the
 * terminal.
 *
 * A capture is always whole-file (`toDisplayFileChange` emits
 * `captureLevel = WHOLE_FILE`), so this deliberately handles only that case: it
 * resolves the before/after text via the shared `useFileChangeContent` behavior
 * hook (inline bodies cost nothing; offloaded bodies are fetched lazily through
 * the server proxy) and diffs them with the shared pure `computeDiff` — the SAME
 * engine the web renders, so the terminal and web diffs are line-for-line
 * identical and cannot drift.
 *
 * Renders body-only (no filename caption): the caller's selected row already
 * names the file and shows its `+N −M`, so a header here would just repeat what
 * the reviewer read one line up.
 *
 * **Requires an `InkStigmerProvider` ancestor.** `useFileChangeContent` reads the
 * Stigmer client via `useStigmer()` (to dereference offloaded diff bytes), which
 * throws outside a provider. In a live session this always holds — `SessionView`
 * renders under `InkStigmerProvider`.
 */
export function FileDiffBody({ change }: FileDiffBodyProps) {
  const displayChange = useMemo(() => toDisplayFileChange(change), [change]);
  const { beforeText, afterText, isBinary, isLoading, error, isTruncated, downloadUrl } =
    useFileChangeContent(displayChange);

  const hunks = useMemo<readonly DiffHunk[]>(() => {
    if (beforeText === null || afterText === null) return [];
    return computeDiff(beforeText, afterText);
  }, [beforeText, afterText]);

  // Honest state precedence, mirroring the web FileChangeBody's whole-file arm:
  // a binary has no text diff; a server-truncated body cannot be diffed inline;
  // an offloaded body may still be loading or have failed; only then do we trust
  // an empty hunk list to mean the file genuinely has no visible change.
  if (isBinary) {
    return <Notice>Binary file changed.</Notice>;
  }
  if (isTruncated) {
    return (
      <Notice>
        This file is too large to diff inline.
        {downloadUrl ? ` Download the full file: ${downloadUrl}` : ""}
      </Notice>
    );
  }
  if (isLoading) {
    return <Notice>Loading diff…</Notice>;
  }
  if (error) {
    return <Notice tone="error">Could not load this file's contents.</Notice>;
  }
  if (hunks.length === 0) {
    // A CREATE with nothing to show is a genuinely empty new file; anything else
    // with no renderable diff is the non-committal "no preview" — we never claim
    // emptiness we cannot prove from the capture.
    return (
      <Notice>
        {displayChange.changeType === FileChangeType.CREATE
          ? "Empty new file."
          : "No preview available."}
      </Notice>
    );
  }

  return <DiffHunks hunks={hunks} />;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** One renderable diff row: a hunk header, or a single before/after line. */
type DiffRow =
  | { readonly kind: "header"; readonly text: string }
  | { readonly kind: "line"; readonly type: "added" | "removed" | "context"; readonly content: string };

/** Flattens hunks into a single row stream so the line cap spans the whole diff. */
function flattenHunks(hunks: readonly DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const hunk of hunks) {
    rows.push({
      kind: "header",
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    });
    for (const line of hunk.lines) {
      rows.push({ kind: "line", type: line.type, content: line.content });
    }
  }
  return rows;
}

function DiffHunks({ hunks }: { hunks: readonly DiffHunk[] }) {
  const rows = useMemo(() => flattenHunks(hunks), [hunks]);
  const shown = rows.slice(0, DIFF_MAX_LINES);
  const overflow = rows.length - shown.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {shown.map((row, i) => (
        <DiffRowText key={i} row={row} />
      ))}
      {overflow > 0 && (
        <Text dimColor>… {overflow} more line{overflow === 1 ? "" : "s"}</Text>
      )}
    </Box>
  );
}

function DiffRowText({ row }: { row: DiffRow }) {
  if (row.kind === "header") {
    return <Text dimColor>{row.text}</Text>;
  }
  if (row.type === "added") {
    return <Text color="green">+{row.content}</Text>;
  }
  if (row.type === "removed") {
    return <Text color="red">-{row.content}</Text>;
  }
  return <Text dimColor> {row.content}</Text>;
}

/** A short status line for a non-renderable diff (binary / truncated / loading / error / empty). */
function Notice({
  children,
  tone = "muted",
}: {
  readonly children: React.ReactNode;
  readonly tone?: "muted" | "error";
}) {
  return (
    <Box marginTop={1}>
      <Text color={tone === "error" ? "red" : undefined} dimColor={tone !== "error"}>
        {children}
      </Text>
    </Box>
  );
}
