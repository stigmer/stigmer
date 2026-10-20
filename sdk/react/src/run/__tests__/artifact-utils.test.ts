/**
 * isTextArtifact decides whether a File's content is read as text: a `text/*`
 * media type always is; otherwise the filename's extension decides, matched
 * case-insensitively against the known text ones.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { isTextArtifact } from "../artifact-utils";

function file(filename: string, mimeType = "") {
  return create(FileSchema, { spec: { filename, mimeType } });
}

describe("isTextArtifact", () => {
  it("treats a text media type as text, whatever the name", () => {
    expect(isTextArtifact(file("NOTES", "text/plain"))).toBe(true);
  });

  it("treats a file with a known text extension as text, in any case", () => {
    expect(isTextArtifact(file("agent.yaml"))).toBe(true);
    expect(isTextArtifact(file("README.MD"))).toBe(true);
  });

  it("refuses a file with no extension or an unknown one", () => {
    expect(isTextArtifact(file("Makefile"))).toBe(false);
    expect(isTextArtifact(file("photo.png", "image/png"))).toBe(false);
  });
});
