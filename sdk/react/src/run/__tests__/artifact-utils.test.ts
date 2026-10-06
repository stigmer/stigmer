/**
 * isTextArtifact decides whether an artifact's content is fetched as text: a
 * directory artifact (stored as a ZIP) never is, whatever its name; a file is
 * when its extension is a known text one, matched case-insensitively.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/artifact_pb";
import { RunArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { isTextArtifact } from "../artifact-utils";

function artifact(name: string, kind: RunArtifactKind) {
  return create(RunArtifactSchema, { name, kind });
}

describe("isTextArtifact", () => {
  it("never treats a directory artifact as text, even with a text-like name", () => {
    expect(isTextArtifact(artifact("notes.md", RunArtifactKind.DIRECTORY))).toBe(false);
  });

  it("treats a file with a known text extension as text, in any case", () => {
    expect(isTextArtifact(artifact("agent.yaml", RunArtifactKind.FILE))).toBe(true);
    expect(isTextArtifact(artifact("README.MD", RunArtifactKind.FILE))).toBe(true);
  });

  it("refuses a file with no extension or an unknown one", () => {
    expect(isTextArtifact(artifact("Makefile", RunArtifactKind.FILE))).toBe(false);
    expect(isTextArtifact(artifact("photo.png", RunArtifactKind.FILE))).toBe(false);
  });
});
