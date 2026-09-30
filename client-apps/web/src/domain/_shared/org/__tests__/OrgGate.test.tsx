// ---------------------------------------------------------------------------
// OrgGate — the app renders only once the visitor has an organization
//
// The SDK's useOrgGate derives the state; this gate decides what the console
// shows for each one. Only `ready` and `bypassed` reach the app. The one
// bypass is the invitation page (a visitor joining an org has none yet), and
// it is a path prefix, so a route that merely contains "invite" stays gated.
// An empty list goes to onboarding, and creating an org there refreshes the
// gate onto the new org's slug.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OrgGateState } from "@stigmer/react";
import type { AuthUser } from "@/auth";

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const gate = vi.hoisted(() => ({
  state: { status: "ready" } as OrgGateState,
  bypassArgs: [] as boolean[],
  retry: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@stigmer/react", () => ({
  useOrgGate: ({ isBypassed }: { isBypassed: boolean }) => {
    gate.bypassArgs.push(isBypassed);
    return { state: gate.state, retry: gate.retry, refresh: gate.refresh };
  },
  CreateOrganizationForm: ({
    onCreated,
  }: {
    onCreated: (org: { metadata?: { slug?: string } }) => void;
  }) => (
    <button onClick={() => onCreated({ metadata: { slug: "new-org" } })}>
      create org
    </button>
  ),
}));

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
  logout: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ user: auth.user, logout: auth.logout }),
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
    gate.state = { status: "error", message: "organizations unavailable" };
    renderGate();

    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByText("Failed to load organizations")).toBeTruthy();
    expect(screen.getByText("organizations unavailable")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(gate.retry).toHaveBeenCalledTimes(1);
  });

  it("sends a visitor with no organization to onboarding and refreshes onto the org they create", async () => {
    gate.state = { status: "no-orgs" };
    renderGate();

    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByText("Welcome to Stigmer")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "create org" }));
    expect(gate.refresh).toHaveBeenCalledWith("new-org");
  });

  it("offers sign-out to a signed-in visitor stuck at the gate", async () => {
    gate.state = { status: "no-orgs" };
    auth.user = { email: "ada@example.com", name: "Ada" };
    renderGate();

    expect(screen.getByText("ada@example.com")).toBeTruthy();
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
