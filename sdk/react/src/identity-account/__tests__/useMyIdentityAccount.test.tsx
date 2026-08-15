import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccountInput } from "@stigmer/sdk";
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

function UpdateProbe({ input }: { input: IdentityAccountInput }) {
  const { update, isUpdating, error } = useUpdateIdentityAccount();
  return (
    <button
      type="button"
      data-testid="probe"
      data-updating={String(isUpdating)}
      data-error={String(error !== null)}
      onClick={() => void update(input).catch(() => undefined)}
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
  it("submits the input through identityAccount.update", async () => {
    const update = vi.fn(async (_input: IdentityAccountInput) => ACCOUNT);
    const input: IdentityAccountInput = {
      name: "Ada",
      org: "acme",
      slug: "ada",
      idpId: "auth0|abc",
      preferences: { standingContext: "New" },
    };
    withClient({ identityAccount: { update } }, <UpdateProbe input={input} />);

    fireEvent.click(screen.getByTestId("probe"));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toEqual(input);
  });

  it("captures update failures in error state", async () => {
    const update = vi.fn(async () => {
      throw new Error("denied");
    });
    withClient(
      { identityAccount: { update } },
      <UpdateProbe input={{ name: "Ada", org: "acme", idpId: "x" }} />,
    );

    fireEvent.click(screen.getByTestId("probe"));

    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-error")).toBe(
        "true",
      ),
    );
  });
});
