/**
 * OrgEmbeddingPanel: an organization's embedding settings, one form saved
 * whole through `organization.updateEmbedding()`:
 *
 *   - an organization that stores none creates no accounts, grants nothing
 *     and allows every origin;
 *   - the form starts from the stored settings, and a save sends every
 *     setting, its vaults by the id they hold, through updateEmbedding,
 *     and still says so once the new settings are read back;
 *   - an origin is added on Enter as on Add, and an origin or a vault
 *     removed is not sent;
 *   - turning account creation off clears the sign-in role, which is
 *     offered only with it, and owner is never offered;
 *   - someone without can_edit reads the settings and cannot change them,
 *     and is not sent to manage service accounts;
 *   - a refused save shows the server's words; a failed read offers a
 *     retry; the service-account link appears only when given.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import type { ReactNode } from "react";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { UpdateOrganizationEmbeddingInput } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { StigmerContext } from "../../context";
import { OrgEmbeddingPanel, formatSignInRole } from "../OrgEmbeddingPanel";
import {
  organizationEmbeddingOf,
  useUpdateOrganizationEmbedding,
} from "../useUpdateOrganizationEmbedding";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const STORED = {
  allowedOrigins: ["https://app.acme.example"],
  createAccountsOnSignIn: true,
  signInRole: IamRole.member,
  vaults: [{ kind: ApiResourceKind.vault, org: "acme", slug: "product-keys", id: "vlt_keys" }],
};

function orgWith(embedding?: typeof STORED): Organization {
  return create(OrganizationSchema, {
    metadata: { id: ACME_ID, name: "Acme Corp", slug: "acme" },
    spec: embedding ? { embedding } : {},
  });
}


function createMockStigmer(org: Organization, canEdit = true, refusal?: Error) {
  return {
    organization: {
      get: vi.fn(async () => org),
      update: vi.fn(async () => org),
      updateEmbedding: vi.fn(async (_input: UpdateOrganizationEmbeddingInput) => {
        if (refusal !== undefined) throw refusal;
        return org;
      }),
    },
    grant: {
      checkMyPermission: vi.fn(async () => ({ isAuthorized: canEdit })),
    },
    vault: {
      list: vi.fn(async () => ({ entries: [], nextPageToken: "" })),
    },
  };
}

function renderPanel(client: unknown, props: { serviceAccountsHref?: string } = {}) {
  return render(
    <StigmerContext.Provider value={client as never}>
      <OrgEmbeddingPanel org={ACME_ID} {...props} />
    </StigmerContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("organizationEmbeddingOf", () => {
  it("reads an organization with no stored settings as creating nothing and allowing every origin", () => {
    for (const organization of [orgWith(), null]) {
      expect(organizationEmbeddingOf(organization)).toEqual({
        allowedOrigins: [],
        createAccountsOnSignIn: false,
        signInRole: IamRole.iam_role_unspecified,
        vaults: [],
      });
    }
  });

  it("reads stored settings as they are, each vault by the reference it holds", () => {
    expect(organizationEmbeddingOf(orgWith(STORED))).toEqual({
      allowedOrigins: ["https://app.acme.example"],
      createAccountsOnSignIn: true,
      signInRole: IamRole.member,
      vaults: [{ org: "acme", slug: "product-keys", id: "vlt_keys" }],
    });
  });

  it("names each offered role, and reads unspecified as None", () => {
    expect([IamRole.iam_role_unspecified, IamRole.viewer, IamRole.member, IamRole.admin].map(formatSignInRole)).toEqual([
      "None",
      "Viewer",
      "Member",
      "Admin",
    ]);
  });
});

describe("OrgEmbeddingPanel", () => {
  it("starts from the stored settings and never offers owner", async () => {
    renderPanel(createMockStigmer(orgWith(STORED)));
    const role = (await screen.findByLabelText("Sign-in role")) as HTMLSelectElement;
    expect(role.value).toBe(String(IamRole.member));
    expect([...role.options].map((option) => option.textContent)).toEqual(["None", "Viewer", "Member", "Admin"]);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("https://app.acme.example")).toBeTruthy();
  });

  it("saves every setting through updateEmbedding, an added origin included and each vault by its id", async () => {
    const client = createMockStigmer(orgWith(STORED));
    renderPanel(client);
    const input = await screen.findByLabelText("Add an allowed origin");
    fireEvent.change(input, { target: { value: "https://portal.acme.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Sign-in role"), { target: { value: String(IamRole.viewer) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.organization.updateEmbedding).toHaveBeenCalledTimes(1));
    const sent = client.organization.updateEmbedding.mock.calls[0]![0];
    expect(sent.orgId).toBe(ACME_ID);
    expect(sent.embedding?.allowedOrigins).toEqual(["https://app.acme.example", "https://portal.acme.example"]);
    expect(sent.embedding?.createAccountsOnSignIn).toBe(true);
    expect(sent.embedding?.signInRole).toBe(IamRole.viewer);
    expect(sent.embedding?.vaults.map((ref) => [ref.id, ref.slug])).toEqual([["vlt_keys", ""]]);
    expect(client.organization.update).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toContain("Saved");
  });

  it("still says Saved once the organization is read back with the new settings", async () => {
    let stored = orgWith(STORED);
    const client = createMockStigmer(stored);
    client.organization.get.mockImplementation(async () => stored);
    client.organization.updateEmbedding.mockImplementation(async (input: UpdateOrganizationEmbeddingInput) => {
      stored = orgWith({ ...STORED, signInRole: input.embedding?.signInRole ?? IamRole.iam_role_unspecified });
      return stored;
    });
    renderPanel(client);
    fireEvent.change(await screen.findByLabelText("Sign-in role"), { target: { value: String(IamRole.viewer) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.organization.get).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole("status")).textContent).toContain("Saved");
    expect((screen.getByLabelText("Sign-in role") as HTMLSelectElement).value).toBe(String(IamRole.viewer));
  });

  it("clears the sign-in role when account creation is turned off, and sends none", async () => {
    const client = createMockStigmer(orgWith(STORED));
    renderPanel(client);
    fireEvent.click(await screen.findByRole("switch"));
    expect((screen.getByLabelText("Sign-in role") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.organization.updateEmbedding).toHaveBeenCalledTimes(1));
    const sent = client.organization.updateEmbedding.mock.calls[0]![0];
    expect(sent.embedding?.createAccountsOnSignIn).toBe(false);
    expect(sent.embedding?.signInRole).toBe(IamRole.iam_role_unspecified);
  });

  it("adds an origin on Enter as on Add", async () => {
    const client = createMockStigmer(orgWith(STORED));
    renderPanel(client);
    const input = await screen.findByLabelText("Add an allowed origin");
    fireEvent.change(input, { target: { value: "https://portal.acme.example" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("https://portal.acme.example")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("removes a vault from what it sends", async () => {
    const client = createMockStigmer(orgWith(STORED));
    renderPanel(client);
    fireEvent.click(await screen.findByRole("button", { name: "Remove product-keys" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(client.organization.updateEmbedding).toHaveBeenCalledTimes(1));
    expect(client.organization.updateEmbedding.mock.calls[0]![0].embedding?.vaults).toEqual([]);
  });

  it("removes an origin from what it sends", async () => {
    const client = createMockStigmer(orgWith(STORED));
    renderPanel(client);
    fireEvent.click(await screen.findByRole("button", { name: "Remove https://app.acme.example" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(client.organization.updateEmbedding).toHaveBeenCalledTimes(1));
    expect(client.organization.updateEmbedding.mock.calls[0]![0].embedding?.allowedOrigins).toEqual([]);
  });

  it("is read-only without can_edit: the settings show, nothing changes them", async () => {
    renderPanel(createMockStigmer(orgWith(STORED), false));
    expect(await screen.findByText("Only organization admins can change these settings.")).toBeTruthy();
    expect(screen.getByText("https://app.acme.example")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove https://app.acme.example" })).toBeNull();
    expect((screen.getByRole("switch") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Sign-in role") as HTMLInputElement).disabled).toBe(true);
  });

  it("offers the service-account link only to someone who can change the settings", async () => {
    renderPanel(createMockStigmer(orgWith(STORED), false), { serviceAccountsHref: "#/settings/service-accounts" });
    await screen.findByText("Only organization admins can change these settings.");
    expect(screen.queryByRole("link", { name: "Manage service accounts" })).toBeNull();
  });

  it("links to service accounts only when given where they are managed", async () => {
    renderPanel(createMockStigmer(orgWith(STORED)), { serviceAccountsHref: "#/settings/service-accounts" });
    expect((await screen.findByRole("link", { name: "Manage service accounts" })).getAttribute("href")).toBe("#/settings/service-accounts");
    cleanup();
    renderPanel(createMockStigmer(orgWith(STORED)));
    await screen.findByLabelText("Sign-in role");
    expect(screen.queryByRole("link", { name: "Manage service accounts" })).toBeNull();
  });
});

describe("OrgEmbeddingPanel — failures and absence", () => {
  it("shows a refused save in the server's words", async () => {
    const client = createMockStigmer(
      orgWith(STORED),
      true,
      new ConnectError("a My vault cannot be attached", Code.FailedPrecondition),
    );
    renderPanel(client);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("a My vault cannot be attached");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers a retry when the organization cannot be read, and reads it again", async () => {
    const client = createMockStigmer(orgWith(STORED));
    client.organization.get
      .mockRejectedValueOnce(new ConnectError("store down", Code.Unavailable))
      .mockResolvedValueOnce(orgWith(STORED));
    renderPanel(client);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Sign-in role")).toBeTruthy();
    expect(client.organization.get).toHaveBeenCalledTimes(2);
  });

  it("renders nothing and asks nothing without an organization", () => {
    const client = createMockStigmer(orgWith(STORED));
    const { container } = render(
      <StigmerContext.Provider value={client as never}>
        <OrgEmbeddingPanel org="" />
      </StigmerContext.Provider>,
    );
    expect(container.innerHTML).toBe("");
    expect(client.organization.get).not.toHaveBeenCalled();
  });
});

describe("useUpdateOrganizationEmbedding", () => {
  const wrapper = (client: unknown) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>;
    };

  it("keeps a refused save's error until it is cleared, and rethrows it to the caller", async () => {
    const refusal = new ConnectError("refused", Code.PermissionDenied);
    const client = createMockStigmer(orgWith(), true, refusal);
    const { result } = renderHook(() => useUpdateOrganizationEmbedding(), { wrapper: wrapper(client) });
    await act(async () => {
      await expect(
        result.current.updateEmbedding(ACME_ID, organizationEmbeddingOf(orgWith())),
      ).rejects.toBe(refusal);
    });
    expect(result.current.error?.message).toContain("refused");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
