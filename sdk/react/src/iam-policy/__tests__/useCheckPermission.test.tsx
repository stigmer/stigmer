import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import {
  useCheckPermission,
  type CheckPermissionOptions,
  type PermissionCheckResource,
} from "../useCheckPermission";

function createMockStigmer(checkMyPermission: ReturnType<typeof vi.fn>) {
  return { iamPolicy: { checkMyPermission } } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

/** Renders the hook and exposes its state via data attributes. */
function Probe({
  resource,
  relation = "can_edit",
  options,
}: {
  resource: PermissionCheckResource | null;
  relation?: string;
  options?: CheckPermissionOptions;
}) {
  const { allowed, isLoading, error } = useCheckPermission(
    resource,
    relation,
    options,
  );
  return (
    <div
      data-testid="probe"
      data-allowed={String(allowed)}
      data-loading={String(isLoading)}
      data-error={String(error !== null)}
    />
  );
}

const AGENT: PermissionCheckResource = { kind: "agent", id: "agt_1" };

/** A checkMyPermission stub that stays pending until resolved manually. */
function pendingCheck() {
  let resolve!: (value: { isAuthorized: boolean }) => void;
  let reject!: (err: unknown) => void;
  const check = vi.fn().mockReturnValue(
    new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    }),
  );
  return { check, resolve: (v: boolean) => resolve({ isAuthorized: v }), reject: (e: unknown) => reject(e) };
}

afterEach(cleanup);

describe("useCheckPermission — fail-open (default)", () => {
  it("is allowed while the check is in flight", async () => {
    const { check } = pendingCheck();
    render(<Probe resource={AGENT} />, {
      wrapper: wrapper(createMockStigmer(check)),
    });

    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-allowed")).toBe("true");
    await waitFor(() =>
      expect(probe.getAttribute("data-loading")).toBe("true"),
    );
  });

  it("respects an explicit server denial", async () => {
    const check = vi.fn().mockResolvedValue({ isAuthorized: false });
    render(<Probe resource={AGENT} />, {
      wrapper: wrapper(createMockStigmer(check)),
    });

    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-allowed")).toBe("false"),
    );
  });

  it("respects an explicit server grant", async () => {
    const check = vi.fn().mockResolvedValue({ isAuthorized: true });
    render(<Probe resource={AGENT} />, {
      wrapper: wrapper(createMockStigmer(check)),
    });

    const probe = screen.getByTestId("probe");
    await waitFor(() => expect(probe.getAttribute("data-loading")).toBe("false"));
    expect(probe.getAttribute("data-allowed")).toBe("true");
    expect(probe.getAttribute("data-error")).toBe("false");
  });

  it("fails open on RPC rejection (OSS single-user mode)", async () => {
    const check = vi.fn().mockRejectedValue(new Error("unimplemented"));
    render(<Probe resource={AGENT} />, {
      wrapper: wrapper(createMockStigmer(check)),
    });

    const probe = screen.getByTestId("probe");
    await waitFor(() => expect(probe.getAttribute("data-error")).toBe("true"));
    expect(probe.getAttribute("data-allowed")).toBe("true");
    expect(probe.getAttribute("data-loading")).toBe("false");
  });

  it("is allowed when resource is null (check skipped, no RPC)", () => {
    const check = vi.fn();
    render(<Probe resource={null} />, {
      wrapper: wrapper(createMockStigmer(check)),
    });

    expect(screen.getByTestId("probe").getAttribute("data-allowed")).toBe("true");
    expect(check).not.toHaveBeenCalled();
  });
});

describe("useCheckPermission — fail-closed", () => {
  const CLOSED: CheckPermissionOptions = { fail: "closed" };

  it("is denied while the check is in flight (no flash of gated UI)", async () => {
    const { check } = pendingCheck();
    render(<Probe resource={AGENT} options={CLOSED} />, {
      wrapper: wrapper(createMockStigmer(check)),
    });

    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-allowed")).toBe("false");
    await waitFor(() =>
      expect(probe.getAttribute("data-loading")).toBe("true"),
    );
    expect(probe.getAttribute("data-allowed")).toBe("false");
  });

  it("is allowed only on an explicit server grant", async () => {
    const check = vi.fn().mockResolvedValue({ isAuthorized: true });
    render(<Probe resource={AGENT} options={CLOSED} />, {
      wrapper: wrapper(createMockStigmer(check)),
    });

    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-allowed")).toBe("true"),
    );
  });

  it("fails closed on RPC rejection", async () => {
    const check = vi.fn().mockRejectedValue(new Error("unimplemented"));
    render(<Probe resource={AGENT} options={CLOSED} />, {
      wrapper: wrapper(createMockStigmer(check)),
    });

    const probe = screen.getByTestId("probe");
    await waitFor(() => expect(probe.getAttribute("data-error")).toBe("true"));
    expect(probe.getAttribute("data-allowed")).toBe("false");
    expect(probe.getAttribute("data-loading")).toBe("false");
  });

  it("is denied when resource is null (check skipped)", () => {
    const check = vi.fn();
    render(<Probe resource={null} options={CLOSED} />, {
      wrapper: wrapper(createMockStigmer(check)),
    });

    expect(screen.getByTestId("probe").getAttribute("data-allowed")).toBe("false");
    expect(check).not.toHaveBeenCalled();
  });
});

describe("useCheckPermission — caching", () => {
  it("serves repeat checks of the same triple from the mount cache", async () => {
    const check = vi.fn().mockResolvedValue({ isAuthorized: true });
    const { rerender } = render(<Probe resource={AGENT} />, {
      wrapper: wrapper(createMockStigmer(check)),
    });
    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-allowed")).toBe("true"),
    );

    // Switch relation (new triple → one more RPC), then switch back
    // (cached triple → served without an RPC).
    rerender(<Probe resource={AGENT} relation="can_delete" />);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    rerender(<Probe resource={AGENT} relation="can_edit" />);
    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-allowed")).toBe("true"),
    );
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed check as a verdict", async () => {
    // First mount errors; the error must not be pinned as `true` — a
    // remount (fresh cache) with a healthy server gets the real verdict.
    const failing = vi.fn().mockRejectedValue(new Error("blip"));
    const { unmount } = render(
      <Probe resource={AGENT} options={{ fail: "closed" }} />,
      { wrapper: wrapper(createMockStigmer(failing)) },
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-error")).toBe("true"),
    );
    expect(screen.getByTestId("probe").getAttribute("data-allowed")).toBe("false");
    unmount();

    const healthy = vi.fn().mockResolvedValue({ isAuthorized: true });
    render(<Probe resource={AGENT} options={{ fail: "closed" }} />, {
      wrapper: wrapper(createMockStigmer(healthy)),
    });
    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-allowed")).toBe("true"),
    );
  });
});
