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
import { ArtifactsTab } from "../ArtifactsTab";

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

function renderTab(
  onImplementPlan?: () => void,
  onOpenPlan?: (executionId: string) => void,
) {
  return render(
    <StigmerContext.Provider value={createStigmerMock()}>
      <ArtifactsTab
        executions={[execution]}
        org="acme"
        onImplementPlan={onImplementPlan}
        onOpenPlan={onOpenPlan}
      />
    </StigmerContext.Provider>,
  );
}

function openPreviewFor(name: string) {
  const row = screen.getByText(name).closest("[role='listitem']") as HTMLElement;
  fireEvent.click(within(row).getByText("Preview"));
}

afterEach(cleanup);

describe("ArtifactsTab — plan 'Build' wiring", () => {
  it("shows 'Build' in the preview of a plan.md artifact", () => {
    renderTab(vi.fn());

    openPreviewFor("plan.md");

    const dialog = document.querySelector("dialog")!;
    expect(within(dialog).getByText("Build")).toBeTruthy();
  });

  it("does not show 'Build' in the preview of a non-plan artifact", () => {
    renderTab(vi.fn());

    openPreviewFor("notes.md");

    const dialog = document.querySelector("dialog")!;
    expect(within(dialog).queryByText("Build")).toBeNull();
  });

  it("invokes onImplementPlan when 'Build' is clicked for a plan", () => {
    const onImplementPlan = vi.fn();
    renderTab(onImplementPlan);

    openPreviewFor("plan.md");
    const dialog = document.querySelector("dialog")!;
    fireEvent.click(within(dialog).getByText("Build"));

    expect(onImplementPlan).toHaveBeenCalledTimes(1);
  });
});

describe("ArtifactsTab — plan routes to the plan document tab", () => {
  it("routes a plan.md preview to onOpenPlan (no modal) when provided", () => {
    const onOpenPlan = vi.fn();
    renderTab(vi.fn(), onOpenPlan);

    openPreviewFor("plan.md");

    expect(onOpenPlan).toHaveBeenCalledWith("aex_1");
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("keeps the modal for non-plan artifacts even when onOpenPlan is provided", () => {
    const onOpenPlan = vi.fn();
    renderTab(vi.fn(), onOpenPlan);

    openPreviewFor("notes.md");

    expect(onOpenPlan).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeTruthy();
  });

  it("keeps the modal for plan.md when onOpenPlan is omitted (hosts without the plan tab)", () => {
    renderTab(vi.fn());

    openPreviewFor("plan.md");

    expect(document.querySelector("dialog")).toBeTruthy();
  });
});
