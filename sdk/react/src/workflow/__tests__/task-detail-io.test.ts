import { describe, it, expect } from "vitest";
import type { JsonObject } from "@bufbuild/protobuf";
import { buildIO } from "../task-detail/task-detail-io";

// ---------------------------------------------------------------------------
// The canonical I/O fallback ladder the thread card bodies render from:
// full snapshot value → truncated event summary → null. Coverage ported
// from the retired inspector's derive-task-detail suite (T06) — the ladder
// itself survived the inspector.
// ---------------------------------------------------------------------------

describe("buildIO — fallback ladder", () => {
  it("prefers the full snapshot value, carrying the summary and artifacts", () => {
    const io = buildIO(
      { full: "data" } as JsonObject,
      { truncated: "summary" } as JsonObject,
      ["a1"],
    );
    expect(io).not.toBeNull();
    expect(io!.source).toBe("snapshot");
    expect(io!.data).toEqual({ full: "data" });
    expect(io!.summary).toEqual({ truncated: "summary" });
    expect(io!.artifactIds).toEqual(["a1"]);
  });

  it("falls back to the truncated event summary when the snapshot has no data", () => {
    const io = buildIO(undefined, { truncated: "input data" } as JsonObject, []);
    expect(io).not.toBeNull();
    expect(io!.source).toBe("event-summary");
    expect(io!.data).toEqual({ truncated: "input data" });
  });

  it("treats an empty snapshot object as no data", () => {
    expect(buildIO({} as JsonObject, null, [])).toBeNull();
  });

  it("returns null when neither source has data", () => {
    expect(buildIO(undefined, null, [])).toBeNull();
  });
});
