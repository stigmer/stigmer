export type {
  NodeDiffStatus,
  EdgeDiffStatus,
  NodeDiffEntry,
  EdgeDiffEntry,
  GraphDiff,
} from "./types.js";

export { computeGraphDiff, jsonEqual } from "./graph-diff.js";
export { buildDiffGraph } from "./build-diff-graph.js";
export { DiffSummaryBar, type DiffSummaryBarProps } from "./DiffSummaryBar.js";
