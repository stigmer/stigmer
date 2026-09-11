/**
 * Pins useCanSetPublicVisibility's edition shape (editions program,
 * sp.edition-contract §3d): the hook asks whether the server has an
 * operator seat (the `platform` kind is served), not which deployment mode
 * it is in. Without a seat the answer is always allowed and no RPC is made
 * (the self-hosted operator owns the store). With a seat — Enterprise and
 * Cloud alike — the fail-closed permission check decides. Before this
 * shape, two independent mode compares left an "enterprise" server with
 * neither arm and a permanent `allowed: false`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DeploymentMode } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { useCanSetPublicVisibility } from "../useCanSetPublicVisibility";

function wrapper(
  mode: DeploymentMode,
  checkMyPermission: ReturnType<typeof vi.fn>,
) {
  const client = { iamPolicy: { checkMyPermission } } as never;
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <DeploymentModeContext.Provider value={mode}>
          {children}
        </DeploymentModeContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

function Probe() {
  const { allowed, isLoading } = useCanSetPublicVisibility();
  return (
    <div
      data-testid="probe"
      data-allowed={String(allowed)}
      data-loading={String(isLoading)}
    />
  );
}

afterEach(cleanup);

describe("useCanSetPublicVisibility", () => {
  it("local: always allowed, no permission RPC (no operator seat to ask)", () => {
    const check = vi.fn();
    render(<Probe />, { wrapper: wrapper("local", check) });
    const probe = screen.getByTestId("probe");
    expect(probe.dataset.allowed).toBe("true");
    expect(probe.dataset.loading).toBe("false");
    expect(check).not.toHaveBeenCalled();
  });

  it.each(["enterprise", "cloud"] as const)(
    "%s: the fail-closed check on platform:stigmer decides",
    async (mode) => {
      const check = vi.fn().mockResolvedValue({ isAuthorized: true });
      render(<Probe />, { wrapper: wrapper(mode, check) });
      await waitFor(() =>
        expect(screen.getByTestId("probe").dataset.allowed).toBe("true"),
      );
      expect(check).toHaveBeenCalledTimes(1);
      const input = check.mock.calls[0]?.[0] as {
        resource?: { kind: string; id: string };
        relation: string;
      };
      expect(input.resource).toMatchObject({ kind: "platform", id: "stigmer" });
      expect(input.relation).toBe("can_set_public_visibility");
    },
  );

  it("enterprise: denied when the seat says no — never the accidental always-false of a missed arm", async () => {
    const check = vi.fn().mockResolvedValue({ isAuthorized: false });
    render(<Probe />, { wrapper: wrapper("enterprise", check) });
    await waitFor(() =>
      expect(screen.getByTestId("probe").dataset.loading).toBe("false"),
    );
    expect(screen.getByTestId("probe").dataset.allowed).toBe("false");
    expect(check).toHaveBeenCalledTimes(1);
  });
});
