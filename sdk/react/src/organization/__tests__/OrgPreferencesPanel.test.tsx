import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentListSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/io_pb";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { StigmerContext } from "@stigmer/react-core";
import { DeploymentModeContext } from "@stigmer/react-core";
import type { UseServerInfoReturn } from "../../server-info";
import { OrgPreferencesPanel } from "../OrgPreferencesPanel";

// The memory row's copy follows the server's posture. The mock client below
// has no `platform`, so the hook is stubbed file-wide; every case not about
// posture runs against a server that authenticates its callers.
function answering(authenticationRequired: boolean): UseServerInfoReturn {
  return {
    serverInfo: {
      deploymentMode: "local",
      edition: 1,
      version: "dev",
      authenticationRequired,
      singleOrg: undefined,
      environments: undefined,
    },
    isLoading: false,
    error: null,
  };
}

const SIGN_IN_SERVER = answering(true);

let serverInfo: UseServerInfoReturn = SIGN_IN_SERVER;

vi.mock("../../server-info.js", () => ({
  useServerInfo: () => serverInfo,
  useEnvironmentAvailability: () => serverInfo.serverInfo?.environments,
}));

// The id differs from the slug, as for every organization made today; an
// organization belongs to no organization, so its metadata.org is unset.
const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const ORG: Organization = create(OrganizationSchema, {
  metadata: { id: ACME_ID, name: "Acme Corp", slug: "acme" },
  spec: {
    description: "We make everything.",
    logoUrl: "https://acme.example/logo.png",
    preferences: { standingContext: "We deploy to us-east-1." },
  },
});

const ENVIRONMENTS = create(EnvironmentListSchema, {
  entries: [
    create(EnvironmentSchema, { metadata: { id: "env_bt", org: ACME_ID, slug: "base-tools", name: "Base tools" } }),
  ],
  nextPageToken: "",
});

function createMockStigmer(overrides?: {
  update?: ReturnType<typeof vi.fn>;
  canEdit?: boolean;
  organization?: Organization;
}) {
  return {
    organization: {
      get: vi.fn(async () => overrides?.organization ?? ORG),
      update: overrides?.update ?? vi.fn(async () => ORG),
    },
    environment: { list: vi.fn(async () => ENVIRONMENTS) },
    grant: {
      checkMyPermission: vi.fn(async () => ({
        isAuthorized: overrides?.canEdit ?? true,
      })),
    },
  } as never;
}

function renderPanel(client: unknown) {
  return render(
    <StigmerContext.Provider value={client as never}>
      <DeploymentModeContext.Provider value="local">
        <OrgPreferencesPanel org={ACME_ID} />
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  serverInfo = SIGN_IN_SERVER;
});

/**
 * Waits until the form has synced from server data (the panel copies the
 * fetched value into local state in a passive effect, one flush after the
 * field first renders) — interacting earlier races the sync.
 */
async function findSyncedField(value: string) {
  const field = await screen.findByLabelText("Standing context");
  await waitFor(() => expect(field).toHaveProperty("value", value));
  return field;
}

