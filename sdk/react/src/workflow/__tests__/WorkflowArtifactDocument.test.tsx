import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { StigmerContext } from "../../context";
import { WorkflowArtifactDocument } from "../WorkflowArtifactDocument";

function artifact(displayName: string, contentType: string) {
  return create(ArtifactSchema, {
    metadata: { id: "art_1", name: displayName },
    spec: { displayName, contentType },
    status: { sizeBytes: 2048n },
  });
}

function contentResponse(text: string, overrides: Record<string, unknown> = {}) {
  return {
    content: new TextEncoder().encode(text),
    contentType: "application/json",
    totalSizeBytes: BigInt(text.length),
    truncated: false,
    ...overrides,
  };
}

function renderDocument(
  props: React.ComponentProps<typeof WorkflowArtifactDocument>,
  getContent = vi.fn().mockResolvedValue(contentResponse("{}")),
) {
  const stigmer = {
    artifact: {
      getContent,
      getDownloadUrl: vi.fn().mockResolvedValue({ url: "" }),
    },
  } as unknown as Stigmer;
  render(
    <StigmerContext.Provider value={stigmer}>
      <WorkflowArtifactDocument {...props} />
    </StigmerContext.Provider>,
  );
  return { getContent };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkflowArtifactDocument", () => {
  it("renders the toolbar identity: name, size, and content type", async () => {
    renderDocument({ artifact: artifact("report.json", "application/json") });
    expect(screen.getByText("report.json")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.getByText("application/json")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByLabelText("Loading content")).toBeNull(),
    );
  });

  it("fetches and renders text content for a text content type", async () => {
    const { getContent } = renderDocument(
      { artifact: artifact("report.json", "application/json") },
      vi.fn().mockResolvedValue(contentResponse('{"total": 42}')),
    );
    await waitFor(() => expect(screen.getByText(/"total"/)).toBeTruthy());
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(getContent.mock.calls[0][0]).toMatchObject({ artifactId: "art_1" });
    // Content in memory → the Copy affordance appears.
    expect(screen.getByLabelText("Copy content")).toBeTruthy();
  });

  it("never fetches binary content types — honest preview-unavailable body, download escape hatch", () => {
    const { getContent } = renderDocument({
      artifact: artifact("archive.bin", "application/octet-stream"),
    });
    expect(getContent).not.toHaveBeenCalled();
    expect(screen.getByText("Content not available for preview.")).toBeTruthy();
    expect(screen.queryByLabelText("Copy content")).toBeNull();
    expect(screen.getByText("Download")).toBeTruthy();
  });

  it("surfaces a content-fetch error in the body", async () => {
    renderDocument(
      { artifact: artifact("report.json", "application/json") },
      vi.fn().mockRejectedValue(new Error("blob deleted")),
    );
    await waitFor(() => expect(screen.getByText("blob deleted")).toBeTruthy());
  });
});
