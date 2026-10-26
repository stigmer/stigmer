/**
 * A Claude tool call's row in the shape the shared tool-view fixtures give a
 * case (`test/fixtures/tool-view/result-views.json`): the tool, its server,
 * its arguments, its result or error, and its status when it failed. Read
 * from a row as the session holds it (the hermetic goldens' JSON), so the
 * fixtures' Claude cases are the engine's own rows (`tool-view-fixtures.test.ts`).
 *
 * The workspace's own path, a temporary directory in a hermetic run, is
 * written `/workspace`, as the fixtures write it.
 */

import { toJson } from "@bufbuild/protobuf";

import { ToolCallSchema, type ToolCall } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

/** A row as a rows golden holds it: proto JSON, absent fields left out. */
export interface GoldenRow {
  readonly id: string;
  readonly name: string;
  readonly mcpServerSlug?: string;
  readonly args?: Record<string, unknown>;
  readonly result?: string;
  readonly error?: string;
  readonly status: string;
}

/** A fixture case's captured half: what the reader is handed. */
export interface CapturedCase {
  readonly id: string;
  readonly toolName: string;
  readonly mcpServerSlug: string;
  readonly args: Record<string, unknown>;
  readonly result: string;
  readonly error?: string;
  readonly status?: "TOOL_CALL_FAILED";
}

/** The fixture shape of a row, from the proto row or its golden JSON. */
export function capturedCase(row: ToolCall | GoldenRow, workspaceDir?: string): CapturedCase {
  const json = ("$typeName" in row ? toJson(ToolCallSchema, row) : row) as unknown as GoldenRow;
  const failed = json.status === "TOOL_CALL_FAILED";
  const captured: CapturedCase = {
    id: json.id,
    toolName: json.name,
    mcpServerSlug: json.mcpServerSlug ?? "",
    args: json.args ?? {},
    result: json.result ?? "",
    ...(json.error !== undefined && json.error !== "" ? { error: json.error } : {}),
    ...(failed ? { status: "TOOL_CALL_FAILED" as const } : {}),
  };
  return workspaceDir === undefined ? captured : (JSON.parse(JSON.stringify(captured).split(workspaceDir).join("/workspace")) as CapturedCase);
}
