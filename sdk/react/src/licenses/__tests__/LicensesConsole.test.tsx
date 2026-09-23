// The licenses console end to end over a mock client: every state (the
// edition notice by provider and by server answer, the access notice, the
// empty calendar), the calendar's order and summary, the detail's ticket
// (read on open, copied without being shown), the issue path (the SDK input
// sent, landing on the detail with the created ticket and no second read),
// the refusals (a contract rule before sending, a duplicate from the
// server), the new-customer duplicate guard and Renew's pre-fill.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { StigmerError, type LicenseInput } from "@stigmer/sdk";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { LicenseTerm } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { LicensesConsole } from "../LicensesConsole";
import { license, type LicenseFixture } from "./fixtures";

const NOW = new Date("2026-09-28T09:00:00Z");

interface MockLicenseClient {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

function mockClient(overrides: Partial<MockLicenseClient> = {}): { license: MockLicenseClient } {
  return {
    license: {
      list: vi.fn().mockResolvedValue({ entries: [] }),
      get: vi.fn(),
      create: vi.fn(),
      ...overrides,
    },
  };
}

function renderConsole(client: unknown, mode: "local" | "cloud" = "cloud") {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <DeploymentModeContext.Provider value={mode}>
          <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
        </DeploymentModeContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return render(<LicensesConsole now={NOW} />, { wrapper: Wrapper });
}

const trialFirst = license({
  id: "lic_trial",
  term: LicenseTerm.trial,
  issuedAt: "2026-09-01T00:00:00Z",
  expiresAt: "2026-10-01T00:00:00Z",
  maxUsers: 5,
  maxOrganizations: 1,
});
const PAID_RENEWAL: LicenseFixture = {
  id: "lic_paid",
  issuedAt: "2026-09-25T00:00:00Z",
  expiresAt: "2027-10-01T00:00:00Z",
  graceUntil: "2027-10-31T00:00:00Z",
  maxUsers: 50,
  features: [Feature.sso_enforcement, Feature.platform_client],
  notes: "PO 4411",
};
const paidRenewal = license(PAID_RENEWAL);
const globexExpiring = license({
  id: "lic_globex",
  customerId: "cus_globex",
  customerName: "Globex",
  contactEmail: "it@globex.test",
  issuedAt: "2025-10-01T00:00:00Z",
  expiresAt: "2026-10-01T00:00:00Z",
});

function rowNames(): string[] {
  const table = screen.getByRole("table", { name: "Licenses" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("button")[0]?.textContent ?? "");
}

afterEach(() => {
  cleanup();
});

describe("LicensesConsole states", () => {
  it("says the edition does not issue licenses, without asking the server", () => {
    const client = mockClient();
    renderConsole(client, "local");
    expect(screen.getByRole("status").textContent).toMatch(/issued from the Stigmer Cloud console/);
    expect(screen.getByRole("heading", { name: "Licenses" })).toBeTruthy();
    expect(client.license.list).not.toHaveBeenCalled();
  });

  it("says the same when the server answers that it does not implement licenses", async () => {
    renderConsole(
      mockClient({ list: vi.fn().mockRejectedValue(new StigmerError("unknown", "not implemented", 12)) }),
    );
    await waitFor(() => expect(screen.getByText(/issued from the Stigmer Cloud console/)).toBeTruthy());
  });

  it("shows the access notice to a non-operator", async () => {
    renderConsole(
      mockClient({
        list: vi.fn().mockRejectedValue(new StigmerError("permission-denied", "only platform operators", 7)),
      }),
    );
    await waitFor(() => expect(screen.getByText("Platform operator access required")).toBeTruthy());
  });

  it("invites the first issue when nothing has been issued", async () => {
    const user = userEvent.setup();
    renderConsole(mockClient());
    await waitFor(() => expect(screen.getByText("No licenses issued yet")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /Issue license/ }));
    expect(screen.getByRole("heading", { name: "Issue license" })).toBeTruthy();
  });
});

describe("LicensesConsole calendar", () => {
  it("summarizes customers and lists what needs action first, renewed licenses last", async () => {
    renderConsole(mockClient({ list: vi.fn().mockResolvedValue({ entries: [trialFirst, paidRenewal, globexExpiring] }) }));
    await waitFor(() => expect(screen.getByRole("table", { name: "Licenses" })).toBeTruthy());

    expect(screen.getByText("1 active · 1 expiring · 0 in grace")).toBeTruthy();
    expect(rowNames()).toEqual(["Globex", "Acme Corp", "Acme Corp"]);
    const rows = within(screen.getByRole("table", { name: "Licenses" })).getAllByRole("row");
    expect(within(rows[1]!).getByText("Expiring")).toBeTruthy();
    expect(within(rows[2]!).getByText("Active")).toBeTruthy();
    expect(within(rows[3]!).getByText("Renewed")).toBeTruthy();
    expect(within(rows[2]!).getByText("2027-09-30")).toBeTruthy();
    const entitlements = within(within(rows[3]!).getAllByRole("cell")[2]!);
    expect(entitlements.getByText("5 users")).toBeTruthy();
    expect(entitlements.getByText("1 organization")).toBeTruthy();
    expect(entitlements.getByText("1 feature")).toBeTruthy();
  });
});

describe("LicensesConsole detail", () => {
  it("reads the ticket as it opens and copies it without showing it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    const client = mockClient({
      list: vi.fn().mockResolvedValue({ entries: [paidRenewal] }),
      get: vi.fn().mockResolvedValue(license({ ...PAID_RENEWAL, ticket: "eyJhbGciOiJFZERTQSJ9.payload.sig" })),
    });
    renderConsole(client);

    await user.click(await screen.findByRole("button", { name: "Acme Corp" }));
    expect(client.license.get).toHaveBeenCalledWith("lic_paid");
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("PO 4411")).toBeTruthy();
    expect(screen.getByText("SSO enforcement")).toBeTruthy();
    expect(screen.queryByText(/eyJhbGciOiJFZERTQSJ9/)).toBeNull();

