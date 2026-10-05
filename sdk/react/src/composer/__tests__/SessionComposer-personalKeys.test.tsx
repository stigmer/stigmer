/**
 * The composer's personal-key line: rendered only when the host asks for
 * it (disclosePersonalKeys) and both an agent and the conversation's
 * organization are known, and handed the agent, the organization (the
 * run's, whose agents alone read the person's keys) and the pinned
 * version the host names.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";

// Controllable agent-setup state — lets these tests drive the lock × setup
// matrix directly instead of exercising the full resolution state machine
// (which is covered by useAgentSetup's own tests).
const mockAgentSetup = {
  state: { status: "idle" } as Record<string, unknown>,
  resolveAgent: vi.fn(),
  submitEnvVars: vi.fn(),
  reset: vi.fn(),
};
vi.mock("../../agent/useAgentSetup", () => ({
  useAgentSetup: () => mockAgentSetup,
}));

// The disclosure itself is pinned by PersonalKeyDisclosure.test.tsx; here
// only what the composer hands it, and when it renders it at all.
const disclosureProps: Array<Record<string, unknown>> = [];
vi.mock("../PersonalKeyDisclosure.js", () => ({
  PersonalKeyDisclosure: (props: Record<string, unknown>) => {
    disclosureProps.push(props);
    return <p data-testid="personal-key-disclosure" />;
  },
}));

import { SessionComposer } from "../SessionComposer";

// Base UI's Popover positioner observes its anchor; happy-dom lacks
// ResizeObserver, so provide a no-op shim.
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
      org="org_acme"
      agentRef={{ org: "org_acme", slug: "reviewer" }}
      onAgentRefChange={vi.fn()}
      onSkillRefsChange={vi.fn()}
      skillRefs={[]}
      {...props}
    />,
    { wrapper: createWrapper(client) },
  );
}

beforeEach(() => {
  disclosureProps.length = 0;
});

afterEach(cleanup);

describe("SessionComposer's personal-key line", () => {
  it("hands the disclosure the agent, the conversation's organization and the pinned version", () => {
    renderComposer({ disclosePersonalKeys: true, personalKeysVersionHash: "h_pinned" });

    expect(screen.getByTestId("personal-key-disclosure")).toBeTruthy();
    expect(disclosureProps.at(-1)).toMatchObject({
      agentRef: { org: "org_acme", slug: "reviewer" },
      runOrg: "org_acme",
      versionHash: "h_pinned",
    });
  });

  it("renders nothing unless asked, and nothing without an agent or an organization", () => {
    renderComposer();
    expect(screen.queryByTestId("personal-key-disclosure")).toBeNull();
    cleanup();

    renderComposer({ disclosePersonalKeys: true, agentRef: null });
    expect(screen.queryByTestId("personal-key-disclosure")).toBeNull();
    cleanup();

    renderComposer({ disclosePersonalKeys: true, org: undefined });
    expect(screen.queryByTestId("personal-key-disclosure")).toBeNull();
    expect(disclosureProps).toEqual([]);
  });
});
