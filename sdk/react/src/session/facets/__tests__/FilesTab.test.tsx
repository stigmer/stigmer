/**
 * The session panel's Files facet over the conversation's Files: two groups,
 * what the agent saved (one dense row per output path, its earlier versions
 * behind a disclosure) and what was given (each named by its place); a plan
 * routes to the plan tab, any other File to an editor tab by its document
 * key or, in a panel-less host, the preview modal (with Build for a plan); a
 * double-click pins; opening the facet re-reads the Files once.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { StigmerContext } from "../../../context";
import { FilesTab, type FilesTabProps } from "../FilesTab";
import { deriveSessionOutputs } from "../../useSessionOutputs";
import { givenKey, type SessionGivenEntry } from "../../useSessionGivenFiles";

function output(filename: string, runId = "aex_1", id = `file_${filename.replace(/\W/g, "_")}`) {
  return create(FileSchema, {
    metadata: { id },
    spec: { filename },
    status: { sizeBytes: 1024n, runId, outputPath: filename },
  });
}

const execution = create(RunSchema, {
  metadata: { id: "aex_1" },
  status: { phase: RunPhase.RUN_COMPLETED },
});

const ENTRIES = deriveSessionOutputs([output("plan.md"), output("notes.md")], [execution]).outputs;

/** A File given to the conversation, at the place its resources settled. */
const GIVEN: readonly SessionGivenEntry[] = [
  {
    file: create(FileSchema, { metadata: { id: "file_ledger" }, spec: { filename: "ledger.csv" }, status: { sizeBytes: 64n } }),
    place: "q3/ledger.csv",
  },
];

/** Modal content read — keep pending so nothing rejects during the test. */
function createStigmerMock(): Stigmer {
  return {
    file: {
      getContent: vi.fn().mockReturnValue(new Promise(() => {})),
    },
  } as unknown as Stigmer;
}

function renderTab(props: Partial<FilesTabProps> = {}) {
  return render(
    <StigmerContext.Provider value={createStigmerMock()}>
      <FilesTab outputs={ENTRIES} given={[]} org="acme" {...props} />
    </StigmerContext.Provider>,
  );
}

/** Click the open target of a row by its name. */
function openRow(name: string) {
  fireEvent.click(screen.getByText(name));
}

/** Double-click the open target of a row by its name (the pin gesture). */
function activateRow(name: string) {
  fireEvent.doubleClick(screen.getByText(name));
}

afterEach(cleanup);

describe("FilesTab — dense row list", () => {
  it("renders one row per output path with a Download control (no old 'Preview' button)", () => {
    renderTab({ onOpenFileDocument: vi.fn() });

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("plan.md")).toBeTruthy();
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.getByLabelText("Download plan.md")).toBeTruthy();
    expect(screen.getByLabelText("Download notes.md")).toBeTruthy();
  });

  it("renders the empty state with no Files", () => {
    render(
      <StigmerContext.Provider value={createStigmerMock()}>
        <FilesTab outputs={[]} given={[]} org="acme" />
      </StigmerContext.Provider>,
    );
    expect(screen.getByText(/No files yet/)).toBeTruthy();
  });

  it("groups what the agent saved apart from what was given, naming a given File by its place", () => {
    renderTab({ given: GIVEN });

    const saved = screen.getByRole("region", { name: "Saved by the agent" });
    const given = screen.getByRole("region", { name: "Given to the conversation" });
    expect(within(saved).getByText("notes.md")).toBeTruthy();
    expect(within(given).getByText("ledger.csv")).toBeTruthy();
    expect(within(given).queryByText("notes.md")).toBeNull();
    // The download keeps the File's own name.
    expect(within(given).getByLabelText("Download ledger.csv")).toBeTruthy();
  });

  it("shows only the group that has Files", () => {
    renderTab({ outputs: [], given: GIVEN });
    expect(screen.queryByRole("region", { name: "Saved by the agent" })).toBeNull();
    expect(screen.getByRole("region", { name: "Given to the conversation" })).toBeTruthy();
  });

  it("puts a path's earlier versions behind a disclosure, each opening in the preview", () => {
    const later = create(RunSchema, { metadata: { id: "aex_2" }, status: { phase: RunPhase.RUN_COMPLETED } });
    const outputs = deriveSessionOutputs(
      [output("report.md", "aex_2", "file_v2"), output("report.md", "aex_1", "file_v1")],
      [execution, later],
    ).outputs;
    renderTab({ outputs, onOpenFileDocument: vi.fn() });

    expect(screen.getAllByText("report.md")).toHaveLength(1);
    const disclosure = screen.getByRole("button", { name: "Show 1 earlier version" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);

    const earlier = screen.getByRole("list", { name: "Earlier versions of report.md" });
    fireEvent.click(within(earlier).getByText("report.md"));
    expect(document.querySelector("dialog")).toBeTruthy();
  });

  it("re-reads the conversation's Files once when the facet opens", () => {
    const onShown = vi.fn();
    const { rerender } = renderTab({ onShown });
    rerender(
      <StigmerContext.Provider value={createStigmerMock()}>
        <FilesTab outputs={ENTRIES} given={[]} org="acme" onShown={() => onShown()} />
      </StigmerContext.Provider>,
    );
    expect(onShown).toHaveBeenCalledTimes(1);
  });
});

