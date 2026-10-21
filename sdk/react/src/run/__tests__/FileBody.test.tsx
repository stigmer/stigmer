/**
 * The output File body's states: loading, error, binary (unavailable) and
 * rendered text.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileBody } from "../FileBody";

function outputFile(filename: string) {
  return create(FileSchema, { spec: { filename }, status: { sizeBytes: 64n, runId: "r1" } });
}

afterEach(cleanup);

describe("FileBody — file states", () => {
  it("renders a loading skeleton", () => {
    render(
      <FileBody
        file={outputFile("notes.txt")}
        content={null}
        contentType={null}
        isLoading
        error={null}
        isTruncated={false}
      />,
    );
    expect(screen.getByText("Loading content")).toBeTruthy();
  });

  it("renders an error message", () => {
    render(
      <FileBody
        file={outputFile("notes.txt")}
        content={null}
        contentType={null}
        isLoading={false}
        error={new Error("boom")}
        isTruncated={false}
      />,
    );
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("renders the binary / unavailable state when content is null and settled", () => {
    render(
      <FileBody
        file={outputFile("image.bin")}
        content={null}
        contentType={null}
        isLoading={false}
        error={null}
        isTruncated={false}
      />,
    );
    expect(screen.getByText(/Content not available for preview/)).toBeTruthy();
  });

  it("renders text content", () => {
    render(
      <FileBody
        file={outputFile("notes.txt")}
        content={"hello from the file"}
        contentType={"text/plain"}
        isLoading={false}
        error={null}
        isTruncated={false}
      />,
    );
    expect(screen.getByText(/hello from the file/)).toBeTruthy();
  });
});
