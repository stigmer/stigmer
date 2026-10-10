/**
 * The agent create gate asks the server's own bar, `can_create_agent` on
 * the organization, so a "Create agent" affordance shows to admins and to
 * members while the organization lets them, and to nobody else:
 *
 *   - nothing is asked, and nothing is allowed, while the organization is
 *     still loading;
 *   - the answer is the server's for that organization;
 *   - a refused viewer gets AgentCreationWizard's denied state, naming the
 *     setting an admin turns on, instead of a form whose create would fail;
 *   - while the answer is pending the wizard shows neither the form nor the
 *     refusal;
 *   - someone the server lets create an agent gets the wizard itself.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useCanCreateAgent } from "../useCanCreateAgent";
import { AgentCreationWizard } from "../AgentCreationWizard";

// The wizard's first step stands in for the form: these tests pin the gate
// in front of it, not the steps (pinned beside them).
vi.mock("../steps/IdentityStep.js", () => ({
  IdentityStep: () => <p>identity step</p>,
}));

type PermissionInput = {
  resource?: { kind: string; id: string };
  relation: string;
};

function createMockStigmer(allowed: boolean) {
  return {
    iamPolicy: {
      checkMyPermission: vi.fn(async (_input: PermissionInput) => ({ isAuthorized: allowed })),
    },
  };
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

afterEach(() => {
  cleanup();
});

describe("useCanCreateAgent", () => {
  it("allows nothing and asks nothing while the organization is loading", () => {
    const client = createMockStigmer(true);
    const { result } = renderHook(() => useCanCreateAgent(null), { wrapper: wrapper(client) });

    expect(result.current.allowed).toBe(false);
    expect(client.iamPolicy.checkMyPermission).not.toHaveBeenCalled();
  });

  it("asks can_create_agent on the organization and follows the answer", async () => {
    const client = createMockStigmer(false);
    const { result } = renderHook(() => useCanCreateAgent("org_acme"), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(false);
    const asked = client.iamPolicy.checkMyPermission.mock.calls[0]![0];
    expect(asked.relation).toBe("can_create_agent");
    expect(asked.resource).toMatchObject({ kind: "organization", id: "org_acme" });
  });

  it("allows an admin, or a member where the organization lets members create agents", async () => {
    const client = createMockStigmer(true);
    const { result } = renderHook(() => useCanCreateAgent("org_acme"), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.allowed).toBe(true));
  });
});

describe("AgentCreationWizard — someone who may not create agents", () => {
  it("says who can, and the setting that lets members, instead of the form", async () => {
    const client = createMockStigmer(false);
    const Wrapper = wrapper(client);
    render(
      <Wrapper>
        <AgentCreationWizard org="org_acme" onComplete={() => {}} onCancel={() => {}} />
      </Wrapper>,
    );

    expect(await screen.findByText("Only admins can create agents here")).toBeTruthy();
    expect(screen.getByText("Ask an admin to turn on 'Members can create agents'.")).toBeTruthy();
  });

  it("shows neither the form nor the refusal while the answer is pending", () => {
    const client = {
      iamPolicy: { checkMyPermission: vi.fn(() => new Promise<never>(() => {})) },
    };
    const Wrapper = wrapper(client);
    const { container } = render(
      <Wrapper>
        <AgentCreationWizard org="org_acme" onComplete={() => {}} onCancel={() => {}} />
      </Wrapper>,
    );

    expect(container.innerHTML).toBe("");
    expect(client.iamPolicy.checkMyPermission).toHaveBeenCalledTimes(1);
  });

  it("opens the wizard for someone the server lets create an agent", async () => {
    const Wrapper = wrapper(createMockStigmer(true));
    render(
      <Wrapper>
        <AgentCreationWizard org="org_acme" onComplete={() => {}} onCancel={() => {}} />
      </Wrapper>,
    );

    expect(await screen.findByText("identity step")).toBeTruthy();
    expect(screen.queryByText("Only admins can create agents here")).toBeNull();
  });
});
