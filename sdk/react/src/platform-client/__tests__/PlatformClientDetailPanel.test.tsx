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
import type { PlatformClientInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { PlatformClientDetailPanel } from "../PlatformClientDetailPanel";

/**
 * Regression suite for the full-spec-replace wipe bug: before the
 * generated-mapper migration, this panel hand-built its update input and
 * NEVER sent `environment_refs` — saving any edit silently wiped the
 * client's credential-delivery environment bindings. The panel must
 * spread `toPlatformClientUpdateInput` and override only what it edits.
 *
 * Also pins how the panel presents an expired client (#1254): the view
 * says "Expired", and the rotate confirmation says rotating will not help,
 * because rotation leaves the expiry as it is. A live client shows
 * neither.
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
    autoProvisionAccounts: true,
    autoGrantOnOrg: true,
    autoGrantRole: IamRole.admin,
    allowedOrigins: ["https://embed.acme.example"],
    environmentRefs: [
      { org: "acme", slug: "prod", kind: ApiResourceKind.environment },
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
  it("round-trips environment_refs on an origins-only edit (the wipe bug)", async () => {
    const update = vi.fn(async (_input: PlatformClientInput) => PLATFORM_CLIENT);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    // The wipe-bug guard: the form does not render environment bindings,
    // yet they must survive the save.
    expect(input.environmentRefs).toEqual([
      { org: "acme", slug: "prod", kind: ApiResourceKind.environment },
    ]);
    // Form-owned fields round-trip from the edit state.
    expect(input.allowedOrigins).toEqual(["https://embed.acme.example"]);
    expect(input.autoGrantRole).toBe(IamRole.admin);
    expect(input.expiresAt).toBeInstanceOf(Date);
    // Addressing fields for the update pipeline's org+slug lookup.
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("embed-client");
    expect(input.name).toBe("Embed Client");
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
    expect(asked.sort()).toEqual([
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

    await waitFor(() => expect(checkMyPermission).toHaveBeenCalledTimes(2));
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
