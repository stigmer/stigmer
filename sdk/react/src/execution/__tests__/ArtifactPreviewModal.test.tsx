import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import { ArtifactPreviewContent } from "../ArtifactPreviewModal";

// A non-text artifact: ArtifactPreviewContent skips the content fetch, so the
// test exercises the Implement action without any network mocking.
const binaryArtifact = create(ExecutionArtifactSchema, {
  name: "report.bin",
  kind: ExecutionArtifactKind.FILE,
  sizeBytes: 128n,
  storageKey: "artifacts/aex_1/report.bin",
});

function withStigmer(children: ReactNode) {
  const client = {} as unknown as Stigmer;
  return (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
}

afterEach(cleanup);

describe("ArtifactPreviewContent — Build action", () => {
  it("renders a 'Build' button only when onImplement is provided", () => {
    const { rerender } = render(
      withStigmer(
        <ArtifactPreviewContent
          artifact={binaryArtifact}
          executionId="aex_1"
          org="acme"
          isTerminal
          onClose={() => {}}
        />,
      ),
    );
    expect(screen.queryByText("Build")).toBeNull();

    rerender(
      withStigmer(
        <ArtifactPreviewContent
          artifact={binaryArtifact}
          executionId="aex_1"
          org="acme"
          isTerminal
          onClose={() => {}}
          onImplement={() => {}}
        />,
      ),
    );
    expect(screen.getByText("Build")).toBeTruthy();
  });

  it("calls onImplement then closes the modal when 'Build' is clicked", () => {
    const calls: string[] = [];
    const onImplement = vi.fn(() => calls.push("implement"));
    const onClose = vi.fn(() => calls.push("close"));

    render(
      withStigmer(
        <ArtifactPreviewContent
          artifact={binaryArtifact}
          executionId="aex_1"
          org="acme"
          isTerminal
          onClose={onClose}
          onImplement={onImplement}
        />,
      ),
    );

    fireEvent.click(screen.getByText("Build"));

    expect(onImplement).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Run the plan action before tearing down the modal.
    expect(calls).toEqual(["implement", "close"]);
  });
});
