/**
 * Pins who OrgMembersPanel calls a member, and its reading of the owner rule
 * (the server asks `can_assign_roles` on the organization before any change
 * to its owner role).
 *
 * Who is a member: the organization's access list also holds the accounts a
 * PlatformClient provisioned for the organization's own product, each with
 * its auto-grant role. The panel lists and counts the organization's people
 * only; those accounts sit apart in a collapsed group that names how many
 * there are, whose Remove says that signing in through the product again
 * does not restore the access. The count is read from the list itself, so
 * it always equals the rows shown.
 *
 * The owner rule:
 *
 *   - a caller who may not assign owner is offered no change and no removal
 *     on an owner's row, and no owner in the role picker for anyone else;
 *     an owner is offered all of them;
 *   - a role change grants the new role before it revokes the old one, so
 *     a refused grant leaves the member with the role they had.
 *
 * The data hooks are stubbed: each is proven by its own tests, and the
 * permission answer is the one question this panel adds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  PrincipalAccessSchema,
  type PrincipalAccess,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

const state = vi.hoisted(() => ({
  members: [] as PrincipalAccess[],
  canAssignOwner: false,
  calls: [] as string[],
  createFails: false,
}));

vi.mock("../useResourceAccess.js", () => ({
  useResourceAccess: () => ({
    members: state.members,
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));
vi.mock("../useWhoAmI.js", () => ({
  useWhoAmI: () => ({ account: { metadata: { id: "ida_me" } } }),
}));
vi.mock("../useOwnerAssignment.js", () => ({
  useOwnerAssignment: () => ({
    canAssignOwner: state.canAssignOwner,
    unassignable: state.canAssignOwner ? [] : [IamRole.owner],
  }),
}));
vi.mock("../useRevokeOrgAccess.js", () => ({
  useRevokeOrgAccess: () => ({ revoke: async () => {}, isRevoking: false, error: null }),
}));
vi.mock("../useCreateIamPolicy.js", () => ({
  useCreateIamPolicy: () => ({
    create: async (spec: IamPolicySpec) => {
      state.calls.push(`create ${spec.relation}`);
      if (state.createFails) {
        throw new Error("only an owner of the organization can grant, revoke or remove the owner role");
      }
    },
    isCreating: false,
  }),
}));
vi.mock("../useDeleteIamPolicy.js", () => ({
  useDeleteIamPolicy: () => ({
    remove: async (spec: IamPolicySpec) => {
      state.calls.push(`delete ${spec.relation}`);
    },
    isDeleting: false,
  }),
}));

import { OrgMembersPanel } from "../OrgMembersPanel";

function member(id: string, name: string, role: string): PrincipalAccess {
  return create(PrincipalAccessSchema, {
    principal: { kind: "identity_account", id, name },
    roles: [{ role: { code: role, name: role } }],
  });
}

/** An account a PlatformClient provisioned, holding its auto-grant role. */
function productUser(id: string, name: string, role = "viewer"): PrincipalAccess {
  return create(PrincipalAccessSchema, {
    principal: {
      kind: "identity_account",
      id,
      name,
      identityOrigin: { provisioningMode: IdentityAccountProvisioningMode.platform_client },
    },
    roles: [{ role: { code: role, name: role } }],
  });
}

/** The count badge beside the "Members" heading, or `null` when none shows. */
function membersBadge(): string | null {
  return screen.getByText("Members").nextElementSibling?.textContent ?? null;
}

const PRODUCT_GROUP = /^Users from your product/;

afterEach(() => {
  cleanup();
  state.members = [];
  state.canAssignOwner = false;
  state.calls = [];
  state.createFails = false;
});

