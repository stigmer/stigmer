import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { StigmerContext } from "../../context";
import { WorkflowArtifactsTab } from "../facets/WorkflowArtifactsTab";

function artifact(id: string, displayName: string) {
  return create(ArtifactSchema, {
    metadata: { id, name: displayName },
    spec: { displayName, contentType: "application/json" },
    status: { sizeBytes: 2048n },
  });
}

const getDownloadUrl = vi.fn().mockResolvedValue({ url: "" });

function createStigmerMock(): Stigmer {
  return { artifact: { getDownloadUrl } } as unknown as Stigmer;
}

function renderTab(
  overrides: Partial<React.ComponentProps<typeof WorkflowArtifactsTab>> = {},
) {
  const onOpen = vi.fn();
  render(
    <StigmerContext.Provider value={createStigmerMock()}>
      <WorkflowArtifactsTab
        artifacts={[artifact("art_1", "report.json")]}
        onOpen={onOpen}
        {...overrides}
      />
    </StigmerContext.Provider>,
  );
  return { onOpen };
}

afterEach(() => {
  cleanup();
  getDownloadUrl.mockClear();
});

describe("WorkflowArtifactsTab", () => {
  it("shows the empty state when the execution has no artifacts", () => {
    renderTab({ artifacts: [] });
    expect(
      screen.getByText(
        "No artifacts yet. Files produced by workflow tasks will appear here.",
      ),
    ).toBeTruthy();
  });

  it("renders one row per artifact, sorted alphabetically", () => {
    renderTab({
      artifacts: [artifact("art_1", "zeta.json"), artifact("art_2", "alpha.json")],
    });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("alpha.json");
    expect(items[1].textContent).toContain("zeta.json");
  });

  it("fires onOpen with the full Artifact record on row click", () => {
    const { onOpen } = renderTab();
    fireEvent.click(screen.getByText("report.json"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].metadata?.id).toBe("art_1");
  });

  it("fires onActivate on double-click when provided", () => {
    const onActivate = vi.fn();
    renderTab({ onActivate });
    fireEvent.doubleClick(screen.getByText("report.json"));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0][0].metadata?.id).toBe("art_1");
  });

  it("mints a download URL by artifact id on the row's Download control", () => {
    renderTab();
    fireEvent.click(screen.getByLabelText("Download report.json"));
    expect(getDownloadUrl).toHaveBeenCalledTimes(1);
    expect(getDownloadUrl.mock.calls[0][0]).toBe("art_1");
  });
});
