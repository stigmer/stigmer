// Covers search normalization's presentation hints: the `kind` of a plain-text
// search answer (content lines vs file paths), and the JSON -> json
// degradation that keeps an unrecognized answer readable instead of wrapping it
// as a single fake match. The cross-language fixture (result-views.json)
// asserts the shared `type`/`count`; `kind` is surface-local.

import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { toolUseOf } from "./tool-use.js";
import { normalizeToolResult } from "../tool-view";

function searchCall(args: Record<string, unknown>, result: string) {
  return toolUseOf({
    id: "tc-search",
    name: "Grep",
    status: "completed",
    args: args as JsonObject,
    result,
  });
}

describe("normalizeToolResult — search plain text and graceful degradation", () => {
  it("keeps Stigmer-harness grep line matches as content (unchanged behavior)", () => {
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

  it("reads each harness match as its file, line and text, the file from the header above it", () => {
    const view = normalizeToolResult(
      searchCall({ pattern: "TODO" }, "/workspace/a.go:\n  12: // TODO: fix\n/workspace/b.go:\n  7: // TODO: later"),
    );
    if (view.type !== "search") throw new Error(`expected a search view, got ${view.type}`);
    expect(view.matches).toEqual([
      { file: "/workspace/a.go", line: 12, text: "// TODO: fix" },
      { file: "/workspace/b.go", line: 7, text: "// TODO: later" },
    ]);
  });

  it("reads ripgrep's path:line:text lines as content matches, one per line, not as files", () => {
    const view = normalizeToolResult(searchCall({ pattern: "x" }, "src/a.ts:1: x\nsrc/b.ts:14:const x = 1;"));
    if (view.type !== "search") throw new Error(`expected a search view, got ${view.type}`);
    expect(view.kind).toBe("content");
    expect(view.count).toBe(2);
    expect(view.matches).toEqual([
      { file: "src/a.ts", line: 1, text: "x" },
      { file: "src/b.ts", line: 14, text: "const x = 1;" },
    ]);
  });

  it("treats Stigmer-harness path/name lines as file matches", () => {
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
