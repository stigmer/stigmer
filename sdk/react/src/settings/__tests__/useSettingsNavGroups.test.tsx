import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { SETTINGS_NAV_GROUPS, PLATFORM_SETTINGS_NAV_GROUP } from "../settings-nav";
import { useSettingsNavGroups } from "../useSettingsNavGroups";

// Drive the nav gate through the permission hook. The fail-closed
// semantics themselves are covered by useCheckPermission's own suite —
// here we assert the nav hook's composition of the verdict.
const checkPermission = vi.fn<() => { allowed: boolean; isLoading: boolean; error: Error | null }>(
  () => ({ allowed: false, isLoading: false, error: null }),
);
vi.mock("../../iam-policy/useCheckPermission", () => ({
  useCheckPermission: (
    ...args: [unknown, unknown, { fail?: string } | undefined]
  ) => {
    lastCheckArgs = args;
    return checkPermission();
  },
}));

let lastCheckArgs: readonly unknown[] = [];

afterEach(() => {
  cleanup();
  checkPermission.mockReset();
  checkPermission.mockReturnValue({ allowed: false, isLoading: false, error: null });
});

function GroupsProbe() {
  const groups = useSettingsNavGroups();
  return (
    <div data-testid="groups" data-labels={groups.map((g) => g.label).join(",")} />
  );
}

const BASE_LABELS = SETTINGS_NAV_GROUPS.map((g) => g.label).join(",");

describe("useSettingsNavGroups", () => {
  it("appends the Platform group for platform operators", () => {
    checkPermission.mockReturnValue({ allowed: true, isLoading: false, error: null });
    render(<GroupsProbe />);

    expect(screen.getByTestId("groups").getAttribute("data-labels")).toBe(
      `${BASE_LABELS},${PLATFORM_SETTINGS_NAV_GROUP.label}`,
    );
  });

  it("returns exactly the base groups when not authorized", () => {
    function IdentityProbe() {
      const groups = useSettingsNavGroups();
      return (
        <div
          data-testid="identity"
          data-is-base={String(groups === SETTINGS_NAV_GROUPS)}
        />
      );
    }
    render(<IdentityProbe />);

    // Not just equivalent — the same array, no needless copy.
    expect(screen.getByTestId("identity").getAttribute("data-is-base")).toBe("true");
  });

  it("checks can_manage_model_pricing on platform:stigmer, fail-closed", () => {
    render(<GroupsProbe />);

    expect(lastCheckArgs[0]).toEqual({ kind: "platform", id: "stigmer" });
    expect(lastCheckArgs[1]).toBe("can_manage_model_pricing");
    expect(lastCheckArgs[2]).toEqual({ fail: "closed" });
  });

  it("keeps the array reference stable across re-renders", () => {
    checkPermission.mockReturnValue({ allowed: true, isLoading: false, error: null });

    function StabilityProbe() {
      const groups = useSettingsNavGroups();
      const first = useRef(groups);
      const [, force] = useState(0);
      return (
        <button
          data-testid="stability"
          data-stable={String(first.current === groups)}
          onClick={() => force((n) => n + 1)}
        />
      );
    }

    render(<StabilityProbe />);
    const el = screen.getByTestId("stability");
    fireEvent.click(el);
    expect(el.getAttribute("data-stable")).toBe("true");
  });
});
