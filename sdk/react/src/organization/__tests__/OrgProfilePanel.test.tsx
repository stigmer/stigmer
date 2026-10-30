/**
 * OrgProfilePanel: the profile save keeps every spec field it does not
 * edit, and the profile is editable only by a caller the server allows
 * `can_edit`: anyone it refuses reads muted fields, a line naming the
 * admins, and no Save, and nobody sees either state until the check
 * settles. The federation-issuer summary's empty state follows the caller's
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
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { CheckMyPermissionInput } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import {
  FederationIssuerSchema,
  type FederationIssuer,
} from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { StigmerContext } from "@stigmer/react-core";
import { DeploymentModeContext } from "@stigmer/react-core";
import { OrgProfilePanel } from "../OrgProfilePanel";
import { OrgProvider, useOrg } from "../OrgProvider";
import { OrgProfileSection } from "../../settings/OrgProfileSection";

/**
 * A profile save names the fields the form edits (name, description,
 * logo), on the organization's id, so every other spec field — most
 * visibly `spec.preferences.standing_context` set via the CLI or the
 * preferences page — keeps its stored value without being sent back.
 *
 * Also pins the federation-issuer summary's empty state on the editions
 * that serve federation issuers: the list holds only the providers the
 * caller may view, so a caller the server refuses `can_create_federation_issuer` is told
 * the organization's admins manage them, and is not invited to set one up.
 * A listed provider that creates accounts on sign-in carries a JIT badge.
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

/**
 * How the server answers `can_edit`: allowed, refused, never (the check
 * stays in flight), or by failing. Every other relation is refused.
 */
type EditAnswer = "allowed" | "refused" | "pending" | "failed";

function answerCanEdit(canEdit: EditAnswer) {
  return vi.fn((input: CheckMyPermissionInput) => {
    if (input.relation !== "can_edit") return Promise.resolve({ isAuthorized: false });
    switch (canEdit) {
      case "allowed":
        return Promise.resolve({ isAuthorized: true });
      case "refused":
        return Promise.resolve({ isAuthorized: false });
      case "pending":
        return new Promise<{ isAuthorized: boolean }>(() => undefined);
      case "failed":
        return Promise.reject(new Error("permission service unavailable"));
      default: {
        const unreachable: never = canEdit;
        throw new Error(`unknown answer ${String(unreachable)}`);
      }
    }
  });
}

function createMockStigmer(overrides?: {
  update?: ReturnType<typeof vi.fn>;
  checkMyPermission?: ReturnType<typeof answerCanEdit>;
}) {
  return {
    organization: {
      get: vi.fn(async () => ORG),
      update: overrides?.update ?? vi.fn(async () => ORG),
    },
    platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
    grant: { checkMyPermission: overrides?.checkMyPermission ?? answerCanEdit("allowed") },
  } as never;
}

