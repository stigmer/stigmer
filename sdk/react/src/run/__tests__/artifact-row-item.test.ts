import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/artifact_pb";
import { RunArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  fromRunArtifact,
  parentDirectory,
} from "../artifact-row-item";

// ---------------------------------------------------------------------------
// fromRunArtifact — the session model adapter
// ---------------------------------------------------------------------------

describe("fromRunArtifact", () => {
  it("maps name, size, and sandbox-path tooltip", () => {
    const artifact = create(RunArtifactSchema, {
      name: "notes.md",
      kind: RunArtifactKind.FILE,
      sizeBytes: 2048n,
      sandboxPath: "/workspace/docs/notes.md",
    });
    const item = fromRunArtifact(artifact);
    expect(item.name).toBe("notes.md");
    expect(item.tooltip).toBe("/workspace/docs/notes.md");
    expect(item.sizeBytes).toBe(2048n);
    expect(item.isDirectory).toBe(false);
    expect(item.subtitlePath).toBeNull();
  });

  it("falls back to the name as tooltip when there is no sandbox path", () => {
    const artifact = create(RunArtifactSchema, { name: "out.txt" });
    expect(fromRunArtifact(artifact).tooltip).toBe("out.txt");
  });

  it("marks DIRECTORY artifacts as directories", () => {
    const artifact = create(RunArtifactSchema, {
      name: "skill-pack",
      kind: RunArtifactKind.DIRECTORY,
    });
    expect(fromRunArtifact(artifact).isDirectory).toBe(true);
  });

  it("carries the parent directory as subtitle only on a name collision", () => {
    const artifact = create(RunArtifactSchema, {
      name: "agent.yaml",
      sandboxPath: "/workspace/configs/agent.yaml",
    });
    expect(fromRunArtifact(artifact, true).subtitlePath).toBe("configs/");
    expect(fromRunArtifact(artifact, false).subtitlePath).toBeNull();
  });

  it("omits the subtitle on collision when there is no sandbox path to derive from", () => {
    const artifact = create(RunArtifactSchema, { name: "agent.yaml" });
    expect(fromRunArtifact(artifact, true).subtitlePath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parentDirectory
// ---------------------------------------------------------------------------

describe("parentDirectory", () => {
  it("returns the immediate parent segment with a trailing slash", () => {
    expect(parentDirectory("/workspace/configs/agent.yaml")).toBe("configs/");
    expect(parentDirectory("a/b/c.txt")).toBe("b/");
  });

  it("returns null for paths without a meaningful parent", () => {
    expect(parentDirectory("agent.yaml")).toBeNull();
    expect(parentDirectory("/agent.yaml")).toBeNull();
    expect(parentDirectory("")).toBeNull();
  });
});
