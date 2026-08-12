import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { openMenu } from "../../../__tests__/helpers/open-menu";
import { WorkflowInstanceList } from "../WorkflowInstanceList";

// Isolate the row-actions behavior under test from the data, environment,
// visibility, and permission subsystems (each has its own tests).
const data = vi.hoisted(() => ({
  instances: [] as unknown[],
  isLoading: false,
  error: null as Error | null,
}));
vi.mock("../../useWorkflowInstances", () => ({
  useWorkflowInstances: () => ({ ...data, refetch: vi.fn() }),
}));
vi.mock("../../../environment/useEnvironmentList", () => ({
  useEnvironmentList: () => ({ environments: [] }),
}));
vi.mock("../../../library/ResourceVisibilityControl", () => ({
  ResourceVisibilityControl: () => <div data-testid="visibility" />,
}));
const perm = vi.hoisted(() => ({ canDelete: true }));
vi.mock("../../../iam-policy/useCheckPermission", () => ({
  useCheckPermission: () => ({
    allowed: perm.canDelete,
    isLoading: false,
    error: null,
  }),
}));

beforeAll(() => {
  // Base UI's menu positioner observes its anchor; happy-dom lacks
  // ResizeObserver, so provide a no-op shim.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(() => {
  cleanup();
  data.instances = [];
  data.error = null;
  perm.canDelete = true;
});

function makeInstance(overrides?: {
  id?: string;
  name?: string;
  slug?: string;
}) {
  return {
    metadata: {
      id: overrides?.id ?? "wi_1",
      name: overrides?.name ?? "nightly-run",
      slug: overrides?.slug ?? "nightly-run",
      visibility: ApiResourceVisibility.visibility_private,
    },
    spec: { environmentRefs: [] },
  } as never;
}

describe("WorkflowInstanceList row actions", () => {
  it("collapses the row actions into a kebab exposing Run and Delete", async () => {
    data.instances = [makeInstance()];
    render(
      <WorkflowInstanceList
        workflowId="wf_1"
        org="acme"
        onRunClick={vi.fn()}
        onDeleteClick={vi.fn()}
      />,
    );

    // No always-visible action buttons; the row shows a single kebab.
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    await openMenu(screen.getByRole("button", { name: /^Actions for/ }));

    expect(await screen.findByRole("menuitem", { name: "Run" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("fires onRunClick with the row's instance", async () => {
    const onRun = vi.fn();
    const inst = makeInstance();
    data.instances = [inst];
    render(
      <WorkflowInstanceList
        workflowId="wf_1"
        org="acme"
        onRunClick={onRun}
        onDeleteClick={vi.fn()}
      />,
    );

    await openMenu(screen.getByRole("button", { name: /^Actions for/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Run" }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith(inst);
  });

  it("fires onDeleteClick from the menu", async () => {
    const onDelete = vi.fn();
    const inst = makeInstance();
    data.instances = [inst];
    render(
      <WorkflowInstanceList
        workflowId="wf_1"
        org="acme"
        onRunClick={vi.fn()}
        onDeleteClick={onDelete}
      />,
    );

    await openMenu(screen.getByRole("button", { name: /^Actions for/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith(inst);
  });

  it("omits Delete when the viewer cannot delete, keeping Run", async () => {
    perm.canDelete = false;
    data.instances = [makeInstance()];
    render(
      <WorkflowInstanceList
        workflowId="wf_1"
        org="acme"
        onRunClick={vi.fn()}
        onDeleteClick={vi.fn()}
      />,
    );

    await openMenu(screen.getByRole("button", { name: /^Actions for/ }));
    expect(await screen.findByRole("menuitem", { name: "Run" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("renders no kebab when the host wires no row actions", () => {
    data.instances = [makeInstance()];
    render(<WorkflowInstanceList workflowId="wf_1" org="acme" />);

    expect(screen.getByText("nightly-run")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
  });
});
