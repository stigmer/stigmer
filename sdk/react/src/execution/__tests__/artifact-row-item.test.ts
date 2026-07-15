import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import {
  fromExecutionArtifact,
  fromArtifact,
  parentDirectory,
} from "../artifact-row-item";

// ---------------------------------------------------------------------------
// fromExecutionArtifact — the session model adapter
// ---------------------------------------------------------------------------

describe("fromExecutionArtifact", () => {
  it("maps name, size, and sandbox-path tooltip", () => {
    const artifact = create(ExecutionArtifactSchema, {
      name: "notes.md",
      kind: ExecutionArtifactKind.FILE,
      sizeBytes: 2048n,
      sandboxPath: "/workspace/docs/notes.md",
    });
    const item = fromExecutionArtifact(artifact);
    expect(item.name).toBe("notes.md");
    expect(item.tooltip).toBe("/workspace/docs/notes.md");
    expect(item.sizeBytes).toBe(2048n);
    expect(item.isDirectory).toBe(false);
    expect(item.subtitlePath).toBeNull();
  });

  it("falls back to the name as tooltip when there is no sandbox path", () => {
    const artifact = create(ExecutionArtifactSchema, { name: "out.txt" });
    expect(fromExecutionArtifact(artifact).tooltip).toBe("out.txt");
  });

  it("marks DIRECTORY artifacts as directories", () => {
    const artifact = create(ExecutionArtifactSchema, {
      name: "skill-pack",
      kind: ExecutionArtifactKind.DIRECTORY,
    });
    expect(fromExecutionArtifact(artifact).isDirectory).toBe(true);
  });

  it("carries the parent directory as subtitle only on a name collision", () => {
    const artifact = create(ExecutionArtifactSchema, {
      name: "agent.yaml",
      sandboxPath: "/workspace/configs/agent.yaml",
    });
    expect(fromExecutionArtifact(artifact, true).subtitlePath).toBe("configs/");
    expect(fromExecutionArtifact(artifact, false).subtitlePath).toBeNull();
  });

  it("omits the subtitle on collision when there is no sandbox path to derive from", () => {
    const artifact = create(ExecutionArtifactSchema, { name: "agent.yaml" });
    expect(fromExecutionArtifact(artifact, true).subtitlePath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fromArtifact — the workflow Artifact-resource adapter
// ---------------------------------------------------------------------------

describe("fromArtifact", () => {
  it("maps displayName, status size, and is never a directory", () => {
    const artifact = create(ArtifactSchema, {
      metadata: { id: "art_1", name: "fallback" },
      spec: { displayName: "report.json", contentType: "application/json" },
      status: { sizeBytes: 4096n },
    });
    const item = fromArtifact(artifact);
    expect(item.name).toBe("report.json");
    expect(item.tooltip).toBe("report.json");
    expect(item.sizeBytes).toBe(4096n);
    // The Artifact resource model has no directory concept.
    expect(item.isDirectory).toBe(false);
  });

  it("falls back to metadata name, then 'Unnamed'", () => {
    const withMeta = create(ArtifactSchema, {
      metadata: { id: "art_2", name: "meta-name" },
    });
    expect(fromArtifact(withMeta).name).toBe("meta-name");
    expect(fromArtifact(create(ArtifactSchema, {})).name).toBe("Unnamed");
  });

  it("defaults size to zero when status is absent", () => {
    const artifact = create(ArtifactSchema, {
      spec: { displayName: "x.txt" },
    });
    expect(fromArtifact(artifact).sizeBytes).toBe(0n);
  });

  it("carries the producing task as subtitle only on a name collision", () => {
    const artifact = create(ArtifactSchema, {
      spec: {
        displayName: "output.json",
        source: { workflowExecutionId: "wex_1", taskName: "analyze_code" },
      },
    });
    expect(fromArtifact(artifact, true).subtitlePath).toBe("analyze_code");
    expect(fromArtifact(artifact, false).subtitlePath).toBeNull();
  });

  it("omits the subtitle on collision when the artifact has no source task", () => {
    const artifact = create(ArtifactSchema, {
      spec: { displayName: "output.json" },
    });
    expect(fromArtifact(artifact, true).subtitlePath).toBeNull();
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
