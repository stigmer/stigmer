import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  PlatformClientSchema,
  type PlatformClient,
} from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import type { CheckMyPermissionInput } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { StigmerContext } from "../../context";
import { PlatformClientListPanel } from "../PlatformClientListPanel";

/**
 * Pins what each row of the list says and offers:
 *
 *   - when the client last minted a token, "Used 5m" in the SDK's compact
 *     vocabulary, or "Never used" (stigmer/stigmer#1255);
 *   - Edit only with `can_edit` and Delete only with `can_delete` on the
 *     client, checked through the real permission hook, so an organization
 *     admin who may view a client they did not create is handed neither
 *     (stigmer/stigmer#1302);
 *   - an empty list says "No platform clients configured." unless the host
 *     passes the empty state for a caller who may not manage clients;
 *   - Edit hands the host the client; Delete asks first, Cancel backs out,
 *     and a confirmed delete re-reads the list.
 *
 * The data hook is stubbed; the delete hook runs over a stubbed client.
 */

const stubs = vi.hoisted(() => ({
  clients: [] as PlatformClient[],
  refetch: (() => {}) as () => void,
}));

vi.mock("../usePlatformClientList.js", () => ({
  usePlatformClientList: () => ({
    platformClients: stubs.clients,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: () => stubs.refetch(),
  }),
}));

const NOW = new Date("2026-09-28T12:00:00Z");

function client(id: string, name: string, lastUsedAt?: Date): PlatformClient {
  return create(PlatformClientSchema, {
    metadata: { id, name, slug: id, org: "acme" },
    spec: { clientId: `cid-${id}`, neverExpires: true },
    ...(lastUsedAt !== undefined
      ? { status: { lastUsedAt: timestampFromDate(lastUsedAt) } }
      : {}),
  });
}

function renderList(
  checkMyPermission: (
    input: CheckMyPermissionInput,
  ) => Promise<{ isAuthorized: boolean }>,
  props: { emptyState?: string; onEdit?: (client: PlatformClient) => void } = {},
  remove: (input: unknown) => Promise<unknown> = async () => ({}),
) {
  const stigmer = { iamPolicy: { checkMyPermission }, platformclient: { delete: remove } } as never;
  return render(
    <StigmerContext.Provider value={stigmer}>
      <PlatformClientListPanel
        org="acme"
        onEdit={() => {}}
        now={NOW}
        {...props}
      />
    </StigmerContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  stubs.clients = [];
  stubs.refetch = () => {};
});

describe("PlatformClientListPanel rows", () => {
  it("says when each client last minted a token, or that it never did", () => {
    stubs.clients = [
      client("pcl_used", "Dashboard", new Date(NOW.getTime() - 5 * 60_000)),
      client("pcl_idle", "Mobile"),
    ];
    renderList(async () => ({ isAuthorized: true }));

    expect(screen.getByText("Used 5m")).toBeTruthy();
    expect(screen.getByText("Never used")).toBeTruthy();
  });

  it("offers Edit only with can_edit and Delete only with can_delete on the client", async () => {
    stubs.clients = [client("pcl_dash", "Dashboard")];
    const checkMyPermission = vi.fn(async (input: CheckMyPermissionInput) => ({
      isAuthorized: input.relation === "can_delete",
    }));
    renderList(checkMyPermission);

    await screen.findByRole("button", { name: "Delete Dashboard" });
    expect(screen.queryByRole("button", { name: "Edit Dashboard" })).toBeNull();
    const asked = checkMyPermission.mock.calls.map(
      ([input]) =>
        `${input.resource?.kind}:${input.resource?.id}:${input.relation}`,
    );
    expect(asked.sort()).toEqual([
      "platform_client:pcl_dash:can_delete",
      "platform_client:pcl_dash:can_edit",
    ]);
  });

  it("an admin who did not create the client sees it with neither control", async () => {
    stubs.clients = [client("pcl_dash", "Dashboard")];
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized: false,
    }));
    renderList(checkMyPermission);

    await waitFor(() => expect(checkMyPermission).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Dashboard")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Edit Dashboard" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Delete Dashboard" })).toBeNull();
    });
  });
});

describe("PlatformClientListPanel empty state", () => {
  it("says none is configured by default", () => {
    renderList(async () => ({ isAuthorized: true }));
    expect(screen.getByText("No platform clients configured.")).toBeTruthy();
  });

  it("says what the host passes instead", () => {
    renderList(async () => ({ isAuthorized: true }), {
      emptyState: "Platform clients are managed by your organization's admins.",
    });
    expect(
      screen.getByText("Platform clients are managed by your organization's admins."),
    ).toBeTruthy();
    expect(screen.queryByText("No platform clients configured.")).toBeNull();
  });
});

describe("PlatformClientListPanel row actions", () => {
  it("hands Edit the client, backs out of a delete on Cancel, and re-reads the list after one", async () => {
    stubs.clients = [client("pcl_dash", "Dashboard")];
    const refetch = vi.fn();
    stubs.refetch = refetch;
    const onEdit = vi.fn();
    const remove = vi.fn(async () => ({}));
    renderList(async () => ({ isAuthorized: true }), { onEdit }, remove);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Dashboard" }));
    expect(onEdit.mock.calls[0]![0].metadata?.id).toBe("pcl_dash");

    fireEvent.click(screen.getByRole("button", { name: "Delete Dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
