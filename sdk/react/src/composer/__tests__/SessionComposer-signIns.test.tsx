/**
 * The composer's Sign in rows and the bridge that commits an agent that
 * became ready without a handler awaiting it. Pins: an agent in
 * `needsEnvVars` with pending sign-ins renders one row per plugin server under
 * "Sign-ins this agent needs" and no variable form while a sign-in is
 * pending, even with variables missing; the form returns once the
 * sign-ins are done; a `ready` state reached reactively (a sign-in landing,
 * the pool covering the keys) reports the agent's ref to the parent as well
 * as its resolution, which the imperative handlers did alone before.
 *
 * Where the rows save, by the state's `signInVaults`:
 * - `my-vault`: a row's sign-in, saved in My vault, records the sign-in
 *   against the agent and, in a conversation that leaves My vault out,
 *   ticks My vault for its creator so the next turn reads the login.
 *   There, a note above the rows says that a row reading Signed in is
 *   signed in to My vault, and its Use My vault button includes My vault.
 * - `shared`: the heading names the vault the sign-ins are saved to, each
 *   row saves there and records the sign-in without ticking My vault, the
 *   My vault note never shows (including My vault would not help), and two
 *   or more vaults bring one select above the rows, the first chosen.
 * - `nowhere`: no row can sign in; the heading says who can (someone who
 *   can edit a listed vault) or, with none listed, what would help.
 * Neither foreign kind draws the My vault row, so no "Signed in" from My
 * vault can show on a run that never reads it. The rows themselves are
 * stubbed here; the My vault row's rule is pinned in `plugin/__tests__`,
 * the shared row's in `SharedVaultSignIn.test.tsx`.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { create } from "@bufbuild/protobuf";
import { McpServerEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { StigmerContext } from "@stigmer/react-core";
import { noMyVaultClient } from "../../__tests__/helpers/no-my-vault";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";

vi.mock("../../portal-container", () => ({
  useStigmerPortalContainer: () => document.body,
}));

const mockAgentSetup = {
  state: { status: "idle", error: null } as Record<string, unknown>,
  resolveAgent: vi.fn(),
  submitEnvVars: vi.fn(),
  signInCompleted: vi.fn(),
  reset: vi.fn(),
};
vi.mock("../../agent/useAgentSetup", () => ({
  useAgentSetup: () => mockAgentSetup,
}));

vi.mock("../../plugin/PluginServerSignIn.js", () => ({
  PluginServerSignIn: ({ onSignedIn }: { readonly onSignedIn?: (address: string) => void }) => (
    <button type="button" onClick={() => onSignedIn?.(LINEAR_ADDRESS)}>
      Sign in row
    </button>
  ),
}));

vi.mock("../SharedVaultSignIn.js", () => ({
  SharedVaultSignIn: ({
    signIn,
    vault,
    onSignedIn,
  }: {
    readonly signIn: { readonly name: string; readonly address: string };
    readonly vault: { readonly id: string };
    readonly onSignedIn: (address: string) => void;
  }) => (
    <button type="button" onClick={() => onSignedIn(signIn.address)}>
      {`Sign in to ${signIn.name} into ${vault.id}`}
    </button>
  ),
}));

const LINEAR_ADDRESS = "https://mcp.linear.app/mcp";

import { SessionComposer } from "../SessionComposer";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function createMinimalStigmerMock(): Stigmer {
  return {
    file: { uploadFile: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
    vault: noMyVaultClient(),
    plugin: { getByReference: vi.fn().mockRejectedValue(new Error("no backend in this test")) },
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: { baseUrl: "http://localhost:8080", getAccessToken: vi.fn().mockResolvedValue("") },
  } as unknown as Stigmer;
}

function createWrapper(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <ModelRegistryContext.Provider value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}>{children}</ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

const AGENT_REF = { org: "acme", slug: "reviewer" };
const LINEAR = {
  plugin: { org: "acme", slug: "linear" },
  pluginName: "linear",
  server: create(McpServerEntrySchema, { name: "linear", transport: { case: "http", value: { url: LINEAR_ADDRESS } }, signIn: {} }),
  address: LINEAR_ADDRESS,
  name: "Linear",
};

function renderComposer(props?: Partial<React.ComponentProps<typeof SessionComposer>>) {
  return render(
    <SessionComposer onSubmit={vi.fn()} org="acme" agentRef={null} onAgentRefChange={vi.fn()} onSkillRefsChange={vi.fn()} skillRefs={[]} {...props} />,
    { wrapper: createWrapper(createMinimalStigmerMock()) },
  );
}

beforeEach(() => {
  mockAgentSetup.state = { status: "idle", error: null };
});

afterEach(cleanup);

describe("SessionComposer — the agent's sign-ins", () => {
  it("lists the servers to sign in to and holds the variable form until they are done", async () => {
    mockAgentSetup.state = {
      status: "needsEnvVars",
      agentRef: AGENT_REF,
      agentId: "agt_1",
      agentName: "Reviewer",
      missingVariables: [{ key: "API_TOKEN", isSecret: true, optional: false }],
      pendingSignIns: [LINEAR],
      signInVaults: { kind: "my-vault" },
      error: null,
    };
    renderComposer({ initialAgentRef: AGENT_REF });

    const list = await screen.findByRole("list", { name: "Sign-ins this agent needs" });
    expect(list.textContent).toContain("Linear");
    expect(screen.getByText(/uses tools you have not signed in to yet/)).toBeTruthy();
    expect(screen.queryByText(/Enter required credentials/)).toBeNull();
  });

  it("shows the variable form once no sign-in is pending", async () => {
    mockAgentSetup.state = {
      status: "needsEnvVars",
      agentRef: AGENT_REF,
      agentId: "agt_1",
      agentName: "Reviewer",
      missingVariables: [{ key: "API_TOKEN", isSecret: true, optional: false }],
      pendingSignIns: [],
      signInVaults: { kind: "my-vault" },
      error: null,
    };
    renderComposer({ initialAgentRef: AGENT_REF });
    expect(await screen.findByText(/Enter required credentials/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Sign-ins this agent needs" })).toBeNull();
  });

  it("commits a reactively ready agent's ref to the parent, beside its resolution", () => {
    const onAgentRefChange = vi.fn();
    const onAgentResolutionChange = vi.fn();
    mockAgentSetup.state = { status: "ready", agentRef: AGENT_REF, agentName: "Reviewer", resolution: { mode: "direct" }, error: null };
    renderComposer({ onAgentRefChange, onAgentResolutionChange });
    expect(onAgentRefChange).toHaveBeenCalledWith(AGENT_REF);
    expect(onAgentResolutionChange).toHaveBeenCalledWith({ mode: "direct" });
  });

  it("explains a Signed in row in a conversation that leaves My vault out, and Use My vault includes it", async () => {
    mockAgentSetup.state = {
      status: "needsEnvVars",
      agentRef: AGENT_REF,
      agentId: "agt_1",
      agentName: "Reviewer",
      missingVariables: [],
      pendingSignIns: [LINEAR],
      signInVaults: { kind: "my-vault" },
      error: null,
    };
    const onSubmit = vi.fn();
    renderComposer({ initialAgentRef: AGENT_REF, onSubmit, enableVaultPicker: true, initialIncludeMyVault: false });

    expect(await screen.findByText(/a tool that reads Signed in is signed in there/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use My vault" }));

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Go" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][2]).toMatchObject({ includeMyVault: true, vaults: [] });
  });

  it("records a row's sign-in and ticks My vault in a conversation that left it out", async () => {
    mockAgentSetup.state = {
      status: "needsEnvVars",
      agentRef: AGENT_REF,
      agentId: "agt_1",
      agentName: "Reviewer",
      missingVariables: [],
      pendingSignIns: [LINEAR],
      signInVaults: { kind: "my-vault" },
      error: null,
    };
    const onSubmit = vi.fn();
    renderComposer({ initialAgentRef: AGENT_REF, onSubmit, enableVaultPicker: true, initialIncludeMyVault: false });

    expect(await screen.findByText(/which this conversation does not use yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in row" }));
    expect(mockAgentSetup.signInCompleted).toHaveBeenCalledWith(LINEAR_ADDRESS);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Go" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][2]).toMatchObject({ includeMyVault: true, vaults: [] });
  });
});

const TEAM = { org: "acme", id: "vlt_team", name: "Team logins" };
const OPS = { org: "acme", id: "vlt_ops", name: "Ops" };

/** An agent waiting on Linear's sign-in, which it may save only where `signInVaults` says. */
function waitingOnLinear(signInVaults: Record<string, unknown>) {
  mockAgentSetup.state = {
    status: "needsEnvVars",
    agentRef: AGENT_REF,
    agentId: "agt_1",
    agentName: "Reviewer",
    missingVariables: [],
    pendingSignIns: [LINEAR],
    signInVaults,
    error: null,
  };
}

