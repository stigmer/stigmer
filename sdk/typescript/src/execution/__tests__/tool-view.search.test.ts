// Covers search normalization's envelope handling: the Cursor SDK returns search
// results as a stringified JSON envelope (file-name search via {status,value} and
// grep/codebase search via {workspaceResults}), which the original parser dumped
// as a single fake "match". The cross-language fixture (result-views.json)
// asserts the happy-path `type`/`count`; these cover the `kind`/`truncated`
// presentation hints, the multi-workspace flatten, the content-match mapping, and
// the unrecognized-JSON -> json degradation that is not a shared scalar fact.

import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ToolCallStatus,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { normalizeToolResult } from "../tool-view";

function searchCall(args: Record<string, unknown>, result: string) {
  return create(ToolCallSchema, {
    id: "tc-search",
    name: "Grep",
    toolKind: ToolKind.SEARCH,
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    args: args as JsonObject,
    result,
  });
}

describe("normalizeToolResult — Cursor file-name search envelope", () => {
  it("unwraps an empty {status,value} file search (the reported bug: not '1 match')", () => {
    const view = normalizeToolResult(
      searchCall(
        { pattern: "**/*.nope" },
        JSON.stringify({
          status: "success",
          value: { files: [], totalFiles: 0, clientTruncated: false, ripgrepTruncated: false },
        }),
      ),
    );
    expect(view.type).toBe("search");
    if (view.type !== "search") return;
    expect(view.kind).toBe("files");
    expect(view.count).toBe(0);
    expect(view.matches).toHaveLength(0);
    expect(view.truncated).toBe(false);
  });

  it("unwraps a non-empty file search into clickable file matches", () => {
    const view = normalizeToolResult(
      searchCall(
        { pattern: "Dockerfile" },
        JSON.stringify({
          status: "success",
          value: { files: ["Dockerfile"], totalFiles: 1, clientTruncated: false, ripgrepTruncated: false },
        }),
      ),
    );
    expect(view.type).toBe("search");
    if (view.type !== "search") return;
    expect(view.kind).toBe("files");
    expect(view.count).toBe(1);
    // Both file and text are set so a kind-unaware consumer still shows the path.
    expect(view.matches[0]).toEqual({ file: "Dockerfile", text: "Dockerfile" });
  });

  it("carries the engine's truncation flags and authoritative totalFiles", () => {
    const view = normalizeToolResult(
      searchCall(
        { pattern: "*.ts" },
        JSON.stringify({
          status: "success",
          value: { files: ["a.ts", "b.ts"], totalFiles: 200, clientTruncated: true, ripgrepTruncated: false },
        }),
      ),
    );
    expect(view.type).toBe("search");
    if (view.type !== "search") return;
    // totalFiles is authoritative and can exceed the returned page.
    expect(view.count).toBe(200);
    expect(view.matches).toHaveLength(2);
    expect(view.truncated).toBe(true);
  });
});

