import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import { ArtifactRow } from "../ArtifactRow";

function fileArtifact(name: string, sandboxPath = `.stigmer/${name}`) {
  return create(ExecutionArtifactSchema, {
    name,
    kind: ExecutionArtifactKind.FILE,
    sizeBytes: 2048n,
    sandboxPath,
    storageKey: `artifacts/aex_1/${name}`,
  });
}

function dirArtifact(name: string) {
  return create(ExecutionArtifactSchema, {
    name,
    kind: ExecutionArtifactKind.DIRECTORY,
    sizeBytes: 4096n,
    sandboxPath: `.stigmer/${name}`,
    storageKey: `artifacts/aex_1/${name}`,
  });
}

const getArtifactDownloadUrl = vi.fn().mockResolvedValue({ downloadUrl: "" });

function createStigmerMock(): Stigmer {
  return {
    agentExecution: { getArtifactDownloadUrl },
  } as unknown as Stigmer;
}

function renderRow(props: Partial<Parameters<typeof ArtifactRow>[0]> = {}) {
  const merged = {
    artifact: fileArtifact("notes.md"),
    executionId: "aex_1",
    onOpen: vi.fn(),
    ...props,
  } as Parameters<typeof ArtifactRow>[0];
  return render(
    <StigmerContext.Provider value={createStigmerMock()}>
      <ul>
        <ArtifactRow {...merged} />
      </ul>
    </StigmerContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  getArtifactDownloadUrl.mockClear();
});

describe("ArtifactRow — presentation", () => {
  it("renders a file-type icon, the name, and the formatted size", () => {
    renderRow({ artifact: fileArtifact("notes.md") });
    const open = screen.getByText("notes.md").closest("button")!;
    expect(open.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("appends a trailing slash for a directory artifact", () => {
    renderRow({ artifact: dirArtifact("return-policy") });
    // The name span's own text is "return-policy" + "/".
    expect(screen.getByText("return-policy/")).toBeTruthy();
  });

  it("shows the parent-directory subtitle only on a name collision", () => {
    const artifact = fileArtifact("agent.yaml", "/workspace/configs/agent.yaml");
    const { rerender } = renderRow({ artifact, hasNameCollision: true });
    expect(screen.getByText("configs/")).toBeTruthy();

    rerender(
      <StigmerContext.Provider value={createStigmerMock()}>
        <ul>
          <ArtifactRow artifact={artifact} executionId="aex_1" onOpen={vi.fn()} />
        </ul>
      </StigmerContext.Provider>,
    );
    expect(screen.queryByText("configs/")).toBeNull();
  });
});

describe("ArtifactRow — nested-interactive avoidance (DD-22)", () => {
  it("renders the Download control as a SIBLING of the open button, never nested", () => {
    renderRow({ artifact: fileArtifact("notes.md") });
    const open = screen.getByText("notes.md").closest("button")!;
    const download = screen.getByLabelText("Download notes.md");
    expect(download.tagName).toBe("BUTTON");
    // A <button> inside a <button> is a WCAG 4.1.2 nested-interactive violation.
    expect(open.contains(download)).toBe(false);
  });
});

describe("ArtifactRow — open / activate interaction (file-tree parity)", () => {
  it("fires onOpen on a single click of the open target", () => {
    const onOpen = vi.fn();
    renderRow({ onOpen });
    fireEvent.click(screen.getByText("notes.md"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("fires onActivate on a double-click when provided", () => {
    const onActivate = vi.fn();
    renderRow({ onActivate });
    fireEvent.doubleClick(screen.getByText("notes.md"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("binds no double-click handler when onActivate is omitted (harmless)", () => {
    const onOpen = vi.fn();
    renderRow({ onOpen });
    // With no onActivate, a dblclick fires nothing (onOpen only responds to click).
    fireEvent.doubleClick(screen.getByText("notes.md"));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("ArtifactRow — download", () => {
  it("mints a download URL for the artifact's storage key on Download click", () => {
    renderRow({ artifact: fileArtifact("notes.md") });
    fireEvent.click(screen.getByLabelText("Download notes.md"));
    expect(getArtifactDownloadUrl).toHaveBeenCalledTimes(1);
    expect(getArtifactDownloadUrl.mock.calls[0][0]).toMatchObject({
      executionId: "aex_1",
      storageKey: "artifacts/aex_1/notes.md",
    });
  });

  it("renders the directory Download control with no native title", () => {
    renderRow({ artifact: dirArtifact("return-policy") });
    // The "Download ZIP" copy moved to the house tooltip (native titles
    // are banned — stigmer-cloud#268); its reveal is pinned in the
    // real-browser suite (artifact-row-tooltips.layout.test.tsx).
    expect(screen.getByLabelText("Download return-policy")).toBeTruthy();
    expect(document.querySelector("[title]")).toBeNull();
  });
});
