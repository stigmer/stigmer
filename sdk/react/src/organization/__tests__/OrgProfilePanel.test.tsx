/**
 * OrgProfilePanel: the profile save keeps every spec field it does not
 * edit, the identity-provider summary's empty state follows the caller's
 * rights, and the slug is renamable by owners only, and never on a server
 * that holds one organization. A rename lands once: the Rename action stays
 * disabled until the panel shows the renamed slug. A save or a rename inside
 * an OrgProvider refreshes its organizations once, keeps the active one
 * selected, and lists the renamed one by its new slug.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { CheckMyPermissionInput } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { OrganizationInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { OrgProfilePanel } from "../OrgProfilePanel";
import { OrgProvider, useOrg } from "../OrgProvider";
import { OrgProfileSection } from "../../settings/OrgProfileSection";

/**
 * Regression suite for the full-spec-replace wipe bug:
 * `organization.update()` wholesale replaces the stored spec, so a profile
 * save that sends only the edited fields silently wipes every other mutable
 * spec field — most visibly `spec.preferences.standing_context` set via the
 * CLI or the preferences page. The panel must spread the complete mapped
 * input and override only what it edits.
 *
 * Also pins the identity-provider summary's empty state on the editions
 * that serve identity providers: the list holds only the providers the
 * caller may view, so a caller the server refuses `can_create_idp` is told
 * the organization's admins manage them, and is not invited to set one up.
 */

// The id differs from the slug, as for every organization made today; an
// organization belongs to no organization, so its metadata.org is unset.
const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const ORG: Organization = create(OrganizationSchema, {
  metadata: {
    id: ACME_ID,
    name: "Acme Corp",
    slug: "acme",
  },
  spec: {
    description: "We make everything.",
    logoUrl: "https://acme.example/logo.png",
    preferences: { standingContext: "We deploy to us-east-1." },
  },
});

function createMockStigmer(overrides?: {
  update?: ReturnType<typeof vi.fn>;
}) {
  return {
    organization: {
      get: vi.fn(async () => ORG),
      update: overrides?.update ?? vi.fn(async () => ORG),
    },
    platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
    iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
  } as never;
}

