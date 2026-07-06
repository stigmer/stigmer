import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import {
  ExecutionArtifactKind,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import { ArtifactsWidget } from "../ArtifactsWidget";

function artifact(name: string) {
  return create(ExecutionArtifactSchema, {
    name,
    kind: ExecutionArtifactKind.FILE,
    sizeBytes: 1024n,
    sandboxPath: `.stigmer/${name}`,
    storageKey: `artifacts/aex_1/${name}`,
  });
}

const execution = create(AgentExecutionSchema, {
  metadata: { id: "aex_1" },
  status: {
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    artifacts: [artifact("agent.yaml"), artifact("notes.md")],
  },
});

/** Modal content fetch — keep pending so nothing rejects during the test. */
function createStigmerMock(): Stigmer {
  return {
    agentExecution: {
      getArtifactContent: vi.fn().mockReturnValue(new Promise(() => {})),
      getArtifactDownloadUrl: vi.fn().mockResolvedValue({ downloadUrl: "" }),
    },
  } as unknown as Stigmer;
}

function renderWidget(executions = [execution]) {
  return render(
    <StigmerContext.Provider value={createStigmerMock()}>
      <ArtifactsWidget executions={executions} org="acme" />
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("ArtifactsWidget — dense list (panel-less)", () => {
  it("renders nothing when there are no artifacts", () => {
    const { container } = renderWidget([]);
    expect(container.firstChild).toBeNull();
  });

  it("renders a heading, count, and one dense row per artifact (no ArtifactCard chrome)", () => {
    renderWidget();
    expect(screen.getByRole("heading", { name: "Artifacts" })).toBeTruthy();
    // Count badge reflects the two deduped artifacts.
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("agent.yaml")).toBeTruthy();
    expect(screen.getByText("notes.md")).toBeTruthy();
    // The retired ArtifactCard rendered a "Preview" button and role="article".
    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByLabelText("Download agent.yaml")).toBeTruthy();
  });

  it("opens the preview modal (the panel-less fallback) on a row click", () => {
    renderWidget();
    expect(document.querySelector("dialog")).toBeNull();
    fireEvent.click(screen.getByText("notes.md"));
    expect(document.querySelector("dialog")).toBeTruthy();
  });
});
