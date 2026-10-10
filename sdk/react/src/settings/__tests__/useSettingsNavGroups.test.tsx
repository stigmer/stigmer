import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import {
  ORG_ADMIN_SETTINGS_NAV_ITEMS,
  SETTINGS_NAV_GROUPS,
  SINGLE_ORG_SETTINGS_NAV_GROUPS,
  PLATFORM_SETTINGS_NAV_GROUP,
} from "../settings-nav";
import { useSettingsNavGroups } from "../useSettingsNavGroups";

// Drive the nav gate through the permission hook. The fail-closed
// semantics themselves are covered by useCheckPermission's own suite —
// here we assert the nav hook's per-item composition of the verdicts.
// Verdicts are keyed by relation so each platform permission can be
// granted independently.
let verdicts: Record<string, boolean> = {};
let checkedRelations: string[] = [];
let checks: (readonly [unknown, string, { fail?: string } | undefined])[] = [];

vi.mock("../../iam-policy/useCheckPermission", () => ({
  useCheckPermission: (
    ...args: [unknown, string, { fail?: string } | undefined]
  ) => {
    checks.push(args);
    checkedRelations.push(args[1]);
    // A skipped check (no resource) answers as the closed fail mode does.
    return { allowed: args[0] !== null && verdicts[args[1]] === true, isLoading: false, error: null };
  },
}));

// The active organization, as an enclosing OrgProvider reports it; `null`
// is a host with no OrgProvider.
let activeOrgId: string | null = "org_acme";

vi.mock("../../organization/OrgProvider", () => ({
  useOptionalOrg: () =>
    activeOrgId === null ? null : { activeOrg: { metadata: { id: activeOrgId } } },
}));

// Whether the server holds one organization, as useSingleOrg reports it:
// undefined while loading, then true or false.
let singleOrg: boolean | undefined = false;

vi.mock("../../server-info", () => ({
  useSingleOrg: () => singleOrg,
}));

afterEach(() => {
  cleanup();
  verdicts = {};
  checkedRelations = [];
  checks = [];
  singleOrg = false;
  activeOrgId = "org_acme";
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

describe("useSettingsNavGroups on a server that holds one organization", () => {
  it("names no organization: the first group is General, without the organization's profile", () => {
    singleOrg = true;
    render(<GroupsProbe />);

    const labels = screen.getByTestId("groups").getAttribute("data-labels");
    expect(labels).toBe(SINGLE_ORG_SETTINGS_NAV_GROUPS.map((g) => g.label).join(","));
    expect(SINGLE_ORG_SETTINGS_NAV_GROUPS[0]?.label).toBe("General");
    expect(SINGLE_ORG_SETTINGS_NAV_GROUPS[0]?.items.map((i) => i.label)).toEqual([
      "Preferences",
      "Policies",
      "Members",
      "Teams",
      "Invitations",
      "Identity Providers",
    ]);
    expect(SINGLE_ORG_SETTINGS_NAV_GROUPS.slice(1)).toEqual(SETTINGS_NAV_GROUPS.slice(1));
  });

  it("leaves the first group out while the answer loads", () => {
    singleOrg = undefined;
    render(<GroupsProbe />);
    expect(screen.getByTestId("groups").getAttribute("data-labels")).toBe(
      SETTINGS_NAV_GROUPS.slice(1)
        .map((g) => g.label)
        .join(","),
    );
  });

  it("shows the organization groups when the server holds several", () => {
    singleOrg = false;
    render(<GroupsProbe />);
    expect(screen.getByTestId("groups").getAttribute("data-labels")).toBe(BASE_LABELS);
  });
});

describe("useSettingsNavGroups", () => {
  it("appends the full Platform group when the operator holds every platform permission", () => {
    verdicts = {
      can_manage_model_pricing: true,
      can_manage_cursor_accounts: true,
      can_view_provider_standing: true,
      can_issue_license: true,
      can_manage_plans: true,
    };
    render(<GroupsProbe />);

    const el = screen.getByTestId("groups");
    expect(el.getAttribute("data-labels")).toBe(
      `${BASE_LABELS},${PLATFORM_SETTINGS_NAV_GROUP.label}`,
    );
    expect(el.getAttribute("data-platform-items")).toBe(
      "Pricing Governance,Cursor Accounts,Provider Standing,Licenses,Plans",
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

  it("filters per item: standing-only operator sees only Provider Standing", () => {
    verdicts = { can_view_provider_standing: true };
    render(<GroupsProbe />);

    expect(screen.getByTestId("groups").getAttribute("data-platform-items")).toBe(
      "Provider Standing",
    );
  });

  it("filters per item: license-issuing operator sees only Licenses", () => {
    verdicts = { can_issue_license: true };
    render(<GroupsProbe />);

    expect(screen.getByTestId("groups").getAttribute("data-platform-items")).toBe(
      "Licenses",
    );
  });

  it("filters per item: plan-managing operator sees only Plans", () => {
    verdicts = { can_manage_plans: true };
    render(<GroupsProbe />);

    expect(screen.getByTestId("groups").getAttribute("data-platform-items")).toBe(
      "Plans",
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
    for (const [resource, relation, options] of checks) {
      if (!declared.includes(relation)) continue;
      expect(resource).toEqual({ kind: "platform", id: "stigmer" });
      expect(options).toEqual({ fail: "closed" });
    }
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

describe("useSettingsNavGroups and the organization's admin entries", () => {
  function FirstGroupProbe() {
    const groups = useSettingsNavGroups();
    return (
      <div
        data-testid="first"
        data-label={groups[0]?.label ?? ""}
        data-items={groups[0]?.items.map((i) => i.href).join(",") ?? ""}
      />
    );
  }

  const items = () => screen.getByTestId("first").getAttribute("data-items")?.split(",") ?? [];

  it("adds Service accounts after Teams for a caller who manages them on the active organization", () => {
    verdicts = { can_create_identity_account: true };
    render(<FirstGroupProbe />);
    const hrefs = items();
    expect(hrefs.indexOf("/settings/service-accounts")).toBe(hrefs.indexOf("/settings/teams") + 1);
    expect(checks).toContainEqual([
      { kind: "organization", id: "org_acme" },
      "can_create_identity_account",
      { fail: "closed" },
    ]);
  });

  it("adds it to General on a server that holds one organization", () => {
    singleOrg = true;
    verdicts = { can_create_identity_account: true };
    render(<FirstGroupProbe />);
    expect(screen.getByTestId("first").getAttribute("data-label")).toBe("General");
    expect(items()).toContain("/settings/service-accounts");
  });

  it("shows it to nobody the server has not said yes for, and with no organization active", () => {
    render(<FirstGroupProbe />);
    expect(items()).not.toContain("/settings/service-accounts");
    cleanup();

    activeOrgId = null;
    verdicts = { can_create_identity_account: true };
    render(<FirstGroupProbe />);
    expect(items()).not.toContain("/settings/service-accounts");
  });

  it("declares every organization entry's permission, and checks each", () => {
    verdicts = { can_create_identity_account: true };
    render(<FirstGroupProbe />);
    for (const item of ORG_ADMIN_SETTINGS_NAV_ITEMS) {
      expect(item.requiredPermission).toBeDefined();
      expect(checkedRelations).toContain(item.requiredPermission);
    }
  });
});
