/**
 * OrgSwitcher picks organizations by id: it lists every organization in the
 * order the server returns them, choosing one in the menu makes it active
 * (and remembered by id) and reports the choice, choosing the active one
 * again does nothing, and an organization created from the menu becomes the
 * active one once the list is fetched again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "../../context";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { OrgProvider, useActiveOrgId } from "../OrgProvider";
import { OrgSwitcher } from "../OrgSwitcher";
import { ACME_ID, GLOBEX_ID } from "./org-fixture";

afterEach(cleanup);

const INITECH_ID = "org_01jcccccccccccccccccccccccc";

function org(id: string, slug: string): Organization {
  return { metadata: { id, slug, name: slug }, spec: {} } as Organization;
}

const ACME = org(ACME_ID, "acme");
const GLOBEX = org(GLOBEX_ID, "globex");
const INITECH = org(INITECH_ID, "initech");

/** Each fetch answers the next list; the last one repeats. */
function clientFor(lists: Organization[][], create = vi.fn()) {
  let calls = 0;
  const findMyOrganizations = vi.fn(async () => {
    const entries = lists[Math.min(calls, lists.length - 1)];
    calls += 1;
    return { entries };
  });
  return { organization: { findMyOrganizations, create } };
}

function ActiveId() {
  return <output aria-label="active org">{useActiveOrgId()}</output>;
}

function renderSwitcher(client: unknown, onOrgChanged = vi.fn()) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        <OrgProvider>{children}</OrgProvider>
      </StigmerContext.Provider>
    );
  }
  render(
    <>
      <OrgSwitcher onOrgChanged={onOrgChanged} />
      <ActiveId />
    </>,
    { wrapper: Wrapper },
  );
  return onOrgChanged;
}

describe("OrgSwitcher", () => {
  beforeEach(() => localStorage.clear());

  it("lists every organization in the order the server returns them", async () => {
    renderSwitcher(clientFor([[GLOBEX, ACME, INITECH]]));
    await waitFor(() => expect(screen.getByLabelText("active org").textContent).toBe(GLOBEX_ID));

    await openMenu(screen.getByRole("button", { name: "Organization menu" }));
    const names = screen.getAllByRole("menuitemradio").map((item) => item.textContent);
    expect(names).toEqual(["globexglobex", "acmeacme", "initechinitech"]);
  });

  it("switches to the organization chosen by its id and remembers the id", async () => {
    const onOrgChanged = renderSwitcher(clientFor([[ACME, GLOBEX]]));
    await waitFor(() => expect(screen.getByLabelText("active org").textContent).toBe(ACME_ID));

    await openMenu(screen.getByRole("button", { name: "Organization menu" }));
    const active = screen.getByRole("menuitemradio", { name: /acme/ });
    expect(active.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /globex/ }));

    await waitFor(() => expect(screen.getByLabelText("active org").textContent).toBe(GLOBEX_ID));
    expect(onOrgChanged).toHaveBeenCalledWith(GLOBEX);
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(GLOBEX_ID);
  });

  it("does nothing when the active organization is chosen again", async () => {
    const onOrgChanged = renderSwitcher(clientFor([[ACME, GLOBEX]]));
    await waitFor(() => expect(screen.getByLabelText("active org").textContent).toBe(ACME_ID));

    await openMenu(screen.getByRole("button", { name: "Organization menu" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /acme/ }));

    expect(onOrgChanged).not.toHaveBeenCalled();
    expect(screen.getByLabelText("active org").textContent).toBe(ACME_ID);
  });

  it("makes an organization created from the menu the active one", async () => {
    const create = vi.fn().mockResolvedValue(INITECH);
    const onOrgChanged = renderSwitcher(clientFor([[ACME, GLOBEX], [ACME, GLOBEX, INITECH]], create));
    await waitFor(() => expect(screen.getByLabelText("active org").textContent).toBe(ACME_ID));

    await openMenu(screen.getByRole("button", { name: "Organization menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create organization" }));
    fireEvent.change(await screen.findByPlaceholderText("e.g. Acme Corp"), {
      target: { value: "initech" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));

    await waitFor(() => expect(screen.getByLabelText("active org").textContent).toBe(INITECH_ID));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "initech", slug: "initech" }));
    expect(onOrgChanged).toHaveBeenCalledWith(INITECH);
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(INITECH_ID);
  });
});
