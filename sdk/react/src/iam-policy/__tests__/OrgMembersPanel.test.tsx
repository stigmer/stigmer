/**
 * Pins OrgMembersPanel's reading of the owner rule (the server asks
 * `can_assign_roles` on the organization before any change to its owner
 * role):
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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  PrincipalAccessSchema,
  type PrincipalAccess,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

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
vi.mock("../usePrincipalsCount.js", () => ({
  usePrincipalsCount: () => ({ count: state.members.length, refetch: () => {} }),
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

afterEach(() => {
  cleanup();
  state.members = [];
  state.canAssignOwner = false;
  state.calls = [];
  state.createFails = false;
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
