// ---------------------------------------------------------------------------
// OrgGate — the app renders only once the visitor has an organization
//
// The SDK's useOrgGate derives the state and the kit's OrgGateView draws it;
// this gate wires the two. Only `ready` and `bypassed` reach the app. The one
// bypass is the invitation page (a visitor joining an org has none yet), and
// it is a path prefix, so a route that merely contains "invite" stays gated.
// An empty list goes to onboarding, and creating an org there refreshes the
// gate onto the new org's slug.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OrgGateState } from "@stigmer/react-sdk";
import type { AuthUser } from "@/auth";

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const gate = vi.hoisted(() => ({
  state: { status: "ready" } as OrgGateState,
  bypassArgs: [] as boolean[],
  retry: vi.fn(),
  refresh: vi.fn(),
}));

// The gate's screens are the kit's OrgGateView (pinned in
// @stigmer/react-sdk); here a stand-in shows what the console hands it: the
// state, Try again, the org made at onboarding, and the signed-in corner.
vi.mock("@stigmer/react-sdk/console", () => ({
  OrgGateView: ({
    state,
    retry,
    onCreated,
    corner,
    children,
  }: {
    state: OrgGateState;
    retry: () => void;
    onCreated: (org: { metadata?: { id?: string; slug?: string } }) => void;
    corner?: React.ReactNode;
    children?: React.ReactNode;
  }) => {
    if (state.status === "ready" || state.status === "bypassed") return <>{children}</>;
    return (
      <div>
        <p>gate: {state.status}</p>
        {corner}
        {state.status === "error" && <button onClick={retry}>Try again</button>}
        {state.status === "no-orgs" && (
          <button onClick={() => onCreated({ metadata: { id: "org_01jnnnnnnnnnnnnnnnnnnnnnnn", slug: "new-org" } })}>
            create org
          </button>
        )}
      </div>
    );
  },
  // The corner is the kit's account menu; here a stand-in offers its Sign out.
  UserMenu: ({ user, onSignOut }: { user: { name?: string; email?: string } | null; onSignOut?: () => void }) => (
    <div>
      <span>account: {user?.name ?? user?.email}</span>
      {onSignOut && <button onClick={onSignOut}>Sign out</button>}
    </div>
  ),
}));

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: vi.fn() }) }));

vi.mock("@stigmer/react-sdk", async () => {
  const kit = await vi.importActual<typeof import("@stigmer/react-sdk")>("@stigmer/react-sdk");
  return {
    Button: kit.Button,
    useOrgGate: ({ isBypassed }: { isBypassed: boolean }) => {
      gate.bypassArgs.push(isBypassed);
      return { state: gate.state, retry: gate.retry, refresh: gate.refresh };
    },
  };
});

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
  logout: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ user: auth.user, logout: auth.logout, login: vi.fn() }),
}));

import { OrgGate } from "../OrgGate";

function renderGate() {
  return render(
    <OrgGate>
      <p>the app</p>
    </OrgGate>,
  );
}

describe("OrgGate", () => {
  beforeEach(() => {
    nav.pathname = "/dashboard";
    gate.state = { status: "ready" };
    gate.bypassArgs = [];
    gate.retry.mockReset();
    gate.refresh.mockReset();
    auth.user = null;
    auth.logout.mockReset();
  });

  it.each([[{ status: "ready" } as const], [{ status: "bypassed" } as const]])(
    "renders the app for %o",
    (state) => {
      gate.state = state;
      renderGate();
      expect(screen.getByText("the app")).toBeTruthy();
    },
  );

  it("holds the app back while the organizations load", () => {
    gate.state = { status: "loading" };
    renderGate();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("shows the failure with its message and retries on request, never the app", async () => {
    gate.state = { status: "error", message: "organizations unavailable", error: new Error("organizations unavailable") };
    renderGate();

    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByText("gate: error")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(gate.retry).toHaveBeenCalledTimes(1);
  });

  it("sends a visitor with no organization to onboarding and refreshes onto the org they create", async () => {
    gate.state = { status: "no-orgs" };
    renderGate();

    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByText("gate: no-orgs")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "create org" }));
    expect(gate.refresh).toHaveBeenCalledWith("org_01jnnnnnnnnnnnnnnnnnnnnnnn");
  });

  it("offers sign-out to a signed-in visitor stuck at the gate", async () => {
    gate.state = { status: "no-orgs" };
    auth.user = { email: "ada@example.com", name: "Ada" };
    renderGate();

    expect(screen.getByText("account: Ada")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/invite/abc123", true],
    ["/invite/", true],
    ["/dashboard", false],
    ["/invite", false],
    ["/settings/invitations", false],
    ["/library/invite/abc", false],
  ])("asks the SDK to bypass for %s: %s", (pathname, bypassed) => {
    nav.pathname = pathname;
    renderGate();
    expect(gate.bypassArgs.at(-1)).toBe(bypassed);
  });
});
