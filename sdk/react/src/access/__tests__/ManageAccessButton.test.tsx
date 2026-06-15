import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ManageAccessButton } from "../ManageAccessButton";

// Drive the gate through the permission hook that PermissionGate consumes, and
// stand in a lightweight dialog so we can assert the trigger's open-state wiring
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

const RESOURCE = {
  kind: ApiResourceKind.session,
  kindString: "session",
  id: "ses_123",
  org: "acme",
} as const;

describe("ManageAccessButton", () => {
  it("renders nothing when the user cannot view access", () => {
    checkPermission.mockReturnValue({ allowed: false, isLoading: false, error: null });
    render(<ManageAccessButton resource={RESOURCE} />);

    expect(screen.queryByRole("button", { name: /Manage access/i })).toBeNull();
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("renders the trigger and a closed dialog when permitted", () => {
    render(<ManageAccessButton resource={RESOURCE} />);

    expect(screen.getByRole("button", { name: /Manage access/i })).toBeTruthy();
    expect(screen.getByTestId("dialog").getAttribute("data-open")).toBe("false");
  });

  it("opens the dialog on click", () => {
    render(<ManageAccessButton resource={RESOURCE} />);

    fireEvent.click(screen.getByRole("button", { name: /Manage access/i }));
    expect(screen.getByTestId("dialog").getAttribute("data-open")).toBe("true");
  });

  it("honors a custom label", () => {
    render(<ManageAccessButton resource={RESOURCE} label="Share" />);
    expect(screen.getByRole("button", { name: /Share/i })).toBeTruthy();
  });
});
