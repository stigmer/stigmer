import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ManageAccessDialog } from "../ManageAccessDialog";

// The dialog's job is composition + conditional section rendering — not the
// behavior of the lower-level controls, which own their own tests. Stub the
// two heavy children to assert *which* sections mount, and pin the
// proto-generated capability so the People gate is deterministic.
const hasGrantableRolesMock = vi.fn<(kind: ApiResourceKind) => boolean>(() => true);
vi.mock("@stigmer/sdk", async (importActual) => {
  const actual = await importActual<typeof import("@stigmer/sdk")>();
  return { ...actual, hasGrantableRoles: (kind: ApiResourceKind) => hasGrantableRolesMock(kind) };
});

vi.mock("../../iam-policy/PeopleWithAccess", () => ({
  PeopleWithAccess: () => <div data-testid="people-with-access" />,
}));

vi.mock("../../library/ResourceVisibilityControl", () => ({
  ResourceVisibilityControl: () => <div data-testid="visibility-control" />,
}));

// happy-dom does not implement the native dialog show/close methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  hasGrantableRolesMock.mockReset();
  hasGrantableRolesMock.mockReturnValue(true);
});

const RESOURCE = {
  kind: ApiResourceKind.agent,
  kindString: "agent",
  id: "agt_123",
  org: "acme",
  name: "Release Bot",
} as const;

describe("ManageAccessDialog", () => {
  it("mounts no body while closed (the access-list fetch stays lazy)", () => {
    render(
      <ManageAccessDialog
        open={false}
        onOpenChange={() => {}}
        resource={RESOURCE}
      />,
    );

    expect(screen.queryByText("Manage access")).toBeNull();
    expect(screen.queryByTestId("people-with-access")).toBeNull();
  });

  it("renders the header with the resource name when open", () => {
    render(
      <ManageAccessDialog open onOpenChange={() => {}} resource={RESOURCE} />,
    );

    expect(screen.getByText("Manage access")).toBeTruthy();
    expect(screen.getByText("Release Bot")).toBeTruthy();
  });

  it("renders General access only when a visibility descriptor is provided", () => {
    const { rerender } = render(
      <ManageAccessDialog open onOpenChange={() => {}} resource={RESOURCE} />,
    );
    expect(screen.queryByTestId("visibility-control")).toBeNull();

    rerender(
      <ManageAccessDialog
        open
        onOpenChange={() => {}}
        resource={RESOURCE}
        visibility={{
          kind: "agent",
          current: ApiResourceVisibility.visibility_private,
          org: "acme",
        }}
      />,
    );
    expect(screen.getByTestId("visibility-control")).toBeTruthy();
    expect(screen.getByText("General access")).toBeTruthy();
  });

  it("renders People only when the kind has grantable roles", () => {
    hasGrantableRolesMock.mockReturnValue(false);
    const { rerender } = render(
      <ManageAccessDialog open onOpenChange={() => {}} resource={RESOURCE} />,
    );
    expect(screen.queryByTestId("people-with-access")).toBeNull();

    hasGrantableRolesMock.mockReturnValue(true);
    rerender(
      <ManageAccessDialog
        open
        onOpenChange={() => {}}
        resource={{ ...RESOURCE, id: "agt_456" }}
      />,
    );
    expect(screen.getByTestId("people-with-access")).toBeTruthy();
    expect(screen.getByText("People with access")).toBeTruthy();
  });

  it("renders the extra section only when provided", () => {
    render(
      <ManageAccessDialog
        open
        onOpenChange={() => {}}
        resource={RESOURCE}
        extraSection={{
          title: "Run visibility",
          description: "Who can observe runs.",
          content: <div data-testid="run-visibility" />,
        }}
      />,
    );

    expect(screen.getByText("Run visibility")).toBeTruthy();
    expect(screen.getByTestId("run-visibility")).toBeTruthy();
  });

  it("requests close via Done and the close affordance", () => {
    const onOpenChange = vi.fn();
    render(
      <ManageAccessDialog open onOpenChange={onOpenChange} resource={RESOURCE} />,
    );

    // Query by text/label rather than role: a native <dialog> that has not yet
    // run showModal() hides its descendants from the accessibility tree.
    screen.getByText("Done").click();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    screen.getByLabelText("Close").click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
