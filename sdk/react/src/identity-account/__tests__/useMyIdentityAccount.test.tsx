import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { StigmerContext } from "../../context";
import { useMyIdentityAccount } from "../useMyIdentityAccount";
import { useUpdateIdentityAccount } from "../useUpdateIdentityAccount";

const ACCOUNT: IdentityAccount = create(IdentityAccountSchema, {
  metadata: { id: "ia-1", name: "Ada", slug: "ada", org: "acme" },
  spec: { preferences: { standingContext: "Keep answers terse." } },
});

/** Renders the data hook and exposes its state via data attributes. */
function FetchProbe() {
  const { account, isLoading, error, refetch } = useMyIdentityAccount();
  return (
    <button
      type="button"
      data-testid="probe"
      data-loading={String(isLoading)}
      data-error={String(error !== null)}
      data-context={account?.spec?.preferences?.standingContext ?? ""}
      onClick={refetch}
    />
  );
}

type AccountEdit = { resource: MessageInitShape<typeof IdentityAccountSchema>; paths: string[] };

function UpdateProbe({ input }: { input: AccountEdit }) {
  const { update, isUpdating, error } = useUpdateIdentityAccount();
  return (
    <button
      type="button"
      data-testid="probe"
      data-updating={String(isUpdating)}
      data-error={String(error !== null)}
      onClick={() => void update(input.resource, input.paths).catch(() => undefined)}
    />
  );
}

function withClient(client: unknown, ui: React.ReactNode) {
  return render(
    <StigmerContext.Provider value={client as never}>
      {ui}
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("useMyIdentityAccount", () => {
  it("fetches the caller's account via whoAmI and supports refetch", async () => {
    const whoAmI = vi.fn(async () => ACCOUNT);
    withClient({ identityAccount: { whoAmI } }, <FetchProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-context")).toBe(
        "Keep answers terse.",
      ),
    );
    expect(whoAmI).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("probe"));
    await waitFor(() => expect(whoAmI).toHaveBeenCalledTimes(2));
  });

  it("surfaces errors as state", async () => {
    const whoAmI = vi.fn(async () => {
      throw new Error("boom");
    });
    withClient({ identityAccount: { whoAmI } }, <FetchProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-error")).toBe(
        "true",
      ),
    );
  });
});

describe("useUpdateIdentityAccount", () => {
  it("submits the resource and the paths through identityAccount.update", async () => {
    const update = vi.fn(async (_resource: unknown, _paths: string[]) => ACCOUNT);
    const input: AccountEdit = {
      resource: {
        metadata: { id: "ia-1", etag: "etag-at-load" },
        spec: { preferences: { standingContext: "New" } },
      },
      paths: ["spec.preferences.standing_context"],
    };
    withClient({ identityAccount: { update } }, <UpdateProbe input={input} />);

    fireEvent.click(screen.getByTestId("probe"));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]).toEqual([input.resource, input.paths]);
  });

  it("captures update failures in error state", async () => {
    const update = vi.fn(async () => {
      throw new Error("denied");
    });
    withClient(
      { identityAccount: { update } },
      <UpdateProbe input={{ resource: { metadata: { id: "ia-1" } }, paths: ["metadata.name"] }} />,
    );

    fireEvent.click(screen.getByTestId("probe"));

    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-error")).toBe(
        "true",
      ),
    );
  });
});
