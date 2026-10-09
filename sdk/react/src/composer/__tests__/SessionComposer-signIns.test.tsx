/**
 * The composer's Sign in rows and the bridge that commits an agent that
 * became ready without a handler awaiting it. Pins: an agent in
 * `needsEnvVars` with pending sign-ins renders one row per server under
 * "Sign-ins this agent needs" and no variable form while a sign-in is
 * pending, even with variables missing; the form returns once the
 * sign-ins are done; a `ready` state reached reactively (a sign-in landing,
 * the pool covering the keys) reports the agent's ref to the parent as well
 * as its resolution, which the imperative handlers did alone before. A
 * row's sign-in, saved in My vault, records the sign-in against the agent
 * and, in a conversation that leaves My vault out, ticks My vault for its
 * creator so the next turn reads the login. There, a note above the rows
 * says that a row reading Signed in is signed in to My vault, and its
 * Use My vault button includes My vault. The row itself is stubbed here;
 * its own rule is pinned in `plugin/__tests__`.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { StigmerContext } from "../../context";
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

vi.mock("../../plugin/McpServerReadiness.js", () => ({
  McpServerReadiness: ({ onSignedIn }: { readonly onSignedIn?: (mcpServerId: string) => void }) => (
    <button type="button" onClick={() => onSignedIn?.("mcp_linear")}>
      Sign in row
    </button>
  ),
}));

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
    run: { uploadAttachment: vi.fn() },
    vault: noMyVaultClient(),
    mcpServer: { getByReference: vi.fn().mockRejectedValue(new Error("no backend in this test")) },
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
const LINEAR = { ref: { org: "acme", slug: "linear" }, id: "mcp_linear", name: "Linear", health: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT };

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
      error: null,
    };
    const onSubmit = vi.fn();
    renderComposer({ initialAgentRef: AGENT_REF, onSubmit, enableVaultPicker: true, initialIncludeMyVault: false });

    expect(await screen.findByText(/which this conversation does not use yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in row" }));
    expect(mockAgentSetup.signInCompleted).toHaveBeenCalledWith("mcp_linear");

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Go" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][2]).toMatchObject({ includeMyVault: true, vaults: [] });
  });
});
