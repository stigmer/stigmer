import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clone, create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  PlatformClientSchema,
  PlatformClientStatusSchema,
  type PlatformClient,
} from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { CheckMyPermissionInput } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { sentRefs, sentUpdate } from "../../internal/__tests__/sent-update";
import { StigmerContext } from "../../context";
import { PlatformClientDetailPanel } from "../PlatformClientDetailPanel";

/**
 * The save names the fields the form edits, on the client's id: a spec
 * field it does not list (the credentials) is not named, so it keeps its
 * stored value; the vaults it edits itself start from the stored list, so
 * an edit of something else sends them back as stored.
 *
 * Also pins how the panel presents an expired client (#1254): the view
 * says "Expired", and the rotate confirmation says rotating will not help,
 * because rotation leaves the expiry as it is. A live client shows
 * neither.
 *
 * The sign-in settings: turning account creation off clears the sign-in
 * role with it, because only an account the client creates receives one,
 * and the view reads an unspecified role as "None", which grants nothing.
 *
 * And what the view offers (stigmer/stigmer#1302): Edit and Rotate secret
 * only with `can_edit`, Delete only with `can_delete` on the client, so an
 * organization admin who may view a client they did not create reads it
 * with no actions at all; and when the client last minted a token, or
 * "Never" (stigmer/stigmer#1255). The permission check runs through the
 * real hook over a stubbed `checkMyPermission`.
 */

const PLATFORM_CLIENT: PlatformClient = create(PlatformClientSchema, {
  metadata: {
    id: "pc-1",
    name: "Embed Client",
    slug: "embed-client",
    org: "acme",
  },
  spec: {
    clientId: "client-abc",
    expiresAt: timestampFromDate(new Date("2027-06-01T00:00:00Z")),
    neverExpires: false,
    createAccountsOnSignIn: true,
    signInRole: IamRole.admin,
    allowedOrigins: ["https://embed.acme.example"],
    vaults: [
      { org: "acme", slug: "prod", kind: ApiResourceKind.vault },
    ],
  },
});

const ALLOW_ALL = async (_input: CheckMyPermissionInput) => ({
  isAuthorized: true,
});

function renderPanel(
  update: ReturnType<typeof vi.fn>,
  platformClient: PlatformClient = PLATFORM_CLIENT,
  checkMyPermission: (
    input: CheckMyPermissionInput,
  ) => Promise<{ isAuthorized: boolean }> = ALLOW_ALL,
  now?: Date,
) {
  const client = {
    platformclient: { update },
    iamPolicy: { checkMyPermission },
    vault: { list: async () => ({ entries: [], nextPageToken: "" }) },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <PlatformClientDetailPanel platformClient={platformClient} now={now} />
    </StigmerContext.Provider>,
  );
}

/** PLATFORM_CLIENT with an expiry a day from now (+1) or a day ago (-1). */
function clientExpiringInDays(days: 1 | -1): PlatformClient {
  const platformClient = clone(PlatformClientSchema, PLATFORM_CLIENT);
  platformClient.spec!.expiresAt = timestampFromDate(
    new Date(Date.now() + days * 86_400_000),
  );
  return platformClient;
}

const ROTATE_WILL_NOT_HELP =
  "This client has expired. Rotating does not extend it; edit its expiry instead.";

afterEach(cleanup);

describe("PlatformClientDetailPanel save payload", () => {
  it("sends the stored vaults back on an origins-only edit, naming the form's fields alone", async () => {
    const update = vi.fn(async (_resource: PlatformClient, _paths: string[]) => PLATFORM_CLIENT);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<PlatformClient>(update);
    const spec = sent.resource.spec;

    // An origins-only edit sends the stored vaults back as stored.
    expect(sentRefs(spec?.vaults)).toEqual([{ org: "acme", slug: "prod" }]);
    // Form-owned fields travel from the edit state.
    expect(spec?.allowedOrigins).toEqual(["https://embed.acme.example"]);
    expect(spec?.createAccountsOnSignIn).toBe(true);
    expect(spec?.signInRole).toBe(IamRole.admin);
    expect(spec?.expiresAt).toBeDefined();
    // The form's fields alone: the credentials are not named.
    expect(sent.paths).toEqual([
      "spec.never_expires",
      "spec.expires_at",
      "spec.create_accounts_on_sign_in",
      "spec.sign_in_role",
      "spec.allowed_origins",
      "spec.vaults",
    ]);
    // An update names its client by id.
    expect(sent.id).toBe(PLATFORM_CLIENT.metadata?.id);
  });
});

