/**
 * One plugin server's sign-in cell over the real `usePluginServerSignIn`,
 * with My vault (`useMyVault`) and the popup sign-in (`useVaultSignIn`)
 * stubbed as plain state. Pins: the cell reads "Reading…" while My vault is
 * read and says why when it cannot be; a server that signs in offers Sign
 * in, which clears the last failure, signs in at the server's address into
 * the organization's My vault, then rereads My vault and tells the host; a
 * failed sign-in leaves Sign in with the reason; the busy button names the
 * sign-in's phase; a login at the address reads Signed in with Sign out,
 * which asks once, can be cancelled, removes the login at the address, and
 * shows a refused removal; a login that serves the server from elsewhere
 * (the github.com login) reads Signed in without Sign out; a key-taking
 * server names its keys; an open server renders nothing; and the hook held
 * idle (no org or no server) reads as loading and signs in nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { type McpServerEntry, McpServerEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { type Vault, VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import type { VaultSignInPhase } from "../../vault/useVaultSignIn.js";

const stubs = vi.hoisted(() => ({
  myVault: {
    vault: null as unknown,
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
    removeConnections: vi.fn(),
  },
  signIn: {
    signIn: vi.fn(),
    phase: "idle" as string,
    isInProgress: false,
    error: null as Error | null,
    clearError: vi.fn(),
  },
}));

vi.mock("../../vault/useMyVault.js", () => ({ useMyVault: () => stubs.myVault }));
vi.mock("../../vault/useVaultSignIn.js", () => ({ useVaultSignIn: () => stubs.signIn }));

import { PluginServerSignIn, phaseLabel } from "../PluginServerSignIn.js";
import { usePluginServerSignIn } from "../usePluginServerSignIn.js";

const ORG = "acme";
const LINEAR_URL = "https://mcp.linear.app/mcp";
const GITHUB_URL = "https://api.github.com/mcp";

const LINEAR = create(McpServerEntrySchema, { name: "linear", transport: { case: "http", value: { url: LINEAR_URL } }, signIn: {} });
const GITHUB = create(McpServerEntrySchema, { name: "github", transport: { case: "http", value: { url: GITHUB_URL } }, signIn: {} });
const SEARCH = create(McpServerEntrySchema, {
  name: "search",
  transport: { case: "stdio", value: { command: "npx", args: ["search-mcp"] } },
  env: ["SEARCH_KEY", "SEARCH_REGION"],
});
const OPEN = create(McpServerEntrySchema, { name: "docs", transport: { case: "http", value: { url: "https://docs.example/mcp" } } });

function vaultWithLogins(addresses: readonly string[]): Vault {
  return create(VaultSchema, {
    metadata: { org: ORG, slug: "mine" },
    spec: {
      owner: { case: "person", value: "ida_1" },
      connections: Object.fromEntries(addresses.map((address) => [address, { source: VaultConnectionSource.sign_in }])),
    },
  });
}

beforeEach(() => {
  stubs.myVault.vault = vaultWithLogins([]);
  stubs.myVault.isLoading = false;
  stubs.myVault.error = null;
  stubs.myVault.refetch = vi.fn();
  stubs.myVault.removeConnections = vi.fn(async () => vaultWithLogins([]));
  stubs.signIn.signIn = vi.fn(async () => ({ address: LINEAR_URL, description: "" }));
  stubs.signIn.phase = "idle";
  stubs.signIn.isInProgress = false;
  stubs.signIn.error = null;
  stubs.signIn.clearError = vi.fn();
});

afterEach(cleanup);

function renderCell(server: McpServerEntry, onSignedIn = vi.fn()) {
  const view = render(<PluginServerSignIn org={ORG} server={server} onSignedIn={onSignedIn} className="host-class" />);
  return { onSignedIn, view };
}

describe("PluginServerSignIn: reading My vault", () => {
  it("reads Reading… while My vault is read", () => {
    stubs.myVault.isLoading = true;
    renderCell(LINEAR);
    expect(screen.getByRole("status").textContent).toBe("Reading…");
  });

  it("says why My vault could not be read", () => {
    stubs.myVault.vault = null;
    stubs.myVault.error = new Error("My vault is unavailable");
    renderCell(LINEAR);
    expect(screen.getByRole("status").textContent).toBe("My vault is unavailable");
  });
});

describe("PluginServerSignIn: signing in", () => {
  it("signs in at the server's address into My vault, then rereads it and tells the host", async () => {
    const { onSignedIn } = renderCell(LINEAR);

    expect(screen.getByText("Not signed in")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to linear" }));

    expect(stubs.signIn.clearError).toHaveBeenCalledTimes(1);
    expect(stubs.signIn.signIn).toHaveBeenCalledWith(LINEAR_URL, { org: ORG });
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(LINEAR_URL));
    expect(stubs.myVault.refetch).toHaveBeenCalledTimes(1);
  });

  it("leaves Sign in with the reason when the sign-in fails", async () => {
    stubs.signIn.signIn = vi.fn(async () => {
      throw new Error("the sign-in window was closed");
    });
    const { onSignedIn, view } = renderCell(LINEAR);

    fireEvent.click(screen.getByRole("button", { name: "Sign in to linear" }));
    await waitFor(() => expect(stubs.signIn.signIn).toHaveBeenCalledTimes(1));
    stubs.signIn.error = new Error("the sign-in window was closed");
    view.rerender(<PluginServerSignIn org={ORG} server={LINEAR} onSignedIn={onSignedIn} />);

    expect(screen.getByRole("alert").textContent).toBe("the sign-in window was closed");
    expect(screen.getByRole("button", { name: "Sign in to linear" })).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(stubs.myVault.refetch).not.toHaveBeenCalled();
  });

  it("names the sign-in's phase on the busy button", () => {
    stubs.signIn.isInProgress = true;
    stubs.signIn.phase = "awaiting-callback";
    renderCell(LINEAR);

    const button = screen.getByRole("button", { name: "Sign in to linear" }) as HTMLButtonElement;
    expect(button.textContent).toBe("Waiting for sign-in…");
    expect(button.disabled).toBe(true);
    expect(screen.queryByText("Not signed in")).toBeNull();
  });

  it("labels every phase", () => {
    const labels: Record<VaultSignInPhase, string> = {
      idle: "Sign in",
      starting: "Starting sign-in…",
      "awaiting-callback": "Waiting for sign-in…",
      completing: "Completing sign-in…",
      done: "Sign in",
    };
    for (const [phase, label] of Object.entries(labels)) {
      expect(phaseLabel(phase as VaultSignInPhase)).toBe(label);
    }
  });
});

describe("PluginServerSignIn: signed in", () => {
  it("asks once before Sign out, and Cancel keeps the login", () => {
    stubs.myVault.vault = vaultWithLogins([LINEAR_URL]);
    renderCell(LINEAR);

    expect(screen.getByText("Signed in")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out of linear" }));
    expect(screen.getByText(/Sign out of linear\? Its login is removed from My vault\./)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Signed in")).toBeTruthy();
    expect(stubs.myVault.removeConnections).not.toHaveBeenCalled();
  });

  it("removes the login at the address on Sign out", async () => {
    stubs.myVault.vault = vaultWithLogins([LINEAR_URL]);
    renderCell(LINEAR);

    fireEvent.click(screen.getByRole("button", { name: "Sign out of linear" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(stubs.myVault.removeConnections).toHaveBeenCalledWith([LINEAR_URL]));
    // The question closes once the login is gone.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull());
  });

  it("shows a refused Sign out and keeps asking", async () => {
    stubs.myVault.vault = vaultWithLogins([LINEAR_URL]);
    stubs.myVault.removeConnections = vi.fn(async () => {
      throw new Error("My vault is read-only right now");
    });
    renderCell(LINEAR);

    fireEvent.click(screen.getByRole("button", { name: "Sign out of linear" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect((await screen.findByRole("alert")).textContent).toBe("My vault is read-only right now");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("reads Signed in without Sign out when the github.com login serves the server", () => {
    stubs.myVault.vault = vaultWithLogins(["github.com"]);
    renderCell(GITHUB);

    expect(screen.getByText("Signed in")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out of github" })).toBeNull();
  });
});

describe("PluginServerSignIn: servers that do not sign in", () => {
  it("names the keys a key-taking server reads", () => {
    renderCell(SEARCH);
    expect(screen.getByText("SEARCH_KEY, SEARCH_REGION")).toBeTruthy();
    expect(screen.getByText(/asked for when a/)).toBeTruthy();
  });

  it("renders nothing for an open server", () => {
    const { view } = renderCell(OPEN);
    expect(view.container.innerHTML).toBe("");
  });
});

describe("usePluginServerSignIn", () => {
  it("reads as loading and signs in nothing while held idle", () => {
    const noOrg = renderHook(() => usePluginServerSignIn(null, LINEAR));
    expect(noOrg.result.current.kind).toBe("loading");
    act(() => noOrg.result.current.signIn());
    expect(stubs.signIn.signIn).not.toHaveBeenCalled();

    const noServer = renderHook(() => usePluginServerSignIn(ORG, null));
    expect(noServer.result.current.kind).toBe("loading");
    expect(noServer.result.current.address).toBeNull();
  });

  it("signs out of nothing when no login is saved at the address", async () => {
    stubs.myVault.vault = vaultWithLogins(["github.com"]);
    const { result } = renderHook(() => usePluginServerSignIn(ORG, GITHUB));

    expect(result.current.kind).toBe("signed-in");
    expect(result.current.connection).toBeNull();
    await act(async () => {
      await result.current.signOut();
    });
    expect(stubs.myVault.removeConnections).not.toHaveBeenCalled();
  });
});
