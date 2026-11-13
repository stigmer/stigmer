/**
 * The output File body's states: loading, a failed read through the kit's
 * ErrorMessage (with Try again when the host can read again), nothing to
 * preview through the kit's EmptyState, and rendered text.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

  it("says a failed read through ErrorMessage, with Try again that reads again", () => {
    const onRetry = vi.fn();
    render(
      <FileBody
        file={outputFile("notes.txt")}
        content={null}
        contentType={null}
        isLoading={false}
        error={new Error("boom")}
        isTruncated={false}
        onRetry={onRetry}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the file.");
    expect(alert.textContent).toContain("boom");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers no Try again on a failed read when the host cannot read again", () => {
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
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load the file.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says there is nothing to preview through EmptyState when content is null and settled", () => {
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
    const empty = screen.getByRole("status");
    expect(empty.textContent).toBe("Content not available for preview.");
    // EmptyState's panel: its faint card and the icon in a muted square.
    expect(empty.className.split(" ")).toContain("stg:bg-muted-faint");
    expect(empty.querySelector(".stg\\:size-10.stg\\:bg-muted svg")).toBeTruthy();
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