// Deployment mode "local" keeps the FederationIssuersSummary sub-panel
// inert (federation_issuer is cloud-only), so no extra client stubs are
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
  it("names the profile fields alone — preferences are not named by a profile save", async () => {
    const update = vi.fn(async (_resource: Organization, _paths: string[]) => ORG);
    const client = createMockStigmer({ update });
    renderPanel(client);

    // Wait for the server-sync effect to fill the form before editing —
    // interacting on first appearance races the sync.
    const description = await screen.findByLabelText("Description");
    await waitFor(() =>
      expect(description).toHaveProperty("value", "We make everything."),
    );
    fireEvent.change(description, { target: { value: "New description" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Organization>(update);

    // The edited field.
    expect(sent.resource.spec?.description).toBe("New description");
    // The form's fields alone: the preferences it does not render keep
    // their stored values without being sent back.
    expect(sent.paths).toEqual(["metadata.name", "spec.description", "spec.logo_url"]);
    expect(sent.resource.spec?.logoUrl).toBe("https://acme.example/logo.png");
    // The update addresses the organization by its id.
    expect(sent.id).toBe(ACME_ID);
  });

  it("sends the edited name and keeps discard/dirty semantics intact", async () => {
    const update = vi.fn(async (_resource: Organization, _paths: string[]) => ORG);
    renderPanel(createMockStigmer({ update }));

    const name = await screen.findByLabelText("Name");
    await waitFor(() => expect(name).toHaveProperty("value", "Acme Corp"));
    fireEvent.change(name, { target: { value: "Acme Corporation" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Organization>(update);
    expect(sent.resource.metadata?.name).toBe("Acme Corporation");
    expect(sent.paths).not.toContain("spec.preferences");
  });
});

describe("OrgProfilePanel edit gate", () => {
  const ADMINS_LINE = "Only organization admins can edit this profile.";
  const fields = () =>
    ["Name", "Description", "Logo URL"].map(
      (label) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement,
    );

  /** Renders the panel and waits until the form holds the server's values. */
  async function renderFilled(canEdit: EditAnswer, update = vi.fn(async () => ORG)) {
    const checkMyPermission = answerCanEdit(canEdit);
    renderPanel(createMockStigmer({ update, checkMyPermission }));
    const name = await screen.findByLabelText("Name");
    await waitFor(() => expect(name).toHaveProperty("value", "Acme Corp"));
    return { update, checkMyPermission };
  }

  it("shows a caller refused can_edit muted read-only fields, the admins line, and no Save or Discard", async () => {
    const { checkMyPermission } = await renderFilled("refused");

    expect(await screen.findByText(ADMINS_LINE)).toBeTruthy();
    for (const field of fields()) {
      expect(field.readOnly).toBe(true);
      expect(field.className).toContain("stg:bg-muted-subtle");
      expect(field.getAttribute("placeholder")).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    expect(screen.queryByText(/characters$/)).toBeNull();
    // The profile still reads in full, logo included.
    expect(screen.getByLabelText("Description")).toHaveProperty("value", "We make everything.");
    expect(screen.getByAltText("Organization logo preview")).toBeTruthy();
    expect(
      checkMyPermission.mock.calls.map(([i]) => [
        i.resource?.kind,
        i.resource?.id,
        i.relation,
      ]),
    ).toContainEqual(["organization", ACME_ID, "can_edit"]);
  });

  it("submits nothing for a caller refused can_edit, even when the form is submitted", async () => {
    const { update } = await renderFilled("refused");
    await screen.findByText(ADMINS_LINE);

    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Acme Corporation" } });
    fireEvent.submit(name.closest("form")!);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled();
  });

  it("shows neither Save nor the admins line while the check is in flight, and keeps the fields read-only and unmuted", async () => {
    await renderFilled("pending");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByText(ADMINS_LINE)).toBeNull();
    for (const field of fields()) {
      expect(field.readOnly).toBe(true);
      expect(field.className).not.toContain("stg:bg-muted-subtle");
      // No edit cue before the yes: an example value reads as a value.
      expect(field.getAttribute("placeholder")).toBeNull();
    }
    expect(screen.queryByText(/characters$/)).toBeNull();
  });

  it("leaves the form editable when the check fails, since the server re-checks the save", async () => {
    const update = vi.fn(async () => ORG);
    await renderFilled("failed", update);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme Corporation" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(ADMINS_LINE)).toBeNull();
  });

  it("gives a caller allowed can_edit the editable form, with no admins line", async () => {
    await renderFilled("allowed");

    expect(await screen.findByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.queryByText(ADMINS_LINE)).toBeNull();
    for (const field of fields()) {
      expect(field.readOnly).toBe(false);
      expect(field.className).not.toContain("stg:bg-muted-subtle");
    }
    expect(screen.getByText(/\/500 characters$/)).toBeTruthy();
    expect(screen.getByLabelText("Logo URL").getAttribute("placeholder")).toBe(
      "https://example.com/logo.png",
    );
  });
});

describe("OrgProfilePanel federation-issuer summary", () => {
  function renderCloudPanel(
    isAuthorized: boolean,
    providers: FederationIssuer[] = [],
  ) {
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized,
    }));
    const client = {
      organization: { get: vi.fn(async () => ORG), update: vi.fn(async () => ORG) },
      federationIssuer: { list: vi.fn(async () => ({ entries: providers, nextPageToken: "" })) },
      grant: { checkMyPermission },
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

  it("names the organization's admins to a caller refused can_create_federation_issuer", async () => {
    const checkMyPermission = renderCloudPanel(false);
    expect(
      await screen.findByText("Federation issuers are managed by your organization's admins."),
    ).toBeTruthy();
    expect(screen.queryByText("Set up federated authentication")).toBeNull();
    const asked = checkMyPermission.mock.calls.map(([input]) => [
      input.resource?.kind,
      input.resource?.id,
      input.relation,
    ]);
    expect(asked).toContainEqual(["organization", ACME_ID, "can_create_federation_issuer"]);
  });

  it("badges a provider that creates accounts JIT", async () => {
    const issuer = (id: string, displayName: string, spec: object) =>
      create(FederationIssuerSchema, {
        metadata: { id, name: displayName, org: ACME_ID },
        spec: { displayName, ...spec },
      });
    renderCloudPanel(true, [
      issuer("issuer-2", "Platform", { createAccountsOnSignIn: true }),
      issuer("issuer-3", "Manual", {}),
    ]);

    const row = async (name: string) =>
      (await screen.findByText(name)).parentElement?.textContent;
    expect(await row("Platform")).toBe("PlatformJIT");
    expect(await row("Manual")).toBe("Manual");
  });

  it("invites setting one up when the caller may create federation issuers", async () => {
    renderCloudPanel(true);
    expect(await screen.findByText("Set up federated authentication")).toBeTruthy();
    expect(
      screen.queryByText("Federation issuers are managed by your organization's admins."),
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
      isAuthorized:
        input.relation === "can_delete" ? owner : input.relation === "can_edit",
    }));
    const client = {
      organization: {
        get: vi.fn(async () => ORG),
        update: vi.fn(async () => ORG),
        rename,
      },
      grant: { checkMyPermission },
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
      const listMine = vi
        .fn()
        .mockResolvedValueOnce({ entries: [ORG, GLOBEX], nextPageToken: "" })
        .mockResolvedValue({ entries: panelOrg === ACME_ID ? [RENAMED, GLOBEX] : [ORG, GLOBEX_RENAMED], nextPageToken: "" });
      const client = {
        organization: {
          get: vi.fn(async () => (panelOrg === ACME_ID ? ORG : GLOBEX)),
          update: vi.fn(async () => ORG),
          rename: vi.fn(async () => (panelOrg === ACME_ID ? RENAMED : GLOBEX_RENAMED)),
          listMine,
          // The section's child-organization list: an organization with none.
          listChildOrgs: vi.fn(async () => ({ entries: [], nextPageToken: "" })),
        },
        grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
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
      return { listMine };
    }

    async function renameTo(slug: string, from: string) {
      const field = await screen.findByLabelText("Slug");
      await waitFor(() => expect(field).toHaveProperty("value", from));
      fireEvent.change(field, { target: { value: slug } });
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    }

    it("refreshes the provider's organizations, so the switcher's slug follows the rename", async () => {
      const { listMine } = renderInProvider(ACME_ID);
      await waitFor(() => expect(screen.getByTestId("provider").textContent).toBe("acme:acme,globex"));

      await renameTo("acme-labs", "acme");

      await waitFor(() => expect(listMine).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.getByTestId("provider").textContent).toBe("acme-labs:acme-labs,globex"),
      );
    });

    it("keeps the active organization selected when it renames another, and lists that one by its new slug", async () => {
      const { listMine } = renderInProvider(GLOBEX_ID);
      await waitFor(() => expect(screen.getByTestId("provider").textContent).toBe("acme:acme,globex"));
      // Another tab remembers Globex; this one keeps Acme, by naming it.
      localStorage.setItem("stigmer:activeOrg", GLOBEX_ID);

      await renameTo("globex-labs", "globex");

      await waitFor(() => expect(listMine).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.getByTestId("provider").textContent).toBe("acme:acme,globex-labs"),
      );
      expect(localStorage.getItem("stigmer:activeOrg")).toBe(ACME_ID);
    });

    it("refreshes the provider once when the settings section hosts the panel", async () => {
      const { listMine } = renderInProvider(ACME_ID, "section");
      await waitFor(() => expect(screen.getByTestId("provider").textContent).toBe("acme:acme,globex"));

      await renameTo("acme-labs", "acme");

      await waitFor(() =>
        expect(screen.getByTestId("provider").textContent).toBe("acme-labs:acme-labs,globex"),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(listMine).toHaveBeenCalledTimes(2);
    });

    it("refreshes the provider once after a profile save", async () => {
      const { listMine } = renderInProvider(ACME_ID, "section");
      const name = await screen.findByLabelText("Name");
      await waitFor(() => expect(name).toHaveProperty("value", "Acme Corp"));

      fireEvent.change(name, { target: { value: "Acme Corporation" } });
      fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(listMine).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(listMine).toHaveBeenCalledTimes(2);
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
      grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
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