describe("normalizeToolResult — Cursor grep workspaceResults envelope", () => {
  it("unwraps the real {status,value:{workspaceResults}} grep shape (the reported bug)", () => {
    // The grep payload nests workspaceResults INSIDE the {status,value} envelope —
    // the shape the runner actually persists. The original parser only looked at
    // the top level, so this fell through to a raw JSON dump.
    const view = normalizeToolResult(
      searchCall(
        { pattern: "pipeline" },
        JSON.stringify({
          status: "success",
          value: {
            workspaceResults: {
              "/work/demo": { type: "files", output: { files: [], count: 0 } },
            },
          },
        }),
      ),
    );
    expect(view.type).toBe("search");
    if (view.type !== "search") return;
    expect(view.kind).toBe("files");
    expect(view.count).toBe(0);
  });

  it("still reads an un-enveloped top-level workspaceResults (defensive)", () => {
    const view = normalizeToolResult(
      searchCall(
        { pattern: "pipeline" },
        JSON.stringify({
          workspaceResults: { "/work/demo": { type: "files", output: { files: [], count: 0 } } },
        }),
      ),
    );
    expect(view.type).toBe("search");
    if (view.type !== "search") return;
    expect(view.kind).toBe("files");
    expect(view.count).toBe(0);
  });

  it("flattens file matches across multiple workspaces and sums reported counts", () => {
    const view = normalizeToolResult(
      searchCall(
        { pattern: "TODO" },
        JSON.stringify({
          status: "success",
          value: {
            workspaceResults: {
              "/work/a": { type: "files", output: { files: ["a/x.ts"], count: 1 } },
              "/work/b": { type: "files", output: { files: ["b/y.ts"], count: 1 } },
            },
          },
        }),
      ),
    );
    expect(view.type).toBe("search");
    if (view.type !== "search") return;
    expect(view.kind).toBe("files");
    expect(view.count).toBe(2);
    expect(view.matches.map((m) => m.file)).toEqual(["a/x.ts", "b/y.ts"]);
  });

  it("renders a non-empty grep (type:files) as a file list, not 0 files", () => {
    // The real wrapped shape with results present — proves a populated grep is
    // shown (the user's concern that a non-empty response might render as empty).
    const view = normalizeToolResult(
      searchCall(
        { pattern: "pipeline" },
        JSON.stringify({
          status: "success",
          value: {
            workspaceResults: {
              "/work/demo": {
                type: "files",
                output: { files: [".tekton/pipeline.yaml", "README.md"], count: 2 },
              },
            },
          },
        }),
      ),
    );
    expect(view.type).toBe("search");
    if (view.type !== "search") return;
    expect(view.kind).toBe("files");
    expect(view.count).toBe(2);
    expect(view.matches.map((m) => m.file)).toEqual([".tekton/pipeline.yaml", "README.md"]);
  });

  it("falls back to JSON (never hides data) when a count is reported but nothing extracts", () => {
    // Shape drift: the engine says count:5 but the matches live under a key we
    // don't recognise. Surfacing the raw JSON beats a misleading "No matches".
    const view = normalizeToolResult(
      searchCall(
        { pattern: "x" },
        JSON.stringify({
          status: "success",
          value: {
            workspaceResults: {
              "/work/demo": { type: "weird", output: { hits: ["a", "b"], count: 5 } },
            },
          },
        }),
      ),
    );
    expect(view.type).toBe("json");
  });

  it("falls back to JSON when a file search reports totalFiles but no extractable paths", () => {
    // files are objects, not strings (a drift) — but totalFiles says 3.
    const view = normalizeToolResult(
      searchCall(
        { pattern: "*.ts" },
        JSON.stringify({
          status: "success",
          value: { files: [{ path: "a.ts" }], totalFiles: 3 },
        }),
      ),
    );
    expect(view.type).toBe("json");
  });

  it("maps line-bearing matches into grouped content matches", () => {
    const view = normalizeToolResult(
      searchCall(
        { pattern: "TODO" },
        JSON.stringify({
          status: "success",
          value: {
            workspaceResults: {
              "/work/a": {
                type: "matches",
                output: {
                  matches: [
                    { file: "a/x.ts", line: 12, text: "// TODO: fix" },
                    { file: "a/x.ts", line: 30, text: "// TODO: later" },
                  ],
                  count: 2,
                },
              },
            },
          },
        }),
      ),
    );
    expect(view.type).toBe("search");
    if (view.type !== "search") return;
    expect(view.kind).toBe("content");
    expect(view.count).toBe(2);
    expect(view.matches[0]).toEqual({ file: "a/x.ts", line: 12, text: "// TODO: fix" });
  });
});

describe("normalizeToolResult — search plain text and graceful degradation", () => {
  it("keeps native grep line matches as content (unchanged behavior)", () => {
    const view = normalizeToolResult(
      searchCall(
        { pattern: "TODO" },
        "\n/workspace/a.go:\n  12: // TODO: fix\n/workspace/b.go:\n  7: // TODO: later",
      ),
    );
    expect(view.type).toBe("search");
    if (view.type !== "search") return;
    expect(view.kind).toBe("content");
    expect(view.count).toBe(2);
  });

  it("treats native path/name lines as file matches", () => {
    const view = normalizeToolResult(searchCall({ pattern: "*.go" }, "src/a.go\nsrc/b.go"));
    expect(view.type).toBe("search");
    if (view.type !== "search") return;
    expect(view.kind).toBe("files");
    expect(view.count).toBe(2);
  });

  it("degrades an unrecognized JSON shape to a json view, not a fake match", () => {
    const view = normalizeToolResult(
      searchCall({ pattern: "x" }, JSON.stringify({ somethingElse: true })),
    );
    expect(view.type).toBe("json");
  });
});
