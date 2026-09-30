/**
 * Pins the permission the visibility control asks before it offers the
 * interactive selector: `can_manage_audience` on the resource, the same bar
 * the server's `updateVisibility` annotations carry. Visibility decides who
 * reaches a resource, so it is the owner's; an editor, who holds `can_edit`
 * and not `can_manage_audience`, gets the read-only badge. Never
 * `can_grant_access`: the self-check answers that false on every kind the
 * edition grants no roles on, which would hide the selector from the owner
 * on open source (stigmer#1495).
 *
 * The gate itself is PermissionGate's to test; here it is stubbed to record
 * the relation it was asked for and render its fallback, so the assertion is
 * about which question the control asks, per kind, and nothing else.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ResourceVisibilityControl } from "../ResourceVisibilityControl";
import type { VisibilityResourceKind } from "../useUpdateVisibility";

vi.mock("../../iam-policy/PermissionGate", () => ({
  PermissionGate: ({
    relation,
    resource,
    fallback,
  }: {
    relation: string;
    resource: { kind: string; id: string };
    fallback?: ReactNode;
    children: ReactNode;
  }) => (
    <div data-testid="gate" data-relation={relation} data-kind={resource.kind}>
      {fallback}
    </div>
  ),
}));

vi.mock("../useUpdateVisibility", () => ({
  useUpdateVisibility: () => ({ updateVisibility: vi.fn(), isPending: false }),
}));

vi.mock("../../identity-provider/useSsoProvider", () => ({
  useSsoProvider: () => ({ ssoProvider: null }),
}));

afterEach(() => {
  cleanup();
});

const KINDS: ReadonlyArray<[VisibilityResourceKind, string]> = [
  ["agent", "agent"],
  ["workflow", "workflow"],
  ["mcpServer", "mcp_server"],
  ["skill", "skill"],
  ["plugin", "plugin"],
  ["agentInstance", "agent_instance"],
  ["workflowInstance", "workflow_instance"],
];

describe("ResourceVisibilityControl", () => {
  it.each(KINDS)(
    "asks can_manage_audience on %s before offering the selector, never can_edit or can_grant_access",
    (kind, fgaKind) => {
      render(
        <ResourceVisibilityControl
          kind={kind}
          resourceId="res_1"
          visibility={ApiResourceVisibility.visibility_private}
          org="acme"
        />,
      );
      const gate = screen.getByTestId("gate");
      expect(gate.getAttribute("data-relation")).toBe("can_manage_audience");
      expect(gate.getAttribute("data-kind")).toBe(fgaKind);
    },
  );
});
