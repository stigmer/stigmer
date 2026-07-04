import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../../context";
import type { SessionPlan } from "../../../library/detect-plan-artifact";
import type { PlanDraftController } from "../../usePlanDraft";
import { PlanTab } from "../PlanTab";

afterEach(cleanup);

const PLAN_TEXT = "# Rollout Plan\n\n## Phase 1\n\nDo the first thing.";

const plan: SessionPlan = {
  executionId: "aex_1",
  artifact: create(ExecutionArtifactSchema, {
    name: "plan.md",
    kind: ExecutionArtifactKind.FILE,
    sizeBytes: 128n,
    storageKey: "artifacts/aex_1/plan.md",
    contentHash: "hash-a",
  }),
};

function stigmerMock(opts?: { text?: string; truncated?: boolean }): Stigmer {
  return {
    agentExecution: {
      getArtifactContent: vi.fn().mockResolvedValue({
        content: new TextEncoder().encode(opts?.text ?? PLAN_TEXT),
        contentType: "text/markdown",
        truncated: opts?.truncated ?? false,
      }),
    },
  } as unknown as Stigmer;
}

function draftMock(overrides?: Partial<PlanDraftController>): PlanDraftController {
  return {
    draftText: null,
    isEdited: false,
    setDraft: vi.fn(),
    readDraft: () => null,
    ...overrides,
  };
}

function renderTab(opts?: {
  stigmer?: Stigmer;
  draft?: PlanDraftController;
  onBuildFromPlan?: () => void;
  buildDisabled?: boolean;
}) {
  return render(
    <StigmerContext.Provider value={opts?.stigmer ?? stigmerMock()}>
      <PlanTab
        plan={plan}
        draft={opts?.draft ?? draftMock()}
        onBuildFromPlan={opts?.onBuildFromPlan}
        buildDisabled={opts?.buildDisabled}
      />
    </StigmerContext.Provider>,
  );
}

describe("PlanTab", () => {
  it("renders the plan as a document with the H1 lifted into the header", async () => {
    renderTab();

    await waitFor(() =>
      expect(screen.getByText("Rollout Plan")).toBeTruthy(),
    );
    expect(screen.getByText("Do the first thing.")).toBeTruthy();
  });

  it("fires onBuildFromPlan from the primary action", async () => {
    const onBuildFromPlan = vi.fn();
    renderTab({ onBuildFromPlan });

    await waitFor(() =>
      expect(screen.getByText("Build from plan")).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("Build from plan"));
    expect(onBuildFromPlan).toHaveBeenCalledTimes(1);
  });

  it("shows a pending label and disables the primary while the build starts", async () => {
    renderTab({ onBuildFromPlan: vi.fn(), buildDisabled: true });

    await waitFor(() =>
      expect(screen.getByText("Starting build…")).toBeTruthy(),
    );
    expect(
      (screen.getByText("Starting build…").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("edits into the viewer-owned draft and shows the Edited indicator", async () => {
    const setDraft = vi.fn();
    const stigmer = stigmerMock();
    const { rerender } = render(
      <StigmerContext.Provider value={stigmer}>
        <PlanTab plan={plan} draft={draftMock({ setDraft })} />
      </StigmerContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("Edit")).toBeTruthy());
    fireEvent.click(screen.getByText("Edit"));

    const editor = screen.getByRole("textbox", { name: "Edit plan" });
    fireEvent.change(editor, { target: { value: "# Edited" } });
    expect(setDraft).toHaveBeenCalledWith("# Edited");

    // Draft active → indicator + revert, and the editor shows the draft.
    // Same client instance, so the content fetch is not re-triggered.
    rerender(
      <StigmerContext.Provider value={stigmer}>
        <PlanTab
          plan={plan}
          draft={draftMock({ draftText: "# Edited", isEdited: true, setDraft })}
        />
      </StigmerContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Edited")).toBeTruthy());

    fireEvent.click(screen.getByText("Revert"));
    expect(setDraft).toHaveBeenCalledWith(null);
  });

  it("disables editing for truncated content", async () => {
    renderTab({ stigmer: stigmerMock({ truncated: true }) });

    await waitFor(() => expect(screen.getByText("Edit")).toBeTruthy());
    expect((screen.getByText("Edit") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Preview truncated/)).toBeTruthy();
  });

  it("renders an error state with retry when the content fetch fails", async () => {
    const failing = {
      agentExecution: {
        getArtifactContent: vi.fn().mockRejectedValue(new Error("boom")),
      },
    } as unknown as Stigmer;

    renderTab({ stigmer: failing });

    await waitFor(() =>
      expect(screen.getByText(/Couldn’t load the plan/)).toBeTruthy(),
    );
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});