describe("PlatformClientDetailPanel sign-in settings", () => {
  it("clears the sign-in role when account creation is turned off", async () => {
    const update = vi.fn(async (_resource: PlatformClient, _paths: string[]) => PLATFORM_CLIENT);
    renderPanel(update);

    expect(screen.getByText("Admin")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(
      screen.getByRole("switch", { name: "Create accounts on sign-in" }),
    );
    expect(
      (screen.getByLabelText("Sign-in role") as HTMLSelectElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<PlatformClient>(update);
    expect(sent.paths).toEqual(expect.arrayContaining(["spec.create_accounts_on_sign_in", "spec.sign_in_role"]));
    expect(sent.resource.spec?.createAccountsOnSignIn).toBe(false);
    expect(sent.resource.spec?.signInRole).toBe(IamRole.iam_role_unspecified);
  });

  it("reads an unspecified sign-in role as None", () => {
    const platformClient = clone(PlatformClientSchema, PLATFORM_CLIENT);
    platformClient.spec!.signInRole = IamRole.iam_role_unspecified;
    renderPanel(vi.fn(), platformClient);

    expect(screen.getByText("Sign-in role")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
  });
});

describe("PlatformClientDetailPanel expiry", () => {
  it("an expired client reads Expired, and its rotate confirmation says rotating will not help", async () => {
    renderPanel(vi.fn(), clientExpiringInDays(-1));

    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.queryByText("Expires")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Rotate secret" }));
    expect(screen.getByText(ROTATE_WILL_NOT_HELP)).toBeTruthy();
  });

  it("a live client reads Expires, and its rotate confirmation carries no expiry warning", async () => {
    renderPanel(vi.fn(), clientExpiringInDays(1));

    expect(screen.getByText("Expires")).toBeTruthy();
    expect(screen.queryByText("Expired")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Rotate secret" }));
    expect(screen.queryByText(ROTATE_WILL_NOT_HELP)).toBeNull();
  });
});

describe("PlatformClientDetailPanel actions by permission", () => {
  it("asks can_edit and can_delete on the client", async () => {
    const checkMyPermission = vi.fn(ALLOW_ALL);
    renderPanel(vi.fn(), PLATFORM_CLIENT, checkMyPermission);

    await screen.findByRole("button", { name: "Edit" });
    const asked = checkMyPermission.mock.calls.map(
      ([input]) =>
        `${input.resource?.kind}:${input.resource?.id}:${input.relation}`,
    );
    // can_delete gates both Delete and the slug field (rename).
    expect([...new Set(asked)].sort()).toEqual([
      "platform_client:pc-1:can_delete",
      "platform_client:pc-1:can_edit",
    ]);
  });

  it("offers Edit and Rotate secret only with can_edit, Delete only with can_delete", async () => {
    renderPanel(vi.fn(), PLATFORM_CLIENT, async (input) => ({
      isAuthorized: input.relation === "can_delete",
    }));

    await screen.findByRole("button", { name: "Delete platform client" });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rotate secret" })).toBeNull();
  });

  it("an admin who did not create the client reads it with no actions at all", async () => {
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized: false,
    }));
    const { container } = renderPanel(vi.fn(), PLATFORM_CLIENT, checkMyPermission);

    // can_delete gates both Delete and the slug field (rename).
    await waitFor(() =>
      expect(new Set(checkMyPermission.mock.calls.map(([input]) => input.relation))).toEqual(
        new Set(["can_edit", "can_delete"]),
      ),
    );
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    // The configuration stays readable; only the change affordances are withheld.
    expect(screen.getByText("client-abc")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Rotate secret" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Delete platform client" }),
      ).toBeNull();
    });
    const withoutActions = container.querySelectorAll("hr").length;
    cleanup();

    const allowed = renderPanel(vi.fn());
    await screen.findByRole("button", { name: "Delete platform client" });
    expect(
      withoutActions,
      "no empty actions bar is left behind: only the actions bar's divider goes",
    ).toBe(allowed.container.querySelectorAll("hr").length - 1);
  });
});

describe("PlatformClientDetailPanel last use", () => {
  it("reads Never for a client that never minted a token", () => {
    renderPanel(vi.fn());
    expect(screen.getByText("Last used").nextElementSibling?.textContent).toBe(
      "Never",
    );
  });

  it("reads how long ago the client last minted a token", () => {
    const used = clone(PlatformClientSchema, PLATFORM_CLIENT);
    const now = new Date("2026-09-28T12:00:00Z");
    used.status = create(PlatformClientStatusSchema, {
      lastUsedAt: timestampFromDate(new Date(now.getTime() - 5 * 60_000)),
    });
    renderPanel(vi.fn(), used, ALLOW_ALL, now);
    expect(screen.getByText("Last used").nextElementSibling?.textContent).toBe(
      "5m",
    );
  });
});

describe("PlatformClientDetailPanel rename", () => {
  it("renames through the kind's rename for whoever may delete it, and hands the renamed resource to onUpdated", async () => {
    const renamed = clone(PlatformClientSchema, PLATFORM_CLIENT);
    if (renamed.metadata !== undefined) {
      renamed.metadata.slug = "renamed-slug";
    }
    const rename = vi.fn(async () => renamed);
    const onUpdated = vi.fn();
    const client = {
      platformclient: { rename },
      iamPolicy: { checkMyPermission: async () => ({ isAuthorized: true }) },
    } as never;
    render(
      <StigmerContext.Provider value={client}>
        <PlatformClientDetailPanel platformClient={PLATFORM_CLIENT} onUpdated={onUpdated} />
      </StigmerContext.Provider>,
    );

    fireEvent.change(await screen.findByLabelText("Slug", undefined, { timeout: 5000 }), {
      target: { value: "renamed-slug" },
    });
    const button = screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement;
    // The field settles before it takes the rename, however slow the runner.
    await waitFor(() => expect(button.disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(button);

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(renamed), { timeout: 5000 });
    expect(rename.mock.calls[0]).toEqual([expect.objectContaining({ resourceId: PLATFORM_CLIENT.metadata?.id, slug: "renamed-slug" })]);
  });
});
