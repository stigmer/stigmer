/**
 * The composer's Sign in rows and the bridge that commits an agent that
 * became ready without a handler awaiting it. Pins: an agent in
 * `needsEnvVars` with pending sign-ins renders one row per server under
 * "Sign-ins this agent needs" and no variable form while a sign-in is
 * pending, even with variables missing; the form returns once the
 * sign-ins are done; a `ready` state reached reactively (a sign-in landing,
 * the pool covering the keys) reports the agent's ref to the parent as well
 * as its resolution, which the imperative handlers did alone before.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";

vi.mock("../../portal-container", () => ({
  useStigmerPortalContainer: () => document.body,
}));

const mockAgentSetup = {
  state: { status: "idle", error: null } as Record<string, unknown>,
  resolveAgent: vi.fn(),
  resolveToInstance: vi.fn(),
  submitEnvVars: vi.fn(),
  signInCompleted: vi.fn(),
  reset: vi.fn(),
};
vi.mock("../../agent/useAgentSetup", () => ({
  useAgentSetup: () => mockAgentSetup,
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
    agentExecution: { uploadAttachment: vi.fn() },
    environment: { getPersonal: vi.fn().mockResolvedValue(null) },
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
    expect(screen.getByText(/uses tools nobody in this organization has signed in to yet/)).toBeTruthy();
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
});
