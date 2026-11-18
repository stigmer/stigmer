// ---------------------------------------------------------------------------
// IdentityAccountGate — no org call runs before the caller's account exists
//
// Behind OIDC, a first-time visitor has no identity account until the SDK's
// gate provisions one; the org list read after it depends on that account.
// So the gate is enabled exactly when the runtime config says `oidc`, and
// in that mode only `ready` reaches the app: checking and provisioning wait,
// and a failure is shown with a retry. The screens are the kit's
// IdentityAccountGateView, pinned in @stigmer/react-sdk. Disabled-auth deployments hand the
// SDK `isEnabled: false`, which answers ready at once.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IdentityAccountGateState } from "@stigmer/react-sdk";
import type { AuthUser } from "@/auth";
import type { RuntimeConfig } from "@/config/runtime-config";

const gate = vi.hoisted(() => ({
  state: { status: "checking" } as IdentityAccountGateState,
  enabledArgs: [] as boolean[],
  retry: vi.fn(),
}));

// The gate's screens are the kit's IdentityAccountGateView (pinned in
// @stigmer/react-sdk); here a stand-in shows what the console hands it: the
// state, the welcome's name, Try again, and the signed-in corner.
vi.mock("@stigmer/react-sdk/console", () => ({
  IdentityAccountGateView: ({
    state,
    retry,
    displayName,
    corner,
    children,
  }: {
    state: IdentityAccountGateState;
    retry: () => void;
    displayName?: string;
    corner?: React.ReactNode;
    children?: React.ReactNode;
  }) => {
    if (state.status === "ready") return <>{children}</>;
    return (
      <div>
        <p>gate: {state.status}</p>
        <p>name: {displayName ?? "(none)"}</p>
        {corner}
        {state.status === "error" && <button onClick={retry}>Try again</button>}
      </div>
    );
  },
}));

vi.mock("@stigmer/react-sdk", async () => {
  const kit = await vi.importActual<typeof import("@stigmer/react-sdk")>("@stigmer/react-sdk");
  return {
    Button: kit.Button,
    useIdentityAccountGate: ({ isEnabled }: { isEnabled: boolean }) => {
      gate.enabledArgs.push(isEnabled);
      return { state: gate.state, retry: gate.retry };
    },
  };
});

const runtime = vi.hoisted(() => ({
  authMode: "oidc" as RuntimeConfig["authMode"],
}));
vi.mock("@/config/runtime-config", () => ({
  getRuntimeConfig: () => ({ authMode: runtime.authMode }),
}));

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
  logout: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ user: auth.user, logout: auth.logout }),
}));

import { IdentityAccountGate } from "../IdentityAccountGate";

function renderGate() {
  return render(
    <IdentityAccountGate>
      <p>the app</p>
    </IdentityAccountGate>,
  );
}

describe("IdentityAccountGate", () => {
  beforeEach(() => {
    gate.state = { status: "checking" };
    gate.enabledArgs = [];
    gate.retry.mockReset();
    runtime.authMode = "oidc";
    auth.user = null;
    auth.logout.mockReset();
  });

  it.each([
    ["oidc", true],
    ["disabled", false],
  ] as const)("enables the SDK gate for auth mode %s: %s", (mode, enabled) => {
    runtime.authMode = mode;
    renderGate();
    expect(gate.enabledArgs.at(-1)).toBe(enabled);
  });

  it("renders the app once the account is resolved", () => {
    gate.state = {
      status: "ready",
      account: {} as Extract<
        IdentityAccountGateState,
        { status: "ready" }
      >["account"],
    };
    renderGate();
    expect(screen.getByText("the app")).toBeTruthy();
  });

  it("holds the app back while the account is checked", () => {
    renderGate();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("welcomes a first-time visitor by name while their account is provisioned, without the app", () => {
    gate.state = { status: "provisioning" };
    auth.user = { email: "ada@example.com", name: "Ada" };
    renderGate();

    expect(screen.getByText("name: Ada")).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("falls back to the email, then to no name, when the visitor has no name", () => {
    gate.state = { status: "provisioning" };
    auth.user = { email: "ada@example.com" };
    const { unmount } = renderGate();
    expect(screen.getByText("name: ada@example.com")).toBeTruthy();
    unmount();

    auth.user = null;
    renderGate();
    expect(screen.getByText("name: (none)")).toBeTruthy();
  });

  it("shows the failure, retries on request, and offers sign-out", async () => {
    gate.state = { status: "error", message: "whoAmI failed" };
    auth.user = { email: "ada@example.com" };
    renderGate();

    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByText("gate: error")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(gate.retry).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });
});
