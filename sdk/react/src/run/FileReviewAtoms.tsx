"use client";

// The `+N −M` line counts a changed file shows, in one place, so the finished
// turn's Changed group and the files-changing strip render a file's size of
// change the same way.

/**
 * The `+N −M` stat for one file (or a whole set), in the same visual vocabulary
 * as the tool-row diff stats, in mono; a side that is zero is left out. Renders nothing when both counts are zero — the
 * honest signal that no count exists (binary or secret-withheld changes, records
 * captured before counts were stamped) — rather than a misleading `+0 −0`.
 */
export function FileLineStats({
  linesAdded,
  linesRemoved,
}: {
  readonly linesAdded: number;
  readonly linesRemoved: number;
}) {
  if (linesAdded === 0 && linesRemoved === 0) return null;
  return (
    <span
      className="stg:shrink-0 stg:font-mono stg:text-xs stg:tabular-nums"
      aria-label={`${linesAdded} added, ${linesRemoved} removed`}
      data-cursor-target="file-review-line-stats"
    >
      {/* A count of zero says nothing: a new file reads "+30", a cleared one "−12". */}
      {linesAdded > 0 && <span className="stg:text-diff-added-fg">+{linesAdded}</span>}
      {linesAdded > 0 && linesRemoved > 0 && " "}
      {linesRemoved > 0 && <span className="stg:text-diff-removed-fg">{"−"}{linesRemoved}</span>}
    </span>
  );
}
