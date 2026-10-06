/**
 * Pins RunComparisonPicker: it lists the workflow's finished runs other
 * than the base (never the base, never one still running), pre-selects the
 * newest run of the opposite outcome (a completed run for a failed base, a
 * failed run otherwise, else the newest candidate), confirms the selected
 * id, lets a click change the selection, says so while loading or when no
 * candidate exists, and closes from Cancel, the close button and the
 * backdrop.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { WorkflowRunSchema, type WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { StigmerContext } from "../../../context";
import { FetchCacheContext } from "../../../internal/FetchCacheProvider";
import { RunComparisonPicker } from "../RunComparisonPicker";

// happy-dom does not implement the native dialog show/close methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

function run(id: string, phase: RunPhase, extra: { name?: string; slug?: string; startedAt?: string; completedAt?: string } = {}): WorkflowRun {
  return create(WorkflowRunSchema, {
    metadata: { id, name: extra.name ?? "", slug: extra.slug ?? "" },
    status: { phase, startedAt: extra.startedAt ?? "", completedAt: extra.completedAt ?? "" },
  });
}

const RUNS: readonly WorkflowRun[] = [
  run("wfr-base", RunPhase.RUN_FAILED, { name: "base-run" }),
  run("wfr-live", RunPhase.RUN_IN_PROGRESS, { name: "live-run" }),
  run("wfr-f2", RunPhase.RUN_FAILED, { name: "failed-run" }),
  run("wfr-c1", RunPhase.RUN_COMPLETED, {
    name: "good-run",
    startedAt: "2026-05-01T10:00:00Z",
    completedAt: "2026-05-01T10:00:03Z",
  }),
  run("wfr-x", RunPhase.RUN_CANCELLED, { slug: "cancelled-slug" }),
  run("wfr-bare", RunPhase.RUN_TERMINATED),
];

function setup(entries: readonly WorkflowRun[], pending = false) {
  const listByWorkflow = pending
    ? vi.fn().mockReturnValue(new Promise<never>(() => {}))
    : vi.fn().mockResolvedValue({ entries, totalPages: 1, nextPageToken: "" });
  const client = { workflowRun: { listByWorkflow, list: vi.fn() } };
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return { listByWorkflow, Wrapper };
}

function selectedName(): string | null | undefined {
  return screen.queryAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true")?.textContent;
}

describe("RunComparisonPicker", () => {
  it("lists finished runs other than the base and pre-selects a completed run for a failed base", async () => {
    const { listByWorkflow, Wrapper } = setup(RUNS);
    const onConfirm = vi.fn();
    render(
      <Wrapper>
        <RunComparisonPicker
          open
          workflowId="wfl_1"
          baseRunId="wfr-base"
          basePhase={RunPhase.RUN_FAILED}
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />
      </Wrapper>,
    );

    await screen.findByRole("option", { name: /good-run/ });
    expect(listByWorkflow.mock.calls[0]![0]).toMatchObject({ workflowId: "wfl_1", pageSize: 20 });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("failed-run"),
      expect.stringContaining("good-run"),
      expect.stringContaining("cancelled-slug"),
      expect.stringContaining("wfr-bare"),
    ]);
    // Phase badge, then the stamp and duration of a run with both times.
    expect(options[1]!.querySelector("[aria-label='Completed']")).toBeTruthy();
    expect(options[1]!.textContent).toContain(" · 3.0s");
    expect(options[3]!.textContent).toContain("—");

    await waitFor(() => expect(selectedName()).toContain("good-run"));
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(onConfirm).toHaveBeenLastCalledWith("wfr-c1");

    fireEvent.click(options[2]!);
    expect(selectedName()).toContain("cancelled-slug");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(onConfirm).toHaveBeenLastCalledWith("wfr-x");
  });

  it("pre-selects a failed run for a completed base, else the newest candidate", async () => {
    const first = setup(RUNS);
    const { unmount } = render(
      <first.Wrapper>
        <RunComparisonPicker
          open
          workflowId="wfl_1"
          baseRunId="wfr-c1"
          basePhase={RunPhase.RUN_COMPLETED}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </first.Wrapper>,
    );
    await screen.findByRole("option", { name: /base-run/ });
    await waitFor(() => expect(selectedName()).toContain("base-run"));
    unmount();

    const second = setup([RUNS[4]!, RUNS[3]!]);
    render(
      <second.Wrapper>
        <RunComparisonPicker
          open
          workflowId="wfl_1"
          baseRunId="wfr-base"
          basePhase={RunPhase.RUN_COMPLETED}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </second.Wrapper>,
    );
    await screen.findByRole("option", { name: /cancelled-slug/ });
    await waitFor(() => expect(selectedName()).toContain("cancelled-slug"));
  });

  it("says when runs are loading and when there is nothing to compare, with Compare disabled", async () => {
    const loading = setup([], true);
    const { unmount } = render(
      <loading.Wrapper>
        <RunComparisonPicker
          open
          workflowId="wfl_1"
          baseRunId="wfr-base"
          basePhase={RunPhase.RUN_FAILED}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </loading.Wrapper>,
    );
    expect(screen.getByText("Loading runs...")).toBeTruthy();
    unmount();

    const empty = setup([RUNS[0]!, RUNS[1]!]);
    const onConfirm = vi.fn();
    render(
      <empty.Wrapper>
        <RunComparisonPicker
          open
          workflowId="wfl_1"
          baseRunId="wfr-base"
          basePhase={RunPhase.RUN_FAILED}
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />
      </empty.Wrapper>,
    );
    await screen.findByText("No other completed runs found.");
    const compare = screen.getByRole("button", { name: "Compare" }) as HTMLButtonElement;
    expect(compare.disabled).toBe(true);
    fireEvent.click(compare);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes from Cancel, the close button and the backdrop", async () => {
    const { Wrapper } = setup(RUNS);
    const onClose = vi.fn();
    const { container } = render(
      <Wrapper>
        <RunComparisonPicker
          open
          workflowId="wfl_1"
          baseRunId="wfr-base"
          basePhase={RunPhase.RUN_FAILED}
          onConfirm={vi.fn()}
          onClose={onClose}
        />
      </Wrapper>,
    );
    expect(container.querySelector("dialog")?.getAttribute("aria-label")).toBe("Select run to compare");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(container.querySelector("dialog")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("clears the selection when closed and pre-selects again when reopened", async () => {
    const { Wrapper } = setup(RUNS);
    const props = {
      workflowId: "wfl_1",
      baseRunId: "wfr-base",
      basePhase: RunPhase.RUN_FAILED,
      onConfirm: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <Wrapper>
        <RunComparisonPicker open {...props} />
      </Wrapper>,
    );
    await screen.findByRole("option", { name: /good-run/ });
    fireEvent.click(screen.getByRole("option", { name: /failed-run/ }));
    expect(selectedName()).toContain("failed-run");

    rerender(
      <Wrapper>
        <RunComparisonPicker open={false} {...props} />
      </Wrapper>,
    );
    rerender(
      <Wrapper>
        <RunComparisonPicker open {...props} />
      </Wrapper>,
    );
    await waitFor(() => expect(selectedName()).toContain("good-run"));
  });
});
