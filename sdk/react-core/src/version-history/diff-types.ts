// The two diff primitives the text-diff helpers build (computeDiff,
// diff-hunks) and every diff view draws. They live apart from the version
// history's view types so the helpers carry no component type with them.


/** A single line within a diff hunk. */
export interface DiffLine {
  readonly type: "added" | "removed" | "context";
  readonly content: string;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}

/** A contiguous group of changed/context lines in a unified diff. */
export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}
