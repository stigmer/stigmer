import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
  resolveToInstance: vi.fn(),
  submitEnvVars: vi.fn(),
  reset: vi.fn(),
};
vi.mock("../../agent/useAgentSetup", () => ({
  useAgentSetup: () => mockAgentSetup,
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

/**
 * Opens the composer's Configure menu and resolves once the portaled menu
 * content mounts. Menu items render asynchronously in a portal, so a
 * synchronous item query straight after the click races the mount (the
 * openRowMenu idiom; see stigmer/stigmer#323).
 */
async function openConfigureMenu() {
  fireEvent.click(
    screen.getByRole("button", { name: "Configure agent, tools, and skills" }),
  );
  await screen.findByRole("menu");
}

beforeEach(() => {
  mockAgentSetup.state = { status: "idle" };
});

afterEach(cleanup);

describe("SessionComposer — lockAgent", () => {
  it("shows the Agent entry in the Configure menu by default", async () => {
    renderComposer();
    await openConfigureMenu();

    expect(screen.getByRole("menuitem", { name: /Agent/ })).toBeTruthy();
  });

  it("hides the Agent entry when locked, leaving other entries intact", async () => {
    renderComposer({
      lockAgent: true,
      agentRef: { org: "acme", slug: "support-bot" },
    });
    await openConfigureMenu();

    expect(screen.queryByRole("menuitem", { name: /Agent/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Skills/ })).toBeTruthy();
  });

  it("keeps the Agent entry reachable while a locked agent needs env vars", async () => {
    // A pinned agent that requires credentials: resolution is pending and
    // the env form lives in the Configure > Agent panel — lock ≠ unwire.
    mockAgentSetup.state = {
      status: "needsEnvVars",
      agentName: "Support Bot",
      agentRef: { org: "acme", slug: "support-bot" },
      missingVariables: [{ key: "API_KEY", isSecret: true }],
      error: null,
    };
    renderComposer({ lockAgent: true });

    // The composer surfaces the pending setup both as a warning banner...
    expect(screen.getByText("Agent needs configuration before use")).toBeTruthy();

    // ...and as a (warning-marked) Configure menu entry, despite the lock.
    await openConfigureMenu();
    expect(screen.getByRole("menuitem", { name: /Agent/ })).toBeTruthy();
  });

  it("removes the Agent entry once the locked agent has resolved", async () => {
    mockAgentSetup.state = { status: "idle" };
    renderComposer({
      lockAgent: true,
      agentRef: { org: "acme", slug: "support-bot" },
    });

    expect(screen.queryByText("Agent needs configuration before use")).toBeNull();
    await openConfigureMenu();
    expect(screen.queryByRole("menuitem", { name: /Agent/ })).toBeNull();
  });
});