describe("OrgPreferencesPanel", () => {
  it("loads and displays the declared standing context", async () => {
    renderPanel(createMockStigmer());

    await findSyncedField("We deploy to us-east-1.");
  });

  it("names the standing context alone, on the organization's id — profile fields are not named", async () => {
    const update = vi.fn(async (_resource: Organization, _paths: string[]) => ORG);
    renderPanel(createMockStigmer({ update }));

    const field = await findSyncedField("We deploy to us-east-1.");
    fireEvent.change(field, { target: { value: "Prefer terse answers." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Organization>(update);

    expect(sent.resource.spec?.preferences?.standingContext).toBe("Prefer terse answers.");
    // The one path: fields this form never renders keep their stored
    // values without being sent back.
    expect(sent.paths).toEqual(["spec.preferences.standing_context"]);
    expect(sent.id).toBe(ACME_ID);
  });

  it("clears the standing context when the text is emptied", async () => {
    const update = vi.fn(async (_resource: Organization, _paths: string[]) => ORG);
    renderPanel(createMockStigmer({ update }));

    const field = await findSyncedField("We deploy to us-east-1.");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Organization>(update);
    expect(sent.paths).toEqual(["spec.preferences.standing_context"]);
    expect(sent.resource.spec?.preferences?.standingContext).toBe("");
  });

  it("discard resets the field to the server value", async () => {
    renderPanel(createMockStigmer());

    const field = await findSyncedField("We deploy to us-east-1.");
    fireEvent.change(field, { target: { value: "Edited but regretted" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(field).toHaveProperty("value", "We deploy to us-east-1.");
  });

  it("renders read-only with an explanation when the caller lacks can_edit", async () => {
    renderPanel(createMockStigmer({ canEdit: false }));

    const field = await screen.findByLabelText("Standing context");
    await waitFor(() =>
      expect(field).toHaveProperty("readOnly", true),
    );
    expect(
      screen.getByText("Only organization admins can edit these preferences."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("memory toggle applies instantly, naming the flag alone", async () => {
    const update = vi.fn(async (_resource: Organization, _paths: string[]) => ORG);
    renderPanel(createMockStigmer({ update }));
    await findSyncedField("We deploy to us-east-1.");

    // No Save click: consent applies the moment it is flipped (the
    // UX-checkpoint decision — a flipped-but-unsaved consent bit that
    // silently reverts on navigation is the failure this prevents).
    fireEvent.click(screen.getByRole("switch", { name: "Memory" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Organization>(update);
    expect(sent.resource.spec?.preferences?.memoryEnabled).toBe(true);
    // The flag alone: the sibling preference and every profile field keep
    // their stored values without being sent back.
    expect(sent.paths).toEqual(["spec.preferences.memory_enabled"]);
  });

  it("saving standing context does not name memory_enabled, so it stays (the wipe-hazard regression)", async () => {
    const orgWithMemoryOn = create(OrganizationSchema, {
      metadata: { id: ACME_ID, name: "Acme Corp", slug: "acme" },
      spec: {
        description: "We make everything.",
        logoUrl: "https://acme.example/logo.png",
        preferences: {
          standingContext: "We deploy to us-east-1.",
          memoryEnabled: true,
        },
      },
    });
    const update = vi.fn(async (_resource: Organization, _paths: string[]) => orgWithMemoryOn);
    const client = {
      organization: {
        get: vi.fn(async () => orgWithMemoryOn),
        update,
      },
      grant: {
        checkMyPermission: vi.fn(async () => ({ isAuthorized: true })),
      },
    } as never;
    renderPanel(client);

    const field = await findSyncedField("We deploy to us-east-1.");
    fireEvent.change(field, { target: { value: "Prefer terse answers." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // The form names its one preference: the memory switch is not among
    // the paths, so the save can never turn the org's memory off.
    expect(sentUpdate<Organization>(update).paths).toEqual(["spec.preferences.standing_context"]);
  });

  it("memory toggle is read-only without can_edit", async () => {
    renderPanel(createMockStigmer({ canEdit: false }));
    await screen.findByLabelText("Standing context");

    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Memory" }).hasAttribute("disabled"),
      ).toBe(true),
    );
  });

  describe("memory copy by server posture (stigmer/stigmer#1404)", () => {
    const MEMBERS_ALSO_CONSENT = /Each member must also turn memory on/;
    const SWITCH_ALONE_DECIDES = /this switch alone decides memory/;

    it("tells admins each member must also consent on a server that authenticates its callers", async () => {
      renderPanel(createMockStigmer());
      await findSyncedField("We deploy to us-east-1.");

      expect(screen.getByText(MEMBERS_ALSO_CONSENT)).toBeTruthy();
      expect(screen.queryByText(SWITCH_ALONE_DECIDES)).toBeNull();
    });

    it("says this switch alone decides on a server that trusts every request: there is no person's switch there", async () => {
      serverInfo = answering(false);
      renderPanel(createMockStigmer());
      await findSyncedField("We deploy to us-east-1.");

      expect(screen.getByText(SWITCH_ALONE_DECIDES)).toBeTruthy();
      expect(screen.queryByText(MEMBERS_ALSO_CONSENT)).toBeNull();
    });
  });

  describe("the default environment", () => {
    const DEFAULTED = create(OrganizationSchema, {
      metadata: { id: ACME_ID, name: "Acme Corp", slug: "acme", etag: "e1" },
      spec: { preferences: { defaultEnvironmentRef: { org: ACME_ID, slug: "base-tools", id: "env_bt" } } },
    });

    it("saves the picked Environment instantly, naming the default alone", async () => {
      const update = vi.fn(async (_resource: Organization, _paths: string[]) => ORG);
      renderPanel(createMockStigmer({ update }));
      const select = await screen.findByRole("combobox", { name: "Default environment" });
      await screen.findByRole("option", { name: "Base tools" });
      expect(screen.getByRole("option", { name: "None" })).toBeTruthy();

      fireEvent.change(select, { target: { value: "base-tools" } });

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const sent = sentUpdate<Organization>(update);
      expect(sent.paths).toEqual(["spec.preferences.default_environment_ref"]);
      expect(sent.resource.spec?.preferences?.defaultEnvironmentRef).toMatchObject({ org: ACME_ID, slug: "base-tools" });
      expect(sent.id).toBe(ACME_ID);
    });

    it("clears it when None is picked, naming the path with no value", async () => {
      const update = vi.fn(async (_resource: Organization, _paths: string[]) => ORG);
      renderPanel(createMockStigmer({ update, organization: DEFAULTED }));
      const select = await screen.findByRole("combobox", { name: "Default environment" });
      await waitFor(() => expect(select).toHaveProperty("value", "base-tools"));

      fireEvent.change(select, { target: { value: "" } });

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const sent = sentUpdate<Organization>(update);
      expect(sent.paths).toEqual(["spec.preferences.default_environment_ref"]);
      expect(sent.resource.spec?.preferences?.defaultEnvironmentRef).toBeUndefined();
      expect(sent.etag).toBe("e1");
    });

    it("is read-only without can_edit, naming the default", async () => {
      renderPanel(createMockStigmer({ canEdit: false, organization: DEFAULTED }));
      expect(await screen.findByText("Base tools")).toBeTruthy();
      expect(screen.queryByRole("combobox", { name: "Default environment" })).toBeNull();
    });

    it("says where the default applies, and that Environments don't apply on a server that starts no sandbox", async () => {
      renderPanel(createMockStigmer());
      expect(await screen.findByText(/Conversations on a person's own machine ignore it\./)).toBeTruthy();
      cleanup();
      serverInfo = {
        ...SIGN_IN_SERVER,
        serverInfo: { ...SIGN_IN_SERVER.serverInfo!, environments: { applies: false, limitedNetworking: false, packages: false } },
      };
      renderPanel(createMockStigmer());
      expect(
        await screen.findByText("Environments don't apply here: conversations on this server don't run in sandboxes it starts"),
      ).toBeTruthy();
    });
  });

  it("shows the fetch error with a retry action when loading fails", async () => {
    const client = {
      organization: {
        get: vi.fn(async () => {
          throw new Error("boom");
        }),
        update: vi.fn(),
      },
      grant: {
        checkMyPermission: vi.fn(async () => ({ isAuthorized: true })),
      },
    } as never;
    renderPanel(client);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