describe("OrgMembersPanel and who is a member", () => {
  it("lists and counts the organization's people, not the accounts its product provisioned", () => {
    state.members = [
      member("ida_root", "Root", "owner"),
      productUser("ida_pc_1", "Customer One"),
      member("ida_dave", "Dave", "member"),
    ];
    render(<OrgMembersPanel orgId="acme" />);

    const people = within(screen.getByRole("list", { name: "Organization members" }));
    expect(people.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Root"),
      expect.stringContaining("Dave"),
    ]);
    expect(membersBadge()).toBe("2");
    expect(screen.queryByText("Customer One")).toBeNull();
  });

  it("keeps the product's users in a collapsed group that names how many there are", () => {
    state.members = [
      member("ida_dave", "Dave", "member"),
      productUser("ida_pc_1", "Customer One"),
      productUser("ida_pc_2", "Customer Two"),
    ];
    render(<OrgMembersPanel orgId="acme" />);

    const toggle = screen.getByRole("button", { name: PRODUCT_GROUP });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("2");
    expect(screen.queryByRole("list", { name: "Users from your product" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const group = within(screen.getByRole("list", { name: "Users from your product" }));
    expect(group.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Customer One"),
      expect.stringContaining("Customer Two"),
    ]);

    fireEvent.click(toggle);
    expect(screen.queryByRole("list", { name: "Users from your product" })).toBeNull();
  });

  it("says, before removing one of the product's users, that signing in again does not restore the access", () => {
    state.members = [member("ida_dave", "Dave", "member"), productUser("ida_pc_1", "Customer One")];
    render(<OrgMembersPanel orgId="acme" />);

    fireEvent.click(screen.getByRole("button", { name: PRODUCT_GROUP }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Customer One" }));
    expect(screen.getByText(/signing in through it again does not restore it/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Dave" }));
    expect(screen.getByText(/This revokes all their access/)).toBeTruthy();
    expect(screen.queryByText(/does not restore it/)).toBeNull();
  });

  it("holds the owner rule in the product's group too", () => {
    state.members = [member("ida_dave", "Dave", "member"), productUser("ida_pc_owner", "Promoted", "owner")];
    render(<OrgMembersPanel orgId="acme" />);

    fireEvent.click(screen.getByRole("button", { name: PRODUCT_GROUP }));
    expect(screen.queryByRole("button", { name: "Remove Promoted" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change role for Promoted" })).toBeNull();
  });

  it("renders no group when no account came from the product, and says so when only such accounts hold a role", () => {
    state.members = [member("ida_dave", "Dave", "member")];
    render(<OrgMembersPanel orgId="acme" />);
    expect(screen.queryByRole("button", { name: PRODUCT_GROUP })).toBeNull();
    cleanup();

    state.members = [productUser("ida_pc_1", "Customer One")];
    render(<OrgMembersPanel orgId="acme" />);
    expect(screen.getByText("No members found.")).toBeTruthy();
    expect(membersBadge()).toBeNull();
    expect(screen.getByRole("button", { name: PRODUCT_GROUP })).toBeTruthy();
  });
});

describe("OrgMembersPanel and the owner role", () => {
  it("offers a caller who is no owner nothing on an owner's row, and no owner in the picker", () => {
    state.members = [member("ida_root", "Root", "owner"), member("ida_dave", "Dave", "member")];
    render(<OrgMembersPanel orgId="acme" />);

    expect(screen.queryByRole("button", { name: "Change role for Root" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Root" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Dave" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Change role for Dave" }));
    expect(screen.queryByRole("radio", { name: /^Owner/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /^Admin/ })).toBeTruthy();
  });

  it("offers an owner every control on every row, owner in the picker included", () => {
    state.canAssignOwner = true;
    state.members = [member("ida_root", "Root", "owner"), member("ida_dave", "Dave", "member")];
    render(<OrgMembersPanel orgId="acme" />);

    expect(screen.getByRole("button", { name: "Remove Root" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change role for Dave" }));
    expect(screen.getByRole("radio", { name: /^Owner/ })).toBeTruthy();
  });

  it("grants the new role before it revokes the old one", async () => {
    state.canAssignOwner = true;
    state.members = [member("ida_dave", "Dave", "member")];
    render(<OrgMembersPanel orgId="acme" />);

    fireEvent.click(screen.getByRole("button", { name: "Change role for Dave" }));
    fireEvent.click(screen.getByRole("radio", { name: /^Admin/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(state.calls).toEqual(["create admin", "delete member"]));
  });

  it("revokes nothing when the new role is refused, so the member keeps the one they had", async () => {
    state.canAssignOwner = true;
    state.createFails = true;
    state.members = [member("ida_dave", "Dave", "member")];
    render(<OrgMembersPanel orgId="acme" />);

    fireEvent.click(screen.getByRole("button", { name: "Change role for Dave" }));
    fireEvent.click(screen.getByRole("radio", { name: /^Owner/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(state.calls).toEqual(["create owner"]);
  });
});
