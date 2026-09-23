/**
 * Pins useShareFlow's two decisions that could regress unnoticed:
 *
 *   - removing a grantee revokes EVERY role it holds directly on the
 *     resource, each as the grantee's exact wire reference: a team as
 *     `team:<id>#member`, which the server's revoke matches exactly, and
 *     never a role it inherits from a parent level (that grant is not the
 *     resource's to remove);
 *   - `canShareWithTeams` is true only where the edition serves teams AND
 *     the resource kind accepts a team grant.
 *
 * The data and mutation hooks under it are stubbed; the access list is the
 * one a server returns for an agent channel shared with a team as both
 * participant and viewer, beside a person.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  PrincipalAccessSchema,
  type PrincipalAccess,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { teamGrantee, type DeploymentMode } from "@stigmer/sdk";
import { DeploymentModeContext } from "../../deployment-mode";

const stubs = vi.hoisted(() => ({
  members: [] as PrincipalAccess[],
  remove: vi.fn(async (_spec: IamPolicySpec) => ({})),
  refetch: vi.fn(),
}));

vi.mock("../useResourceAccess.js", () => ({
  useResourceAccess: () => ({
    members: stubs.members,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: stubs.refetch,
  }),
}));
vi.mock("../useCreateIamPolicy.js", () => ({
  useCreateIamPolicy: () => ({
    create: async () => ({}),
    isCreating: false,
    error: null,
    clearError: () => {},
  }),
}));
vi.mock("../useDeleteIamPolicy.js", () => ({
  useDeleteIamPolicy: () => ({
    remove: stubs.remove,
    isDeleting: false,
    error: null,
    clearError: () => {},
  }),
}));

import { useShareFlow } from "../useShareFlow";

function wrapper(mode: DeploymentMode) {
  return ({ children }: { children: ReactNode }) => (
    <DeploymentModeContext.Provider value={mode}>{children}</DeploymentModeContext.Provider>
  );
}

afterEach(() => {
  stubs.members = [];
  stubs.remove.mockClear();
  stubs.refetch.mockClear();
});

describe("useShareFlow — revoke", () => {
  it("revokes every direct role of a team as its members, and nothing it inherits or another grantee holds", async () => {
    stubs.members = [
      create(PrincipalAccessSchema, {
        principal: { kind: "team", id: "tm_sre", relation: "member", name: "SRE" },
        roles: [
          { role: { code: "participant" } },
          { role: { code: "viewer" } },
          { role: { code: "admin" }, isInherited: true },
        ],
      }),
      create(PrincipalAccessSchema, {
        principal: { kind: "identity_account", id: "tm_sre", relation: "", name: "Same id, a person" },
        roles: [{ role: { code: "viewer" } }],
      }),
    ];
    const { result } = renderHook(
      () =>
        useShareFlow({ kind: "agent_channel", id: "ach_1", resourceKind: ApiResourceKind.agent_channel }),
      { wrapper: wrapper("enterprise") },
    );

    await act(() => result.current.revoke(teamGrantee("tm_sre")));

    const sent = stubs.remove.mock.calls.map(([spec]) => [
      spec.principal?.kind,
      spec.principal?.id,
      spec.principal?.relation,
      spec.resource?.kind,
      spec.resource?.id,
      spec.relation,
    ]);
    expect(sent).toEqual([
      ["team", "tm_sre", "member", "agent_channel", "ach_1", "participant"],
      ["team", "tm_sre", "member", "agent_channel", "ach_1", "viewer"],
    ]);
    expect(stubs.refetch).toHaveBeenCalled();
  });
});

describe("useShareFlow — canShareWithTeams", () => {
  const cases: ReadonlyArray<[DeploymentMode, ApiResourceKind, string, boolean]> = [
    ["local", ApiResourceKind.agent, "agent", false],
    ["enterprise", ApiResourceKind.agent, "agent", true],
    ["cloud", ApiResourceKind.agent, "agent", true],
    // Every organization viewer already reads every artifact.
    ["enterprise", ApiResourceKind.artifact, "artifact", false],
    // Circular with the membership bound.
    ["enterprise", ApiResourceKind.organization, "organization", false],
  ];
  it.each(cases)("on %s for %s kind %s is %s", (mode, resourceKind, kind, expected) => {
    const { result } = renderHook(() => useShareFlow({ kind, id: "x1", resourceKind }), {
      wrapper: wrapper(mode),
    });
    expect(result.current.canShareWithTeams).toBe(expected);
  });
});
