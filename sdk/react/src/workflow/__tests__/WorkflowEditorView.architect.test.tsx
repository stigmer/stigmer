// Pins the editor's three AI-assisted entry points (Refine, Fix with AI,
// Explain) to the Workflow Architect probe (workflow-architect.ts): each
// renders only when the Organization has the agent, and the rest of the
// toolbar (mode toggle, validation summary, save, full page) stands either
// way. The editor's heavy leaves (CodeMirror, React Flow, the streaming
// panels) and its data hook are stubbed; this file proves the gate.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Diagnostic } from "@codemirror/lint";
import { useWorkflowEditor } from "../useWorkflowEditor";
import { WorkflowEditorView } from "../WorkflowEditorView";

vi.mock("../useWorkflowEditor", () => ({
  useWorkflowEditor: vi.fn(),
}));
vi.mock("../WorkflowYamlEditor", () => ({
  WorkflowYamlEditor: () => <div data-testid="yaml-editor-stub" />,
}));
vi.mock("../WorkflowCodePreviewGraph", () => ({
  WorkflowCodePreviewGraph: () => <div data-testid="preview-graph-stub" />,
}));
vi.mock("../WorkflowCanvasEditor", () => ({
  WorkflowCanvasEditor: () => <div data-testid="canvas-stub" />,
}));
vi.mock("../WorkflowRefinePanel", () => ({
  WorkflowRefinePanel: () => <div data-testid="refine-panel-stub" />,
}));
vi.mock("../WorkflowExplainDialog", () => ({
  WorkflowExplainDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="explain-dialog-stub" /> : null,
}));

const architect = vi.hoisted(() => ({
  availability: "available" as "available" | "absent" | "loading",
}));
vi.mock("../workflow-architect", () => ({
  useWorkflowArchitect: () => ({
    availability: architect.availability,
    agent: null,
    error: null,
  }),
}));

const mockedUseWorkflowEditor = vi.mocked(useWorkflowEditor);

function arrange(diagnostics: readonly Diagnostic[] = []) {
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  mockedUseWorkflowEditor.mockReturnValue({
    org: "acme",
    yaml: "apiVersion: agentic.stigmer.ai/v1\nkind: Workflow\n",
    setYaml: vi.fn(),
    diagnostics,
    isDirty: false,
    isSaving: false,
    saveError: null,
    save: vi.fn().mockResolvedValue(true),
    reset: vi.fn(),
    topology: { nodes: [], edges: [] } as never,
    errorCount,
    warningCount: 0,
    versionMessage: "",
    setVersionMessage: vi.fn(),
  } as never);
}

const ONE_ERROR: readonly Diagnostic[] = [
  { from: 0, to: 1, severity: "error", message: 'task "fetch" is unknown' },
];

function renderEditor() {
  return render(<WorkflowEditorView initialYaml="" org="acme" />);
}

describe("WorkflowEditorView AI-assisted entry points", () => {
  beforeEach(() => {
    architect.availability = "available";
  });
  afterEach(cleanup);

  it("offers Refine, Fix with AI and Explain when the Organization has the Workflow Architect", () => {
    arrange(ONE_ERROR);
    renderEditor();

    expect(screen.getByRole("button", { name: "Refine with AI" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Fix validation errors with AI" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Explain this workflow" }),
    ).toBeTruthy();
  });

  it("withholds all three when the Organization has no Workflow Architect, and keeps the editor whole", () => {
    architect.availability = "absent";
    arrange(ONE_ERROR);
    renderEditor();

    expect(screen.queryByRole("button", { name: "Refine with AI" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Fix validation errors with AI" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Explain this workflow" }),
    ).toBeNull();
    expect(screen.queryByTestId("explain-dialog-stub")).toBeNull();

    // The editor itself is untouched by the agent's absence.
    expect(screen.getByRole("tablist", { name: "Editor mode" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Full page" })).toBeTruthy();
    expect(screen.getByTestId("yaml-editor-stub")).toBeTruthy();
  });

  it("withholds them while the probe is in flight, so no action appears only to vanish", () => {
    architect.availability = "loading";
    arrange(ONE_ERROR);
    renderEditor();

    expect(screen.queryByRole("button", { name: "Refine with AI" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Explain this workflow" }),
    ).toBeNull();
  });

  it("Fix with AI still needs a validation error to fix, architect or not", () => {
    arrange([]);
    renderEditor();

    expect(screen.getByRole("button", { name: "Refine with AI" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Fix validation errors with AI" }),
    ).toBeNull();
  });
});
