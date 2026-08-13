// Tests for WorkflowRunDialog's `initialInstanceId` preselection (issue
// #582): a row-level "Run" must open the dialog with that instance already
// selected, while reopening without one resets to the server-resolved
// default. Selection is asserted through the rendered instance <select> —
// the observable surface — with the real useRunWorkflowFlow underneath.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { WorkflowRunDialog } from "../WorkflowRunDialog";

beforeAll(() => {
  // happy-dom does not implement the native <dialog> modal API.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeWorkflow() {
  return {
    metadata: { id: "wf_1", name: "my-workflow", slug: "my-workflow" },
    spec: { env: {} },
  } as never;
}

function makeInstance(id: string, name: string) {
  return {
    metadata: { id, name, slug: name },
    spec: { environmentRefs: [] },
  } as never;
}

// Two user instances so the picker always renders (it needs >= 1 user
// instance when defaultInstanceId is provided).
const DEFAULT_INSTANCE_ID = "wfi_default";
const INSTANCES = [
  makeInstance("wfi_a", "instance-a"),
  makeInstance("wfi_b", "instance-b"),
];

const mockClient = {
  workflowExecution: { create: vi.fn() },
  environment: { getByReference: vi.fn() },
} as unknown as Stigmer;

function renderDialog(props?: {
  open?: boolean;
  initialInstanceId?: string | null;
}) {
  const ui = (dialogProps?: {
    open?: boolean;
    initialInstanceId?: string | null;
  }) => (
    <StigmerContext.Provider value={mockClient}>
      <WorkflowRunDialog
        open={dialogProps?.open ?? true}
        onOpenChange={vi.fn()}
        org="acme"
        workflow={makeWorkflow()}
        instances={INSTANCES}
        defaultInstanceId={DEFAULT_INSTANCE_ID}
        initialInstanceId={dialogProps?.initialInstanceId}
        onSuccess={vi.fn()}
        onError={vi.fn()}
      />
    </StigmerContext.Provider>
  );
  const result = render(ui(props));
  return {
    ...result,
    rerenderDialog: (nextProps?: {
      open?: boolean;
      initialInstanceId?: string | null;
    }) => result.rerender(ui(nextProps)),
  };
}

function instanceSelect(): HTMLSelectElement {
  return screen.getByLabelText("Instance") as HTMLSelectElement;
}

describe("WorkflowRunDialog initialInstanceId", () => {
  it("preselects the requested instance when the dialog opens", () => {
    renderDialog({ initialInstanceId: "wfi_b" });

    expect(instanceSelect().value).toBe("wfi_b");
  });

  it("defaults to the server-resolved option when omitted", () => {
    renderDialog();

    // "" is the "Default (no specific configuration)" option.
    expect(instanceSelect().value).toBe("");
  });

  it("falls back to the default option when the id is stale", () => {
    renderDialog({ initialInstanceId: "wfi_deleted" });

    expect(instanceSelect().value).toBe("");
  });

  it("applies the fresh preselection on each open transition", () => {
    const { rerenderDialog } = renderDialog({ initialInstanceId: "wfi_a" });
    expect(instanceSelect().value).toBe("wfi_a");

    // Close, then reopen targeting a different instance (a second row's
    // Run click) — the reset-then-preselect path must apply the new id.
    rerenderDialog({ open: false, initialInstanceId: "wfi_a" });
    rerenderDialog({ open: true, initialInstanceId: "wfi_b" });
    expect(instanceSelect().value).toBe("wfi_b");

    // Reopen with none (the header Run button) — back to the default.
    rerenderDialog({ open: false, initialInstanceId: "wfi_b" });
    rerenderDialog({ open: true, initialInstanceId: null });
    expect(instanceSelect().value).toBe("");
  });
});