describe("FilesTab — open routing", () => {
  it("routes a non-plan output to onOpenFileDocument by its output key (no modal) when provided", () => {
    const onOpenFileDocument = vi.fn<(documentKey: string) => void>();
    renderTab({ onOpenFileDocument, onOpenPlan: vi.fn() });

    openRow("notes.md");

    expect(onOpenFileDocument).toHaveBeenCalledWith("notes.md");
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("routes a given File to onOpenFileDocument by its place under the uploads folder", () => {
    const onOpenFileDocument = vi.fn<(documentKey: string) => void>();
    renderTab({ given: GIVEN, onOpenFileDocument });

    openRow("ledger.csv");

    expect(onOpenFileDocument).toHaveBeenCalledWith(givenKey(GIVEN[0]!));
    expect(givenKey(GIVEN[0]!)).toBe(".stigmer/uploads/q3/ledger.csv");
  });

  it("routes plan.md to onOpenPlan (never onOpenFileDocument) when both are provided", () => {
    const onOpenFileDocument = vi.fn();
    const onOpenPlan = vi.fn();
    renderTab({ onOpenFileDocument, onOpenPlan });

    openRow("plan.md");

    expect(onOpenPlan).toHaveBeenCalledWith("aex_1");
    expect(onOpenFileDocument).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("falls back to the modal for a non-plan output when onOpenFileDocument is omitted", () => {
    renderTab({ onOpenPlan: vi.fn() });

    openRow("notes.md");

    expect(document.querySelector("dialog")).toBeTruthy();
  });

  it("falls back to the modal for plan.md when neither onOpenPlan nor onOpenFileDocument is provided", () => {
    renderTab();

    openRow("plan.md");

    expect(document.querySelector("dialog")).toBeTruthy();
  });
});

describe("FilesTab — pin (double-click) routing", () => {
  it("routes a non-plan double-click to onActivateFileDocument (pin)", () => {
    const onActivateFileDocument = vi.fn<(documentKey: string) => void>();
    renderTab({ onOpenFileDocument: vi.fn(), onActivateFileDocument, onOpenPlan: vi.fn() });

    activateRow("notes.md");

    expect(onActivateFileDocument).toHaveBeenCalledWith("notes.md");
  });

  it("routes a plan.md double-click to onOpenPlan (its tab is already pinned), never onActivateFileDocument", () => {
    const onActivateFileDocument = vi.fn();
    const onOpenPlan = vi.fn();
    renderTab({ onOpenFileDocument: vi.fn(), onActivateFileDocument, onOpenPlan });

    activateRow("plan.md");

    expect(onOpenPlan).toHaveBeenCalledWith("aex_1");
    expect(onActivateFileDocument).not.toHaveBeenCalled();
  });

  it("binds no double-click when onActivateFileDocument is omitted (panel-less host) — a double-click is harmless", () => {
    const onOpenFileDocument = vi.fn();
    renderTab({ onOpenFileDocument });

    // With no pin handler the row binds no onDoubleClick, so a dblclick fires
    // nothing (in a real browser the leading single-clicks still preview).
    expect(() => activateRow("notes.md")).not.toThrow();
    expect(onOpenFileDocument).not.toHaveBeenCalled();
  });
});

describe("FilesTab — modal fallback plan 'Build' wiring", () => {
  it("shows 'Build' in the modal preview of a plan.md output (panel-less host)", () => {
    renderTab({ onImplementPlan: vi.fn() });

    openRow("plan.md");

    const dialog = document.querySelector("dialog")!;
    expect(within(dialog).getByText("Build")).toBeTruthy();
  });

  it("does not show 'Build' in the modal preview of a non-plan output", () => {
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
