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
