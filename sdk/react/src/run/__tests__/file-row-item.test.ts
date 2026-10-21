/**
 * The File row's view-model, mapped from a File a turn returned: the
 * filename, the size, the output path as tooltip, and the path's folder as a
 * subtitle only when two rows share a filename.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { fromFile, parentDirectory } from "../file-row-item";

function output(filename: string, outputPath: string, sizeBytes = 0n) {
  return create(FileSchema, { spec: { filename }, status: { runId: "r1", outputPath, sizeBytes } });
}

describe("fromFile", () => {
  it("maps filename, size, and output-path tooltip", () => {
    const item = fromFile(output("notes.md", "docs/notes.md", 2048n));
    expect(item.name).toBe("notes.md");
    expect(item.tooltip).toBe("docs/notes.md");
    expect(item.sizeBytes).toBe(2048n);
    expect(item.subtitlePath).toBeNull();
  });

  it("falls back to the filename as tooltip when there is no output path", () => {
    expect(fromFile(output("out.txt", "")).tooltip).toBe("out.txt");
  });

  it("carries the output path's folder as subtitle only on a name collision", () => {
    const file = output("agent.yaml", "configs/agent.yaml");
    expect(fromFile(file, true).subtitlePath).toBe("configs/");
    expect(fromFile(file, false).subtitlePath).toBeNull();
  });

  it("omits the subtitle on collision when the File sits at the folder's top", () => {
    expect(fromFile(output("agent.yaml", "agent.yaml"), true).subtitlePath).toBeNull();
  });
});

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
