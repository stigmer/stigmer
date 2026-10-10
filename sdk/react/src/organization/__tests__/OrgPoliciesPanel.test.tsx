/**
 * OrgPoliciesPanel: the organization's policies, one instant-save switch
 * each, changed only through `organization.updatePolicies()`:
 *
 *   - an organization that stores no policies holds the defaults (members
 *     may create agents);
 *   - flipping the switch sends every policy, as it should stand, through
 *     updatePolicies, never through update;
 *   - someone without can_edit reads the switch but cannot flip it;
 *   - a refused save shows the server's words beside the switch;
 *   - a failed read offers a retry, and no organization renders nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { UpdateOrganizationPoliciesInput } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { ConnectError, Code } from "@connectrpc/connect";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { OrgPoliciesPanel } from "../OrgPoliciesPanel";
import {
  organizationPoliciesOf,
  useUpdateOrganizationPolicies,
} from "../useUpdateOrganizationPolicies";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

function orgWith(policies?: { membersCanCreateAgents: boolean }): Organization {
  return create(OrganizationSchema, {
    metadata: { id: ACME_ID, name: "Acme Corp", slug: "acme" },
    spec: policies ? { policies } : {},
  });
}

function createMockStigmer(org: Organization, canEdit = true) {
  return {
    organization: {
      get: vi.fn(async () => org),
      update: vi.fn(async () => org),
      updatePolicies: vi.fn(async (_input: UpdateOrganizationPoliciesInput) => org),
    },
    iamPolicy: {
      checkMyPermission: vi.fn(async () => ({ isAuthorized: canEdit })),
    },
  };
}

function renderPanel(client: unknown, org: string = ACME_ID) {
  return render(
    <StigmerContext.Provider value={client as never}>
      <OrgPoliciesPanel org={org} />
    </StigmerContext.Provider>,
  );
}

const REFUSED = new ConnectError("only admins change policies", Code.PermissionDenied);

afterEach(() => {
  cleanup();
});

describe("organizationPoliciesOf", () => {
  it("reads an organization with no stored policies as the defaults", () => {
    expect(organizationPoliciesOf(orgWith())).toEqual({ membersCanCreateAgents: true });
    expect(organizationPoliciesOf(null)).toEqual({ membersCanCreateAgents: true });
  });

  it("reads stored policies as they are", () => {
    expect(organizationPoliciesOf(orgWith({ membersCanCreateAgents: false }))).toEqual({
      membersCanCreateAgents: false,
    });
  });
});

describe("OrgPoliciesPanel", () => {
  it("shows members creating agents as on for an organization with no stored policies", async () => {
    renderPanel(createMockStigmer(orgWith()));
    const toggle = await screen.findByRole("switch", { name: "Members can create agents" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("saves a flip through updatePolicies, with every policy, never through update", async () => {
    const client = createMockStigmer(orgWith());
    renderPanel(client);
    const toggle = await screen.findByRole("switch", { name: "Members can create agents" });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(toggle);

    await waitFor(() => expect(client.organization.updatePolicies).toHaveBeenCalledTimes(1));
    const input = client.organization.updatePolicies.mock.calls[0]![0];
    expect(input.orgId).toBe(ACME_ID);
    expect(input.policies?.membersCanCreateAgents).toBe(false);
    expect(client.organization.update).not.toHaveBeenCalled();
  });

  it("is read-only without can_edit", async () => {
    renderPanel(createMockStigmer(orgWith({ membersCanCreateAgents: false }), false));
    const toggle = await screen.findByRole("switch", { name: "Members can create agents" });
    await waitFor(() =>
      expect(screen.getByText("Only organization admins can change these policies.")).toBeTruthy(),
    );
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});

describe("OrgPoliciesPanel — failures and absence", () => {
  it("shows a refused save beside the switch and keeps the stored value", async () => {
    const client = createMockStigmer(orgWith());
    client.organization.updatePolicies.mockRejectedValueOnce(REFUSED);
    renderPanel(client);
    const toggle = await screen.findByRole("switch", { name: "Members can create agents" });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(toggle);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("offers a retry when the organization cannot be read, and reads it again", async () => {
    const client = createMockStigmer(orgWith());
    client.organization.get.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable),
    );
    renderPanel(client);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("switch", { name: "Members can create agents" })).toBeTruthy();
    expect(client.organization.get).toHaveBeenCalledTimes(2);
  });

  it("renders nothing and asks nothing without an organization", () => {
    const client = createMockStigmer(orgWith());
    const { container } = renderPanel(client, "");
    expect(container.innerHTML).toBe("");
    expect(client.organization.get).not.toHaveBeenCalled();
  });
});

describe("useUpdateOrganizationPolicies", () => {
  function hookWith(client: unknown) {
    return renderHook(() => useUpdateOrganizationPolicies(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      ),
    });
  }

  it("keeps a refused save's error until it is cleared, and rethrows it to the caller", async () => {
    const client = createMockStigmer(orgWith());
    client.organization.updatePolicies.mockRejectedValueOnce(REFUSED);
    const { result } = hookWith(client);

    await act(async () => {
      await expect(
        result.current.updatePolicies(ACME_ID, { membersCanCreateAgents: false }),
      ).rejects.toBe(REFUSED);
    });
    expect(result.current.error?.message).toContain("only admins change policies");
    expect(result.current.isUpdating).toBe(false);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
