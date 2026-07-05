import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import type { SessionPlan } from "../../library/detect-plan-artifact";
import type { PlanDraftController } from "../usePlanDraft";
import { PlanEditor } from "../PlanEditor";

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

function renderEditor(opts?: {
  stigmer?: Stigmer;
  draft?: PlanDraftController;
  onBuildFromPlan?: () => void;
  buildDisabled?: boolean;
  readOnly?: boolean;
}) {
  return render(
    <StigmerContext.Provider value={opts?.stigmer ?? stigmerMock()}>
      <PlanEditor
        plan={plan}
        draft={opts?.draft ?? draftMock()}
        onBuildFromPlan={opts?.onBuildFromPlan}
        buildDisabled={opts?.buildDisabled}
        readOnly={opts?.readOnly}
      />
    </StigmerContext.Provider>,
  );
}

describe("PlanEditor", () => {
  it("renders the plan as a document with the H1 lifted into the header", async () => {
    renderEditor();

    await waitFor(() =>
      expect(screen.getByText("Rollout Plan")).toBeTruthy(),
    );
    expect(screen.getByText("Do the first thing.")).toBeTruthy();
  });

  it("fires onBuildFromPlan from the primary action", async () => {
    const onBuildFromPlan = vi.fn();
    renderEditor({ onBuildFromPlan });

    await waitFor(() =>
      expect(screen.getByText("Build")).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("Build"));
    expect(onBuildFromPlan).toHaveBeenCalledTimes(1);
  });

  it("degrades gracefully at narrow widths: truncating title and shrinkable toolbar", async () => {
    // The document must reflow to whatever width the panel gives it — the
    // toolbar wraps and its labels truncate rather than forcing a sideways
    // scrollbar on the editor pane (the overflow-x-hidden body above clips,
    // so anything that cannot shrink would be cut off, not scrollable).
    renderEditor({ onBuildFromPlan: vi.fn() });

    await waitFor(() =>
      expect(screen.getByText("Rollout Plan")).toBeTruthy(),
    );
    expect(screen.getByText("Rollout Plan").className).toContain("truncate");

    const buildLabel = screen.getByText("Build");
    expect(buildLabel.className).toContain("truncate");
    const toolbar = screen.getByRole("tablist", { name: "Plan view" })
      .parentElement!;
    expect(toolbar.className).toContain("flex-wrap");
    expect(toolbar.className).toContain("min-w-0");
  });

  it("shows a pending label and disables the primary while the build starts", async () => {
    renderEditor({ onBuildFromPlan: vi.fn(), buildDisabled: true });

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
        <PlanEditor plan={plan} draft={draftMock({ setDraft })} />
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
        <PlanEditor
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
    renderEditor({ stigmer: stigmerMock({ truncated: true }) });

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

    renderEditor({ stigmer: failing });

    await waitFor(() =>
      expect(screen.getByText(/Couldn’t load the plan/)).toBeTruthy(),
    );
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});

describe("PlanEditor — read-only (superseded plan)", () => {
  it("renders the document with a superseded notice, no Edit and no Build", async () => {
    renderEditor({
      readOnly: true,
      draft: undefined,
      onBuildFromPlan: vi.fn(),
    });

    await waitFor(() =>
      expect(screen.getByText("Rollout Plan")).toBeTruthy(),
    );
    expect(screen.getByText("Superseded by a newer plan")).toBeTruthy();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Build")).toBeNull();
  });

  it("never applies the current plan's draft to a superseded plan", async () => {
    // Defense in depth for the wiring contract (the host passes no draft for
    // a read-only plan): even if a draft controller leaks through, read-only
    // rendering shows the artifact text.
    renderEditor({
      readOnly: true,
      draft: draftMock({ draftText: "# Someone else's draft", isEdited: true }),
    });

    await waitFor(() =>
      expect(screen.getByText("Rollout Plan")).toBeTruthy(),
    );
    expect(screen.queryByText("Someone else's draft")).toBeNull();
    expect(screen.queryByText("Edited")).toBeNull();
  });

  it("keeps Rendered and Source views available", async () => {
    renderEditor({ readOnly: true, draft: undefined });

    await waitFor(() => expect(screen.getByText("Source")).toBeTruthy());
    fireEvent.click(screen.getByText("Source"));
    expect(screen.getByText(/# Rollout Plan/)).toBeTruthy();
  });
});
