import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
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

function renderPanel(update: ReturnType<typeof vi.fn>) {
  const client = {
    platformclient: { update },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <PlatformClientDetailPanel platformClient={PLATFORM_CLIENT} />
    </StigmerContext.Provider>,
  );
}

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
