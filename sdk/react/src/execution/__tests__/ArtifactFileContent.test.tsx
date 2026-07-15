import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ArtifactFileContent } from "../ArtifactFileContent";

function renderContent(
  overrides: Partial<React.ComponentProps<typeof ArtifactFileContent>> = {},
) {
  return render(
    <ArtifactFileContent
      fileName="notes.txt"
      content={null}
      contentType={null}
      isLoading={false}
      error={null}
      isTruncated={false}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("ArtifactFileContent — state machine", () => {
  it("shows the loading skeleton while the fetch is in flight", () => {
    renderContent({ isLoading: true });
    expect(screen.getByLabelText("Loading content")).toBeTruthy();
  });

  it("shows the error message when the fetch failed", () => {
    renderContent({ error: new Error("storage unreachable") });
    expect(screen.getByText("storage unreachable")).toBeTruthy();
  });

  it("shows the honest unavailable state for null content (binary / unfetched)", () => {
    renderContent({ content: null });
    expect(screen.getByText("Content not available for preview.")).toBeTruthy();
  });

  it("renders text content through the shared renderer", () => {
    renderContent({ content: "hello world", contentType: "text/plain" });
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("surfaces the truncation notice for truncated content", () => {
    renderContent({
      content: "partial…",
      contentType: "text/plain",
      isTruncated: true,
    });
    // ArtifactContentRenderer owns the truncation copy; assert its presence
    // rather than exact wording so this test tracks behavior, not prose.
    expect(screen.getByText(/truncated/i)).toBeTruthy();
  });

  it("loading wins over stale content (no content flash during refetch)", () => {
    renderContent({ content: "old body", isLoading: true });
    expect(screen.getByLabelText("Loading content")).toBeTruthy();
    expect(screen.queryByText("old body")).toBeNull();
  });
});
