import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clone, create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  PlatformClientSchema,
  type PlatformClient,
} from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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

function renderPanel(
  update: ReturnType<typeof vi.fn>,
  platformClient: PlatformClient = PLATFORM_CLIENT,
) {
  const client = {
    platformclient: { update },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <PlatformClientDetailPanel platformClient={platformClient} />
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

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
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
  it("an expired client reads Expired, and its rotate confirmation says rotating will not help", () => {
    renderPanel(vi.fn(), clientExpiringInDays(-1));

    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.queryByText("Expires")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rotate secret" }));
    expect(screen.getByText(ROTATE_WILL_NOT_HELP)).toBeTruthy();
  });

  it("a live client reads Expires, and its rotate confirmation carries no expiry warning", () => {
    renderPanel(vi.fn(), clientExpiringInDays(1));

    expect(screen.getByText("Expires")).toBeTruthy();
    expect(screen.queryByText("Expired")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rotate secret" }));
    expect(screen.queryByText(ROTATE_WILL_NOT_HELP)).toBeNull();
  });
});
