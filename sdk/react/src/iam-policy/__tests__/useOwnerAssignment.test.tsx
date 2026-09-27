/**
 * Pins useOwnerAssignment, the console's one reading of the owner rule: it
 * asks `can_assign_roles` on the organization it is given (and nothing
 * without one), and leaves owner out of a role picker exactly when the
 * answer is no. The permission hook is stubbed: it is proven by its own
 * tests, fail-open posture included.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

const check = vi.hoisted(() => ({
  allowed: false,
  asked: [] as Array<{ resource: { kind: string; id: string } | null; relation: string }>,
}));

vi.mock("../useCheckPermission.js", () => ({
  useCheckPermission: (resource: { kind: string; id: string } | null, relation: string) => {
    check.asked.push({ resource, relation });
    return { allowed: check.allowed, isLoading: false, error: null };
  },
}));

import { useOwnerAssignment } from "../useOwnerAssignment";

afterEach(() => {
  check.allowed = false;
  check.asked = [];
});

describe("useOwnerAssignment", () => {
  it("asks can_assign_roles on the organization, and leaves owner out when the answer is no", () => {
    const { result } = renderHook(() => useOwnerAssignment("acme"));
    expect(check.asked.at(-1)).toEqual({
      resource: { kind: "organization", id: "acme" },
      relation: "can_assign_roles",
    });
    expect(result.current).toEqual({ canAssignOwner: false, unassignable: [IamRole.owner] });
  });

  it("leaves nothing out for an owner, and hands back the same list on every render", () => {
    check.allowed = true;
    const { result, rerender } = renderHook(() => useOwnerAssignment("acme"));
    const first = result.current.unassignable;
    rerender();
    expect(result.current.canAssignOwner).toBe(true);
    expect(result.current.unassignable).toEqual([]);
    expect(result.current.unassignable).toBe(first);
  });

  it("names no organization to the check when it has none", () => {
    renderHook(() => useOwnerAssignment(null));
    expect(check.asked.at(-1)?.resource).toBeNull();
  });
});
