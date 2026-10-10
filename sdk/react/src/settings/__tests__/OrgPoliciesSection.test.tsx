/**
 * The Policies settings section edits the active organization's policies
 * through OrgPoliciesPanel, named by the organization's id, and prompts for
 * an organization when none is selected. The organization context and the
 * panel are stubbed: the panel only records the organization it was given.
 */
import { create } from "@bufbuild/protobuf";
import { cleanup, render, screen } from "@testing-library/react";
import { OrganizationSchema, type Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { afterEach, describe, expect, it, vi } from "vitest";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  activeOrg: null as Organization | null,
  given: [] as string[],
}));

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({ activeOrg: state.activeOrg }),
}));

vi.mock("../../organization/OrgPoliciesPanel.js", () => ({
  OrgPoliciesPanel: ({ org }: { org: string }) => {
    state.given.push(org);
    return null;
  },
}));

import { OrgPoliciesSection } from "../OrgPoliciesSection";

afterEach(() => {
  cleanup();
  state.activeOrg = null;
  state.given = [];
});

describe("OrgPoliciesSection", () => {
  it("edits the active organization's policies, named by its id", () => {
    state.activeOrg = create(OrganizationSchema, { metadata: { id: ACME_ID, slug: "acme" } });
    render(<OrgPoliciesSection />);
    expect(screen.getByRole("heading", { name: "Policies" })).toBeTruthy();
    expect(state.given).toEqual([ACME_ID]);
  });

  it("prompts for an organization when none is selected", () => {
    render(<OrgPoliciesSection />);
    expect(screen.getByText("Select an organization to view its policies.")).toBeTruthy();
    expect(state.given).toEqual([]);
  });
});
