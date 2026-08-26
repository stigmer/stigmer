/**
 * Shared converter types — breaks the module cycle between the document
 * assembler (converter.ts, which owns task-list conversion) and the
 * per-kind emitters (task-converters.ts, whose control-flow kinds recurse
 * into nested task lists).
 */
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

/**
 * Converts a task list to its DSL fragments — the recursion seam Go closes
 * through the Converter receiver (convertTaskList).
 */
export type ConvertTaskList = (
  tasks: WorkflowTask[],
) => Array<Record<string, unknown>>;
