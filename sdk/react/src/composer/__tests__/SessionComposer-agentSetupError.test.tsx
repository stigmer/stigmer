import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";

// Without a StigmerProvider the portal container is null, and Base UI's
// Portal renders nothing — pin it to document.body so popovers can mount.
vi.mock("../../portal-container", () => ({
  useStigmerPortalContainer: () => document.body,
}));

// Controllable agent-setup state — these tests drive the error slot directly
// instead of exercising the full resolution state machine (covered by
// useAgentSetup's own tests).
const mockAgentSetup = {
  state: { status: "idle", error: null } as Record<string, unknown>,
  resolveAgent: vi.fn(),
  resolveToInstance: vi.fn(),
  submitEnvVars: vi.fn(),
  reset: vi.fn(),
};
vi.mock("../../agent/useAgentSetup", () => ({
  useAgentSetup: () => mockAgentSetup,
}));

import { SessionComposer } from "../SessionComposer";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
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
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: {
      baseUrl: "http://localhost:8080",
      getAccessToken: vi.fn().mockResolvedValue(""),
    },
  } as unknown as Stigmer;
}

function createWrapper(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <ModelRegistryContext.Provider
          value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}
        >
          {children}
        </ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

function renderComposer(
  props?: Partial<React.ComponentProps<typeof SessionComposer>>,
) {
  const client = createMinimalStigmerMock();
  return render(
    <SessionComposer
      onSubmit={vi.fn()}
      org="acme"
      agentRef={null}
      onAgentRefChange={vi.fn()}
      onSkillRefsChange={vi.fn()}
      skillRefs={[]}
      {...props}
    />,
    { wrapper: createWrapper(client) },
  );
}

beforeEach(() => {
  mockAgentSetup.state = { status: "idle", error: null };
});

afterEach(cleanup);

/**
 * The agent setup error's OUTBOUND bridge. The error is otherwise rendered
 * only inside the Configure popover's agent panel — which a locked,
 * end-user-facing embed never opens — and onAgentResolutionChange fires only
 * on success. Without this callback, a failed mount-time resolution of
 * initialAgentRef is invisible to the parent, and any parent gate waiting on
 * the resolution holds forever (the "dead launcher pane" class).
 */
describe("SessionComposer — onAgentSetupErrorChange", () => {
  it("reports the setup error to the parent", () => {
    const onError = vi.fn();
    const failure = new Error("agent lookup timed out");
    mockAgentSetup.state = { status: "idle", error: failure };

    renderComposer({ onAgentSetupErrorChange: onError });

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("reports null when no error is present (and when it clears)", () => {
    const onError = vi.fn();
    renderComposer({ onAgentSetupErrorChange: onError });

    expect(onError).toHaveBeenCalledWith(null);
    expect(onError).not.toHaveBeenCalledWith(expect.any(Error));
  });

  it("renders normally when the callback is not provided", () => {
    mockAgentSetup.state = { status: "idle", error: new Error("boom") };

    expect(() => renderComposer()).not.toThrow();
  });
});