    const copy = await screen.findByRole("button", { name: /Copy ticket/ });
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith("eyJhbGciOiJFZERTQSJ9.payload.sig");
    expect(screen.queryByText(/eyJhbGciOiJFZERTQSJ9/)).toBeNull();

    await user.click(screen.getByRole("button", { name: /Show ticket/ }));
    expect(screen.getByText("eyJhbGciOiJFZERTQSJ9.payload.sig")).toBeTruthy();
  });
});

describe("LicensesConsole issue", () => {
  it("issues to a new customer and lands on the detail with the created ticket", async () => {
    const user = userEvent.setup();
    const created = license({
      id: "lic_new",
      customerId: "cus_new",
      customerName: "Initech",
      contactEmail: "ops@initech.test",
      issuedAt: NOW.toISOString(),
      expiresAt: "2027-09-28T00:00:00Z",
      graceUntil: "2027-10-28T00:00:00Z",
      ticket: "created.ticket.sig",
    });
    const client = mockClient({ create: vi.fn().mockResolvedValue(created) });
    renderConsole(client);

    await user.click(await screen.findByRole("button", { name: /Issue license/ }));
    await user.type(screen.getByLabelText(/Display name/), "Initech");
    await user.type(screen.getByLabelText(/Contact email/), "ops@initech.test");
    await user.click(screen.getByLabelText(/Paid/));
    await user.type(screen.getByLabelText(/Max users/), "25");
    await user.click(screen.getByLabelText(/Channels/));
    expect(screen.getByText("Paid license for Initech until 2027-09-27")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Issue license" }));

    expect(client.license.create).toHaveBeenCalledTimes(1);
    const input = client.license.create.mock.calls[0]![0] as LicenseInput;
    expect(input).toMatchObject({
      name: "Paid license for Initech until 2027-09-27",
      org: "",
      customer: { displayName: "Initech", contactEmail: "ops@initech.test" },
      entitlements: { limits: { maxUsers: 25 }, features: [Feature.channels] },
      term: LicenseTerm.paid,
      expiresAt: new Date("2027-09-28T00:00:00Z"),
      graceUntil: new Date("2027-10-28T00:00:00Z"),
    });
    expect(input.customer.id).toMatch(/^cus_[0-9a-hjkmnp-tv-z]{26}$/);

    await waitFor(() => expect(screen.getByText(/License issued and signed/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Copy ticket/ })).toBeTruthy();
    expect(client.license.get).not.toHaveBeenCalled();
  });

  it("holds a draft that breaks a contract rule and says which field", async () => {
    const user = userEvent.setup();
    const client = mockClient();
    renderConsole(client);

    await user.click(await screen.findByRole("button", { name: /Issue license/ }));
    await user.type(screen.getByLabelText(/Display name/), "Initech");
    await user.type(screen.getByLabelText(/Contact email/), "not-an-address");
    expect(screen.getByText("Enter the address renewal notices go to.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Issue license" }));
    expect(client.license.create).not.toHaveBeenCalled();
  });

  it("explains a duplicate issue refused by the server", async () => {
    const user = userEvent.setup();
    const client = mockClient({
      create: vi.fn().mockRejectedValue(new StigmerError("already-exists", "license already exists", 6)),
    });
    renderConsole(client);

    await user.click(await screen.findByRole("button", { name: /Issue license/ }));
    await user.type(screen.getByLabelText(/Display name/), "Initech");
    await user.type(screen.getByLabelText(/Contact email/), "ops@initech.test");
    await user.click(screen.getByRole("button", { name: "Issue license" }));
    await waitFor(() => expect(screen.getByText(/This license was already issued/)).toBeTruthy());
  });

  it("steers a new customer that duplicates an existing one back to the picker", async () => {
    const user = userEvent.setup();
    renderConsole(mockClient({ list: vi.fn().mockResolvedValue({ entries: [globexExpiring] }) }));

    await user.click(await screen.findByRole("button", { name: /Issue license/ }));
    await user.click(screen.getByLabelText("New customer"));
    await user.type(screen.getByLabelText(/Contact email/), "IT@globex.test");
    await user.click(screen.getByRole("button", { name: "Use Globex" }));
    expect((screen.getByLabelText(/Licensed customer/) as HTMLSelectElement).value).toBe("cus_globex");
  });

  it("renews from the customer's current license with its terms and continued coverage", async () => {
    const user = userEvent.setup();
    const client = mockClient({
      list: vi.fn().mockResolvedValue({ entries: [globexExpiring] }),
      get: vi.fn().mockResolvedValue(globexExpiring),
    });
    renderConsole(client);

    await user.click(await screen.findByRole("button", { name: "Globex" }));
    await user.click(screen.getByRole("button", { name: /Renew/ }));
    expect(screen.getByRole("heading", { name: "Renew license" })).toBeTruthy();
    // A renewal's customer is fixed and said as text: no picker to change it.
    const customerSection = screen.getByRole("region", { name: "Customer" });
    expect(within(customerSection).getByText("Globex")).toBeTruthy();
    expect(within(customerSection).queryByRole("combobox")).toBeNull();
    expect((screen.getByLabelText(/Paid/) as HTMLInputElement).checked).toBe(true);
    // Covered through 2026-09-30, so the renewal starts 2026-10-01.
    expect(screen.getByText("Paid license for Globex until 2027-09-30")).toBeTruthy();
  });
});