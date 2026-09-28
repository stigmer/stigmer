// The operator's plan catalog over a mock client: the access notice for
// anyone without can_manage_plans (the catalog itself is never read for
// them), the list with retired rows and features not yet offered marked,
// retiring through the confirm, and creating through the review step.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { PlanCatalogConsole } from "../PlanCatalogConsole";
import { BUSINESS, RETIRED, TEAM } from "../../billing/__tests__/fixtures";

afterEach(cleanup);

function mockClient(operator: boolean) {
  return {
    plan: {
      list: vi.fn().mockResolvedValue({ entries: [TEAM, BUSINESS, RETIRED] }),
      retire: vi.fn().mockResolvedValue(TEAM),
      create: vi.fn().mockResolvedValue(TEAM),
    },
    iamPolicy: { checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: operator }) },
  };
}

function renderConsole(client: unknown) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <DeploymentModeContext.Provider value="cloud">
          <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
        </DeploymentModeContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return render(<PlanCatalogConsole />, { wrapper: Wrapper });
}

describe("PlanCatalogConsole", () => {
  it("shows anyone without can_manage_plans the access notice, and reads nothing", async () => {
    const client = mockClient(false);
    renderConsole(client);
    expect(await screen.findByText("Platform operator access required")).toBeTruthy();
    expect(client.plan.list).not.toHaveBeenCalled();
  });

  it("lists every plan, retired ones included, marking a feature not offered yet", async () => {
    renderConsole(mockClient(true));
    const catalog = await screen.findByRole("list", { name: "Plan catalog" });
    expect(within(catalog).getAllByText("On sale")).toHaveLength(2);
    expect(within(catalog).getByText("Retired")).toBeTruthy();
    expect(within(catalog).getByText(/Bring your own provider keys \(not offered yet\)/)).toBeTruthy();
  });

  it("retires a plan only after the confirm", async () => {
    const client = mockClient(true);
    renderConsole(client);
    const catalog = await screen.findByRole("list", { name: "Plan catalog" });
    await userEvent.click(within(catalog).getAllByRole("button", { name: "Retire" })[0]!);
    expect(client.plan.retire).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Retire" }));
    await waitFor(() => expect(client.plan.retire).toHaveBeenCalledWith("pln_team"));
  });

  it("creates a plan after the review says its terms are final", async () => {
    const client = mockClient(true);
    renderConsole(client);
    await userEvent.click(await screen.findByRole("button", { name: "New plan" }));
    const form = screen.getByRole("form", { name: "New plan" });
    await userEvent.type(within(form).getByLabelText(/^Name/), "Team 2027");
    await userEvent.type(within(form).getByLabelText(/^Handle/), "team-2027");
    await userEvent.type(within(form).getByLabelText(/^Monthly minimum/), "129");
    await userEvent.click(within(form).getByRole("button", { name: "Review" }));
    expect(within(form).getByText(/terms are final once it exists/)).toBeTruthy();
    expect(client.plan.create).not.toHaveBeenCalled();
    await userEvent.click(within(form).getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(client.plan.create).toHaveBeenCalledTimes(1));
    expect(client.plan.create.mock.calls[0]?.[0]).toMatchObject({ name: "Team 2027", slug: "team-2027", org: "" });
  });
});