// Deployment mode "local" keeps the IdentityProvidersSummary sub-panel
// inert (identity_provider is cloud-only), so no extra client stubs are
// needed — the suite tests the form, not the summary.
function renderPanel(client: unknown) {
  return render(
    <StigmerContext.Provider value={client as never}>
      <DeploymentModeContext.Provider value="local">
        <OrgProfilePanel org={ACME_ID} />
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);
// The provider restores the organization a case before it remembered.
beforeEach(() => localStorage.clear());

describe("OrgProfilePanel save payload", () => {
  it("round-trips unedited spec fields — preferences survive a profile save", async () => {
    const update = vi.fn(async (_input: OrganizationInput) => ORG);
    const client = createMockStigmer({ update });
    renderPanel(client);

    // Wait for the server-sync effect to fill the form before editing —
    // interacting on first appearance races the sync.
    const description = await screen.findByLabelText("Description");
    await waitFor(() =>
      expect(description).toHaveProperty("value", "We make everything."),
    );
    fireEvent.change(description, { target: { value: "New description" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    // The edited field.
    expect(input.description).toBe("New description");
    // The unedited fields the form does not render — the wipe-bug guard.
    expect(input.preferences).toEqual({
      standingContext: "We deploy to us-east-1.",
    });
    expect(input.logoUrl).toBe("https://acme.example/logo.png");
    // The update addresses the organization by its id.
    expect(input.id).toBe(ACME_ID);
    expect(input.slug).toBe("acme");
    expect(input.name).toBe("Acme Corp");
  });

  it("sends the edited name and keeps discard/dirty semantics intact", async () => {
    const update = vi.fn(async (_input: OrganizationInput) => ORG);
    renderPanel(createMockStigmer({ update }));

    const name = await screen.findByLabelText("Name");
    await waitFor(() => expect(name).toHaveProperty("value", "Acme Corp"));
    fireEvent.change(name, { target: { value: "Acme Corporation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0].name).toBe("Acme Corporation");
    expect(update.mock.calls[0]![0].preferences).toEqual({
      standingContext: "We deploy to us-east-1.",
    });
  });
});

describe("OrgProfilePanel identity-provider summary", () => {
  function renderCloudPanel(isAuthorized: boolean) {
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized,
    }));
    const client = {
      organization: { get: vi.fn(async () => ORG), update: vi.fn(async () => ORG) },
      identityProvider: { listByOrg: vi.fn(async () => ({ entries: [] })) },
      iamPolicy: { checkMyPermission },
      platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
    };
    render(
      <StigmerContext.Provider value={client as never}>
        <DeploymentModeContext.Provider value="cloud">
          <OrgProfilePanel org={ACME_ID} />
        </DeploymentModeContext.Provider>
      </StigmerContext.Provider>,
    );
    return checkMyPermission;
  }

  it("names the organization's admins to a caller refused can_create_idp", async () => {
    const checkMyPermission = renderCloudPanel(false);
    expect(
      await screen.findByText("Identity providers are managed by your organization's admins."),
    ).toBeTruthy();
    expect(screen.queryByText("Set up federated authentication")).toBeNull();
    const asked = checkMyPermission.mock.calls.map(([input]) => [
      input.resource?.kind,
      input.resource?.id,
      input.relation,
    ]);
    expect(asked).toContainEqual(["organization", ACME_ID, "can_create_idp"]);
  });

  it("invites setting one up when the caller may create identity providers", async () => {
    renderCloudPanel(true);
    expect(await screen.findByText("Set up federated authentication")).toBeTruthy();
    expect(
      screen.queryByText("Identity providers are managed by your organization's admins."),
    ).toBeNull();
  });
});

describe("OrgProfilePanel rename", () => {
  const RENAMED: Organization = create(OrganizationSchema, {
    metadata: { id: ACME_ID, name: "Acme Corp", slug: "acme-labs" },
  });

  function renderRenamable({
    owner,
    singleOrg,
    rename = vi.fn(async () => RENAMED),
    onUpdated,
  }: {
    owner: boolean;
    singleOrg: boolean;
    rename?: ReturnType<typeof vi.fn>;
    onUpdated?: (org: Organization) => void;
  }) {
    const checkMyPermission = vi.fn(async (input: CheckMyPermissionInput) => ({
      isAuthorized: input.relation === "can_delete" ? owner : false,
    }));
    const client = {
      organization: {
        get: vi.fn(async () => ORG),
        update: vi.fn(async () => ORG),
        rename,
      },
      iamPolicy: { checkMyPermission },
      platform: { getServerInfo: vi.fn(async () => ({ singleOrg })) },
    };
    render(
      <StigmerContext.Provider value={client as never}>
        <DeploymentModeContext.Provider value="local">
          <OrgProfilePanel org={ACME_ID} onUpdated={onUpdated} />
        </DeploymentModeContext.Provider>
      </StigmerContext.Provider>,
    );
    return { checkMyPermission, rename };
  }

  it("lets an owner rename the slug, by the organization's id", async () => {
    const onUpdated = vi.fn();
    const { rename, checkMyPermission } = renderRenamable({
      owner: true,
      singleOrg: false,
      onUpdated,
    });

    const slug = await screen.findByLabelText("Slug");
    await waitFor(() => expect(slug).toHaveProperty("value", "acme"));
    const button = screen.getByRole("button", { name: "Rename" });
    expect(button).toHaveProperty("disabled", true);

    fireEvent.change(slug, { target: { value: "acme-labs" } });
    fireEvent.click(button);

    await waitFor(() => expect(rename).toHaveBeenCalledTimes(1));
    const input = rename.mock.calls[0]![0];
    expect(input.resourceId).toBe(ACME_ID);
    expect(input.slug).toBe("acme-labs");
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(RENAMED));
    expect(
      checkMyPermission.mock.calls.map(([i]) => [i.resource?.id, i.relation]),
    ).toContainEqual([ACME_ID, "can_delete"]);
  });

  it("shows a non-owner the slug read-only", async () => {
    renderRenamable({ owner: false, singleOrg: false });

    expect(await screen.findByText("acme")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByLabelText("Slug")).toBeNull();
  });

  it("offers no rename on a server that holds one organization", async () => {
    renderRenamable({ owner: true, singleOrg: true });

    expect(await screen.findByText("acme")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("shows the server's refusal and keeps the field", async () => {
    const rename = vi.fn(async () => {
      throw new Error("slug acme-labs is taken");
    });
    renderRenamable({ owner: true, singleOrg: false, rename });

    const slug = await screen.findByLabelText("Slug");
    await waitFor(() => expect(slug).toHaveProperty("value", "acme"));
    fireEvent.change(slug, { target: { value: "acme-labs" } });
    fireEvent.keyDown(slug, { key: "Enter" });

    expect((await screen.findByRole("alert")).textContent).toBeTruthy();
    expect(screen.getByLabelText("Slug")).toHaveProperty("value", "acme-labs");
  });

  describe("inside an OrgProvider, with no onUpdated", () => {
    const GLOBEX_ID = "org_01jbbbbbbbbbbbbbbbbbbbbbbb";
    const GLOBEX: Organization = create(OrganizationSchema, {
      metadata: { id: GLOBEX_ID, name: "Globex", slug: "globex" },
    });

    /** Names the provider's active organization and every slug it lists. */
    function ProviderProbe() {
      const { activeOrg, orgs } = useOrg();
      return (
        <p data-testid="provider">
          {`${activeOrg?.metadata?.slug ?? ""}:${orgs.map((o) => o.metadata?.slug).join(",")}`}
        </p>
      );
    }

    const GLOBEX_RENAMED: Organization = create(OrganizationSchema, {
      metadata: { id: GLOBEX_ID, name: "Globex", slug: "globex-labs" },
    });

    function renderInProvider(panelOrg: string, panel?: "section") {
      // The person's organizations before the rename, then after it: the
      // renamed one by its new slug.
      const findMyOrganizations = vi
        .fn()
        .mockResolvedValueOnce({ entries: [ORG, GLOBEX] })
        .mockResolvedValue({ entries: panelOrg === ACME_ID ? [RENAMED, GLOBEX] : [ORG, GLOBEX_RENAMED] });
      const client = {
        organization: {
          get: vi.fn(async () => (panelOrg === ACME_ID ? ORG : GLOBEX)),
          update: vi.fn(async () => ORG),
          rename: vi.fn(async () => (panelOrg === ACME_ID ? RENAMED : GLOBEX_RENAMED)),
          findMyOrganizations,
        },
        iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
      };
      render(
        <StigmerContext.Provider value={client as never}>
          <DeploymentModeContext.Provider value="local">
            <OrgProvider>
              <ProviderProbe />
              {panel === "section" ? <OrgProfileSection /> : <OrgProfilePanel org={panelOrg} />}
            </OrgProvider>
          </DeploymentModeContext.Provider>
        </StigmerContext.Provider>,
      );
      return { findMyOrganizations };
    }

    async function renameTo(slug: string, from: string) {
      const field = await screen.findByLabelText("Slug");
      await waitFor(() => expect(field).toHaveProperty("value", from));
      fireEvent.change(field, { target: { value: slug } });
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    }

    it("refreshes the provider's organizations, so the switcher's slug follows the rename", async () => {
      const { findMyOrganizations } = renderInProvider(ACME_ID);
      await waitFor(() => expect(screen.getByTestId("provider").textContent).toBe("acme:acme,globex"));

      await renameTo("acme-labs", "acme");

      await waitFor(() => expect(findMyOrganizations).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.getByTestId("provider").textContent).toBe("acme-labs:acme-labs,globex"),
      );
    });

    it("keeps the active organization selected when it renames another, and lists that one by its new slug", async () => {
      const { findMyOrganizations } = renderInProvider(GLOBEX_ID);
      await waitFor(() => expect(screen.getByTestId("provider").textContent).toBe("acme:acme,globex"));
      // Another tab remembers Globex; this one keeps Acme, by naming it.
      localStorage.setItem("stigmer:activeOrg", GLOBEX_ID);

      await renameTo("globex-labs", "globex");

      await waitFor(() => expect(findMyOrganizations).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.getByTestId("provider").textContent).toBe("acme:acme,globex-labs"),
      );
      expect(localStorage.getItem("stigmer:activeOrg")).toBe(ACME_ID);
    });

    it("refreshes the provider once when the settings section hosts the panel", async () => {
      const { findMyOrganizations } = renderInProvider(ACME_ID, "section");
      await waitFor(() => expect(screen.getByTestId("provider").textContent).toBe("acme:acme,globex"));

      await renameTo("acme-labs", "acme");

      await waitFor(() =>
        expect(screen.getByTestId("provider").textContent).toBe("acme-labs:acme-labs,globex"),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(findMyOrganizations).toHaveBeenCalledTimes(2);
    });

    it("refreshes the provider once after a profile save", async () => {
      const { findMyOrganizations } = renderInProvider(ACME_ID, "section");
      const name = await screen.findByLabelText("Name");
      await waitFor(() => expect(name).toHaveProperty("value", "Acme Corp"));

      fireEvent.change(name, { target: { value: "Acme Corporation" } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(findMyOrganizations).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(findMyOrganizations).toHaveBeenCalledTimes(2);
    });
  });

  it("sends one rename while the first settles, until the panel shows the new slug", async () => {
    // The panel's refetch after the rename answers only when the test says.
    let answerRefetch: (org: Organization) => void = () => undefined;
    const get = vi
      .fn()
      .mockResolvedValueOnce(ORG)
      .mockImplementation(
        () =>
          new Promise<Organization>((resolve) => {
            answerRefetch = resolve;
          }),
      );
    const rename = vi.fn(async () => RENAMED);
    const client = {
      organization: { get, update: vi.fn(async () => ORG), rename },
      iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
      platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
    };
    render(
      <StigmerContext.Provider value={client as never}>
        <DeploymentModeContext.Provider value="local">
          <OrgProfilePanel org={ACME_ID} />
        </DeploymentModeContext.Provider>
      </StigmerContext.Provider>,
    );

    const slug = await screen.findByLabelText("Slug");
    await waitFor(() => expect(slug).toHaveProperty("value", "acme"));
    fireEvent.change(slug, { target: { value: "acme-labs" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    // The rename landed; the panel still shows the old slug.
    const button = screen.getByRole("button", { name: "Rename" });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText("Slug"), { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rename).toHaveBeenCalledTimes(1);

    answerRefetch(RENAMED);
    await waitFor(() => expect(screen.getByLabelText("Slug")).toHaveProperty("disabled", false));
    expect(screen.getByLabelText("Slug")).toHaveProperty("value", "acme-labs");
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "acme-works" } });
    expect(screen.getByRole("button", { name: "Rename" })).toHaveProperty("disabled", false);
  });

  it("renames nothing on Enter while the slug is unchanged or blank", async () => {
    const { rename } = renderRenamable({ owner: true, singleOrg: false });

    const slug = await screen.findByLabelText("Slug");
    await waitFor(() => expect(slug).toHaveProperty("value", "acme"));
    fireEvent.keyDown(slug, { key: "Enter" });
    fireEvent.change(slug, { target: { value: "   " } });
    fireEvent.keyDown(slug, { key: "Enter" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rename).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
