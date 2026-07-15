import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { deriveWorkflowArtifactItems } from "../deriveWorkflowArtifactItems";

function artifact(id: string, displayName: string, taskName = "") {
  return create(ArtifactSchema, {
    metadata: { id, name: displayName },
    spec: {
      displayName,
      contentType: "application/json",
      source: { workflowExecutionId: "wex_1", taskName },
    },
    status: { sizeBytes: 100n },
  });
}

describe("deriveWorkflowArtifactItems", () => {
  it("returns an empty list for no artifacts", () => {
    expect(deriveWorkflowArtifactItems([])).toEqual([]);
  });

  it("sorts alphabetically by display name, case-insensitive", () => {
    const entries = deriveWorkflowArtifactItems([
      artifact("art_1", "zeta.json"),
      artifact("art_2", "Alpha.json"),
      artifact("art_3", "beta.json"),
    ]);
    expect(entries.map((e) => e.item.name)).toEqual([
      "Alpha.json",
      "beta.json",
      "zeta.json",
    ]);
  });

  it("does not deduplicate — every immutable Artifact record is a distinct row", () => {
    const entries = deriveWorkflowArtifactItems([
      artifact("art_1", "output.json", "task_a"),
      artifact("art_2", "output.json", "task_b"),
    ]);
    expect(entries).toHaveLength(2);
  });

  it("flags name collisions with the producing task as subtitle", () => {
    const entries = deriveWorkflowArtifactItems([
      artifact("art_1", "output.json", "task_a"),
      artifact("art_2", "output.json", "task_b"),
      artifact("art_3", "unique.json", "task_c"),
    ]);
    const subtitles = new Map(
      entries.map((e) => [e.artifact.metadata?.id, e.item.subtitlePath]),
    );
    expect(subtitles.get("art_1")).toBe("task_a");
    expect(subtitles.get("art_2")).toBe("task_b");
    expect(subtitles.get("art_3")).toBeNull();
  });

  it("treats display-name collisions case-insensitively", () => {
    const entries = deriveWorkflowArtifactItems([
      artifact("art_1", "Report.md", "task_a"),
      artifact("art_2", "report.md", "task_b"),
    ]);
    expect(entries.every((e) => e.item.subtitlePath !== null)).toBe(true);
  });

  it("does not mutate the input array's order", () => {
    const input = [artifact("art_1", "zeta.json"), artifact("art_2", "alpha.json")];
    deriveWorkflowArtifactItems(input);
    expect(input[0].metadata?.id).toBe("art_1");
  });
});
