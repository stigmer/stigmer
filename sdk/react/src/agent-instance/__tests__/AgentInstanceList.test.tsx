import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { AgentInstanceList } from "../AgentInstanceList";

// The kebab menu portals its content; without a StigmerProvider the portal
// container is null and nothing mounts — pin it to document.body.
vi.mock("../../portal-container", () => ({
  useStigmerPortalContainer: () => document.body,
}));

// Isolate the row-actions behavior under test from the data, environment,
// visibility, and permission subsystems (each has its own tests).
const data = vi.hoisted(() => ({
  instances: [] as unknown[],
  isLoading: false,
  error: null as Error | null,
}));
vi.mock("../useAgentInstances", () => ({
  useAgentInstances: () => ({ ...data, refetch: vi.fn() }),
}));
vi.mock("../../environment/useEnvironmentList", () => ({
  useEnvironmentList: () => ({ environments: [] }),
}));
vi.mock("../../library/ResourceVisibilityControl", () => ({
  ResourceVisibilityControl: () => <div data-testid="visibility" />,
}));
const perm = vi.hoisted(() => ({ canDelete: true }));
vi.mock("../../iam-policy/useCheckPermission", () => ({
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
      id: overrides?.id ?? "ai_1",
      name: overrides?.name ?? "prod-instance",
      slug: overrides?.slug ?? "prod-instance",
      visibility: ApiResourceVisibility.visibility_private,
      labels: {},
    },
    spec: { environmentRefs: [] },
  } as never;
}

describe("AgentInstanceList row actions", () => {
  it("collapses the row actions into a kebab exposing Start session and Delete", async () => {
    data.instances = [makeInstance()];
    render(
      <AgentInstanceList
        agentId="agt_1"
        org="acme"
        onStartSessionClick={vi.fn()}
        onDeleteClick={vi.fn()}
      />,
    );

    // No always-visible action buttons; the row shows a single kebab.
    expect(screen.queryByRole("button", { name: "Start session" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Actions for/ }));

    expect(
      await screen.findByRole("menuitem", { name: "Start session" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("fires onStartSessionClick with the row's instance", async () => {
    const onStart = vi.fn();
    const inst = makeInstance();
    data.instances = [inst];
    render(
      <AgentInstanceList
        agentId="agt_1"
        org="acme"
        onStartSessionClick={onStart}
        onDeleteClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Actions for/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Start session" }));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(inst);
  });

  it("fires onDeleteClick from the menu", async () => {
    const onDelete = vi.fn();
    const inst = makeInstance();
    data.instances = [inst];
    render(
      <AgentInstanceList
        agentId="agt_1"
        org="acme"
        onStartSessionClick={vi.fn()}
        onDeleteClick={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Actions for/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith(inst);
  });

  it("omits Delete when the viewer cannot delete, keeping Start session", async () => {
    perm.canDelete = false;
    data.instances = [makeInstance()];
    render(
      <AgentInstanceList
        agentId="agt_1"
        org="acme"
        onStartSessionClick={vi.fn()}
        onDeleteClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Actions for/ }));
    expect(
      await screen.findByRole("menuitem", { name: "Start session" }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("renders no kebab when the host wires no row actions", () => {
    data.instances = [makeInstance()];
    render(<AgentInstanceList agentId="agt_1" org="acme" />);

    expect(screen.getByText("prod-instance")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
  });
});
