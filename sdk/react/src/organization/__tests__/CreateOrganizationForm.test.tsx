/**
 * Pins the create-organization form on the kit's field parts: its name
 * derives the address until the person types one of their own, the
 * address's one-line hint names the address it will use, the description is
 * optional, and the form creates the organization with what was typed. In
 * the switcher's dialog it ends with Cancel beside the act; alone (the
 * organization gate) it offers the act alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const created = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("../useCreateOrganization.js", () => ({
  useCreateOrganization: () => ({
    create: async (input: Record<string, unknown>) => {
      created.calls.push(input);
      return { metadata: { id: "org_1", slug: input.slug } };
    },
    isCreating: false,
    error: null,
    clearError: () => {},
  }),
}));

import { CreateOrganizationForm } from "../CreateOrganizationForm";

afterEach(() => {
  cleanup();
  created.calls.length = 0;
});

describe("CreateOrganizationForm", () => {
  it("derives the address from the name, until the person types their own, and creates with what was typed", async () => {
    const onCreated = vi.fn();
    render(<CreateOrganizationForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("Name"), "Acme Corp");
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("acme-corp");
    expect(screen.getByText("Its short name in links: acme-corp.")).toBeTruthy();

    await userEvent.clear(screen.getByLabelText("Address"));
    await userEvent.type(screen.getByLabelText("Address"), "acme");
    await userEvent.type(screen.getByLabelText(/Description/), "Finance and operations");
    expect(screen.getByText("Its short name in links: acme.")).toBeTruthy();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Acme Finance");
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("acme");

    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect(created.calls).toEqual([{ name: "Acme Finance", slug: "acme", description: "Finance and operations" }]);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("ends with Cancel beside the act in a dialog", async () => {
    const onCancel = vi.fn();
    render(<CreateOrganizationForm onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
