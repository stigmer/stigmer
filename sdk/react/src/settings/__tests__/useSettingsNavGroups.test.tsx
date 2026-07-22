import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { SETTINGS_NAV_GROUPS, PLATFORM_SETTINGS_NAV_GROUP } from "../settings-nav";
import { useSettingsNavGroups } from "../useSettingsNavGroups";

// Drive the nav gate through the permission hook. The fail-closed
// semantics themselves are covered by useCheckPermission's own suite —
// here we assert the nav hook's per-item composition of the verdicts.
// Verdicts are keyed by relation so each platform permission can be
// granted independently.
let verdicts: Record<string, boolean> = {};
let checkedRelations: string[] = [];
let lastCheckArgs: readonly unknown[] = [];

vi.mock("../../iam-policy/useCheckPermission", () => ({
  useCheckPermission: (
    ...args: [unknown, string, { fail?: string } | undefined]
  ) => {
    lastCheckArgs = args;
    checkedRelations.push(args[1]);
    return { allowed: verdicts[args[1]] === true, isLoading: false, error: null };
  },
}));

afterEach(() => {
  cleanup();
  verdicts = {};
  checkedRelations = [];
});

function GroupsProbe() {
  const groups = useSettingsNavGroups();
  const platform = groups.find((g) => g.label === PLATFORM_SETTINGS_NAV_GROUP.label);
  return (
    <div
      data-testid="groups"
      data-labels={groups.map((g) => g.label).join(",")}
      data-platform-items={platform?.items.map((i) => i.label).join(",") ?? ""}
    />
  );
}

const BASE_LABELS = SETTINGS_NAV_GROUPS.map((g) => g.label).join(",");

describe("useSettingsNavGroups", () => {
  it("appends the full Platform group when the operator holds every platform permission", () => {
    verdicts = {
      can_manage_model_pricing: true,
      can_manage_cursor_accounts: true,
    };
    render(<GroupsProbe />);

    const el = screen.getByTestId("groups");
    expect(el.getAttribute("data-labels")).toBe(
      `${BASE_LABELS},${PLATFORM_SETTINGS_NAV_GROUP.label}`,
    );
    expect(el.getAttribute("data-platform-items")).toBe(
      "Pricing Governance,Cursor Accounts",
    );
  });

  it("filters per item: pricing-only operator sees only Pricing Governance", () => {
    verdicts = { can_manage_model_pricing: true };
    render(<GroupsProbe />);

    expect(screen.getByTestId("groups").getAttribute("data-platform-items")).toBe(
      "Pricing Governance",
    );
  });

  it("filters per item: cursor-accounts-only operator sees only Cursor Accounts", () => {
    verdicts = { can_manage_cursor_accounts: true };
    render(<GroupsProbe />);

    expect(screen.getByTestId("groups").getAttribute("data-platform-items")).toBe(
      "Cursor Accounts",
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

  it("checks every declared platform permission on platform:stigmer, fail-closed", () => {
    render(<GroupsProbe />);

    // Exhaustiveness guard: every requiredPermission declared on the
    // platform group must have a corresponding hook check — a new
    // platform surface that forgets to add its check fails here.
    const declared = PLATFORM_SETTINGS_NAV_GROUP.items.map(
      (item) => item.requiredPermission,
    );
    for (const permission of declared) {
      expect(permission, "platform items must declare requiredPermission").toBeDefined();
      expect(checkedRelations).toContain(permission);
    }
    expect(lastCheckArgs[0]).toEqual({ kind: "platform", id: "stigmer" });
    expect(lastCheckArgs[2]).toEqual({ fail: "closed" });
  });

  it("keeps the array reference stable across re-renders", () => {
    verdicts = {
      can_manage_model_pricing: true,
      can_manage_cursor_accounts: true,
    };

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
