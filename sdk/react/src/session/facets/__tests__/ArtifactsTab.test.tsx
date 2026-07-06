import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import {
  ExecutionArtifactKind,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../../context";
import { ArtifactsTab, type ArtifactsTabProps } from "../ArtifactsTab";
import type { SessionArtifactEntry } from "../../useSessionArtifacts";

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
    artifacts: [artifact("plan.md"), artifact("notes.md")],
  },
});

/** Modal content fetch — keep pending so nothing rejects during the test. */
function createStigmerMock(): Stigmer {
  return {
    agentExecution: {
      getArtifactContent: vi.fn().mockReturnValue(new Promise(() => {})),
    },
  } as unknown as Stigmer;
}

function renderTab(props: Partial<ArtifactsTabProps> = {}) {
  return render(
    <StigmerContext.Provider value={createStigmerMock()}>
      <ArtifactsTab executions={[execution]} org="acme" {...props} />
    </StigmerContext.Provider>,
  );
}

/** Click the open target of a row by its artifact name. */
function openRow(name: string) {
  fireEvent.click(screen.getByText(name));
}

afterEach(cleanup);

describe("ArtifactsTab — dense row list", () => {
  it("renders one row per artifact with a Download control (no old 'Preview' button)", () => {
    renderTab({ onOpenArtifact: vi.fn() });

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("plan.md")).toBeTruthy();
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.getByLabelText("Download plan.md")).toBeTruthy();
    expect(screen.getByLabelText("Download notes.md")).toBeTruthy();
  });

  it("renders the empty state with no artifacts", () => {
    render(
      <StigmerContext.Provider value={createStigmerMock()}>
        <ArtifactsTab executions={[]} org="acme" />
      </StigmerContext.Provider>,
    );
    expect(screen.getByText(/No artifacts yet/)).toBeTruthy();
  });
});

describe("ArtifactsTab — open routing", () => {
  it("routes a non-plan artifact to onOpenArtifact (no modal) when provided", () => {
    const onOpenArtifact = vi.fn<(entry: SessionArtifactEntry) => void>();
    renderTab({ onOpenArtifact, onOpenPlan: vi.fn() });

    openRow("notes.md");

    expect(onOpenArtifact).toHaveBeenCalledTimes(1);
    expect(onOpenArtifact.mock.calls[0][0].artifact.name).toBe("notes.md");
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("routes plan.md to onOpenPlan (never onOpenArtifact) when both are provided", () => {
    const onOpenArtifact = vi.fn();
    const onOpenPlan = vi.fn();
    renderTab({ onOpenArtifact, onOpenPlan });

    openRow("plan.md");

    expect(onOpenPlan).toHaveBeenCalledWith("aex_1");
    expect(onOpenArtifact).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("falls back to the modal for a non-plan artifact when onOpenArtifact is omitted", () => {
    renderTab({ onOpenPlan: vi.fn() });

    openRow("notes.md");

    expect(document.querySelector("dialog")).toBeTruthy();
  });

  it("falls back to the modal for plan.md when neither onOpenPlan nor onOpenArtifact is provided", () => {
    renderTab();

    openRow("plan.md");

    expect(document.querySelector("dialog")).toBeTruthy();
  });
});

describe("ArtifactsTab — modal fallback plan 'Build' wiring", () => {
  it("shows 'Build' in the modal preview of a plan.md artifact (panel-less host)", () => {
    renderTab({ onImplementPlan: vi.fn() });

    openRow("plan.md");

    const dialog = document.querySelector("dialog")!;
    expect(within(dialog).getByText("Build")).toBeTruthy();
  });

  it("does not show 'Build' in the modal preview of a non-plan artifact", () => {
    renderTab({ onImplementPlan: vi.fn() });

    openRow("notes.md");

    const dialog = document.querySelector("dialog")!;
    expect(within(dialog).queryByText("Build")).toBeNull();
  });

  it("invokes onImplementPlan when 'Build' is clicked for a plan", () => {
    const onImplementPlan = vi.fn();
    renderTab({ onImplementPlan });

    openRow("plan.md");
    const dialog = document.querySelector("dialog")!;
    fireEvent.click(within(dialog).getByText("Build"));

    expect(onImplementPlan).toHaveBeenCalledTimes(1);
  });
});
