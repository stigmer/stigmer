import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useManageAccess } from "../useManageAccess";
import { VisibilityBadge } from "../../library/VisibilitySelector";
import type { AccessResource } from "../types";

// Drive the gate through the permission hook (owned by useManageAccess) and
// stand in a lightweight dialog so the open-state wiring is observable
// without exercising the real modal (covered by its own test).
const checkPermission = vi.fn<() => { allowed: boolean; isLoading: boolean; error: null }>(
  () => ({ allowed: true, isLoading: false, error: null }),
);
vi.mock("../../iam-policy/useCheckPermission", () => ({
  useCheckPermission: () => checkPermission(),
}));

vi.mock("../ManageAccessDialog", () => ({
  ManageAccessDialog: ({ open }: { open: boolean }) => (
    <div data-testid="dialog" data-open={String(open)} />
  ),
}));

afterEach(() => {
  cleanup();
  checkPermission.mockReset();
  checkPermission.mockReturnValue({ allowed: true, isLoading: false, error: null });
});

const RESOURCE: AccessResource = {
  kind: ApiResourceKind.agent,
  kindString: "agent",
  id: "agt_123",
  org: "acme",
  name: "Release Bot",
};

/**
 * Mirrors how the blueprint detail views (agent/skill/mcp_server/workflow)
 * wire the header visibility chip: clickable into the Manage access dialog
 * only when the user can view access, a static badge otherwise.
 */
function DetailHeaderHarness({ resource }: { resource: AccessResource | null }) {
  const access = useManageAccess({ resource });
  return (
    <>
      <VisibilityBadge
        visibility={ApiResourceVisibility.visibility_org}
        onClick={access.action ? access.open : undefined}
      />
      {access.dialog}
    </>
  );
}

describe("useManageAccess — header visibility chip wiring", () => {
  it("renders the chip as a Manage-access button and opens the dialog on click", () => {
    render(<DetailHeaderHarness resource={RESOURCE} />);

    const chip = screen.getByRole("button", {
      name: /Organization visibility — manage access/i,
    });
    expect(screen.getByTestId("dialog").getAttribute("data-open")).toBe("false");

    fireEvent.click(chip);
    expect(screen.getByTestId("dialog").getAttribute("data-open")).toBe("true");
  });

  it("keeps the chip a static badge when the user cannot view access", () => {
    checkPermission.mockReturnValue({ allowed: false, isLoading: false, error: null });
    render(<DetailHeaderHarness resource={RESOURCE} />);

    // Visibility stays legible, but there is nothing to click.
    expect(screen.getByText("Organization")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps the chip static and mounts no dialog while the resource is loading", () => {
    render(<DetailHeaderHarness resource={null} />);

    expect(screen.getByText("Organization")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("dialog")).toBeNull();
  });
});

describe("useManageAccess — action gating", () => {
  function ActionProbe({ resource }: { resource: AccessResource | null }) {
    const access = useManageAccess({ resource });
    return <div data-testid="action" data-present={String(access.action !== null)} />;
  }

  it("returns a sharing-group action when permitted", () => {
    render(<ActionProbe resource={RESOURCE} />);
    expect(screen.getByTestId("action").getAttribute("data-present")).toBe("true");
  });

  it("returns null without can_view_access", () => {
    checkPermission.mockReturnValue({ allowed: false, isLoading: false, error: null });
    render(<ActionProbe resource={RESOURCE} />);
    expect(screen.getByTestId("action").getAttribute("data-present")).toBe("false");
  });
});