describe("SessionComposer — sign-ins for a run that never reads My vault", () => {
  it("names the shared vault the sign-ins go to, signs in there, and never ticks My vault", async () => {
    waitingOnLinear({ kind: "shared", vaults: [TEAM] });
    const onSubmit = vi.fn();
    renderComposer({ initialAgentRef: AGENT_REF, onSubmit, enableVaultPicker: true, initialIncludeMyVault: false });

    expect(await screen.findByText("Reviewer needs you to sign in to these tools. Sign-ins are saved to Team logins.")).toBeTruthy();
    expect(screen.queryByText(/uses tools you have not signed in to yet/)).toBeNull();
    expect(screen.queryByText(/Keys and sign-ins are saved in My vault/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Use My vault" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in row" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sign in to Linear into vlt_team" }));
    expect(mockAgentSetup.signInCompleted).toHaveBeenCalledWith(LINEAR_ADDRESS);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Go" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][2]).toMatchObject({ includeMyVault: false });
  });

  it("chooses among several editable vaults with one select, the first chosen", async () => {
    waitingOnLinear({ kind: "shared", vaults: [TEAM, OPS] });
    renderComposer({ initialAgentRef: AGENT_REF });

    const select = (await screen.findByRole("combobox", { name: "Vault for these sign-ins" })) as HTMLSelectElement;
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(select.value).toBe("vlt_team");
    expect(screen.getByRole("button", { name: "Sign in to Linear into vlt_team" })).toBeTruthy();

    fireEvent.change(select, { target: { value: "vlt_ops" } });
    expect(screen.getByText("Reviewer needs you to sign in to these tools. Sign-ins are saved to Ops.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in to Linear into vlt_ops" })).toBeTruthy();
  });

  it("offers no sign-in when the person may edit no listed vault, and says who can", async () => {
    waitingOnLinear({ kind: "nowhere", listed: [TEAM, OPS] });
    renderComposer({ initialAgentRef: AGENT_REF, enableVaultPicker: true, initialIncludeMyVault: false });

    expect(
      await screen.findByText(
        "Reviewer's conversations never use your personal vault. Someone who can edit Team logins or Ops needs to sign in to these tools there.",
      ),
    ).toBeTruthy();
    const list = screen.getByRole("list", { name: "Sign-ins this agent needs" });
    expect(list.textContent).toContain("Linear");
    expect(list.querySelector("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in row" })).toBeNull();
    expect(screen.queryByText(/Keys and sign-ins are saved in My vault/)).toBeNull();
  });

  it("asks for a shared vault holding the sign-ins when the conversation lists none", async () => {
    waitingOnLinear({ kind: "nowhere", listed: [] });
    renderComposer({ initialAgentRef: AGENT_REF });

    expect(
      await screen.findByText(
        "Reviewer's conversations never use your personal vault. Add a shared vault that holds these sign-ins to this conversation.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in row" })).toBeNull();
  });
});
