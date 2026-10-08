/**
 * The composer's per-conversation vault choice and its one-time agent
 * values. With the vault picker enabled and an organization known, the
 * Configure menu offers a Vaults panel; vaults picked there ride the submit
 * as the conversation's `vaults`, and values an agent's setup kept for this
 * conversation ride it as the conversation's own secrets. A pick belongs to
 * its conversation: a composer kept mounted while the host moves to another
 * conversation (the desktop app) drops it. A conversation that lists vaults
 * hands them to the agent's setup and to the MCP servers' setup, whose pool
 * then leaves My vault's keys out (that conversation never reads My vault),
 * and a sign-in started from the MCP picker there is saved into the first
 * listed vault. The picker itself is
 * pinned in `vault/__tests__/vault-components.test.tsx` and stubbed here;
 * agent setup is driven directly (its own tests cover the state machine).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { ResourceRef, Stigmer } from "@stigmer/sdk";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { StigmerContext } from "../../context";
import { noMyVaultClient } from "../../__tests__/helpers/no-my-vault";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";

const mockAgentSetup = {
  state: {
    status: "ready",
    agentRef: { org: "acme", slug: "reviewer" },
    agentName: "Reviewer",
    resolution: { mode: "oneTime", values: { REVIEW_KEY: { value: "rk-1", isSecret: true } } },
  } as Record<string, unknown>,
  resolveAgent: vi.fn(),
  submitEnvVars: vi.fn(),
  reset: vi.fn(),
};
const agentSetupCalls: unknown[][] = [];
vi.mock("../../agent/useAgentSetup", () => ({
  useAgentSetup: (...args: unknown[]) => {
    agentSetupCalls.push(args);
    return mockAgentSetup;
  },
}));

const mcpSetupCalls: unknown[][] = [];
vi.mock("../../mcp-server/useMcpServerSetup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../mcp-server/useMcpServerSetup")>();
  return {
    ...actual,
    useMcpServerSetup: (...args: Parameters<typeof actual.useMcpServerSetup>) => {
      mcpSetupCalls.push(args);
      return actual.useMcpServerSetup(...args);
    },
  };
});

const pickerSignInVaults: unknown[] = [];
vi.mock("../../mcp-server/McpServerPicker.js", () => ({
  McpServerPicker: ({ setup }: { readonly setup?: { readonly signInVault?: unknown } }) => {
    pickerSignInVaults.push(setup?.signInVault);
    return <p>MCP picker</p>;
  },
}));

vi.mock("../../vault/VaultPicker.js", () => ({
  VaultPicker: ({ onChange }: { readonly onChange: (refs: ResourceRef[]) => void }) => (
    <button type="button" onClick={() => onChange([{ org: "acme", slug: "support-tools" }])}>
      Pick support-tools
    </button>
  ),
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
    run: { uploadAttachment: vi.fn() },
    vault: noMyVaultClient(),
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: {
      baseUrl: "http://localhost:8080",
      getAccessToken: vi.fn().mockResolvedValue(""),
    },
  } as unknown as Stigmer;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <StigmerContext.Provider value={createMinimalStigmerMock()}>
      <ModelRegistryContext.Provider
        value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}
      >
        {children}
      </ModelRegistryContext.Provider>
    </StigmerContext.Provider>
  );
}

afterEach(cleanup);

/** The shared vault the tests list. */
const supportTools = create(VaultSchema, {
  metadata: { id: "vlt_support", org: "org_acme", slug: "support-tools", name: "Support tools" },
  spec: { owner: { case: "org", value: "org_acme" } },
});

describe("SessionComposer — vaults and one-time agent values", () => {
  it("sends the vaults picked in the Vaults panel and the agent's one-time values", async () => {
    const onSubmit = vi.fn();
    render(
      <SessionComposer
        onSubmit={onSubmit}
        org="acme"
        agentRef={{ org: "acme", slug: "reviewer" }}
        onAgentRefChange={vi.fn()}
        onSkillRefsChange={vi.fn()}
        skillRefs={[]}
        enableVaultPicker
      />,
      { wrapper: Wrapper },
    );

    await openMenu(screen.getByRole("button", { name: "Configure agent, tools, and skills" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Vaults/ }));
    expect(await screen.findByText(/uses your own My/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick support-tools" }));

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Review this" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const context = onSubmit.mock.calls[0][2];
    expect(context?.vaults).toEqual([{ org: "acme", slug: "support-tools" }]);
    expect(context?.secrets).toEqual({ REVIEW_KEY: "rk-1" });
  });

  it("drops the vault pick when the host moves the mounted composer to another conversation", async () => {
    const onSubmit = vi.fn();
    const props = {
      onSubmit,
      org: "acme",
      agentRef: { org: "acme", slug: "reviewer" },
      onAgentRefChange: vi.fn(),
      onSkillRefsChange: vi.fn(),
      skillRefs: [],
      enableVaultPicker: true,
    };
    const { rerender } = render(<SessionComposer {...props} sessionId="ses_a" />, { wrapper: Wrapper });

    await openMenu(screen.getByRole("button", { name: "Configure agent, tools, and skills" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Vaults/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick support-tools" }));

    // Same conversation: the pick stays.
    rerender(<SessionComposer {...props} sessionId="ses_a" />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "First" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][2]?.vaults).toEqual([{ org: "acme", slug: "support-tools" }]);

    // Another conversation: nothing picked there, so no vaults ride the send.
    rerender(<SessionComposer {...props} sessionId="ses_b" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Second" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: false });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][2]?.vaults).toBeUndefined();
  });

  it("hands the listed vaults to the agent's setup, leaving My vault's keys out of its pool", async () => {
    const myVault = create(VaultSchema, {
      metadata: { id: "vlt_mine", org: "acme", name: "My vault" },
      spec: { owner: { case: "person", value: "ida_1" }, secrets: { MY_KEY: { value: "" } } },
    });
    const client = {
      ...createMinimalStigmerMock(),
      vault: { getMine: vi.fn().mockResolvedValue(myVault), getByReference: vi.fn().mockResolvedValue(supportTools) },
    } as unknown as Stigmer;
    function VaultWrapper({ children }: { children: ReactNode }) {
      return (
        <StigmerContext.Provider value={client}>
          <ModelRegistryContext.Provider value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}>
            {children}
          </ModelRegistryContext.Provider>
        </StigmerContext.Provider>
      );
    }
    const props = {
      onSubmit: vi.fn(),
      org: "acme",
      agentRef: { org: "acme", slug: "reviewer" },
      onAgentRefChange: vi.fn(),
      onSkillRefsChange: vi.fn(),
      skillRefs: [],
    };
    const poolKeysOfLastCall = () => agentSetupCalls.at(-1)?.[1] as ReadonlySet<string>;

    const { rerender } = render(<SessionComposer {...props} />, { wrapper: VaultWrapper });
    // No listed vaults: My vault's key is in the pool, so its read landed.
    await waitFor(() => expect(poolKeysOfLastCall().has("MY_KEY")).toBe(true));
    expect(agentSetupCalls.at(-1)?.[2]).toEqual([]);

    const listed = [{ org: "acme", slug: "support-tools" }];
    rerender(<SessionComposer {...props} initialVaultRefs={listed} />);
    expect(agentSetupCalls.at(-1)?.[2]).toEqual(listed);
    expect(poolKeysOfLastCall().has("MY_KEY")).toBe(false);
  });

  it("hands the listed vaults to the MCP servers' setup, leaving My vault's keys out of its pool", async () => {
    const myVault = create(VaultSchema, {
      metadata: { id: "vlt_mine", org: "acme", name: "My vault" },
      spec: { owner: { case: "person", value: "ida_1" }, secrets: { MY_KEY: { value: "" } } },
    });
    const client = {
      ...createMinimalStigmerMock(),
      vault: { getMine: vi.fn().mockResolvedValue(myVault), getByReference: vi.fn().mockResolvedValue(supportTools) },
    } as unknown as Stigmer;
    function VaultWrapper({ children }: { children: ReactNode }) {
      return (
        <StigmerContext.Provider value={client}>
          <ModelRegistryContext.Provider value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}>
            {children}
          </ModelRegistryContext.Provider>
        </StigmerContext.Provider>
      );
    }
    const props = {
      onSubmit: vi.fn(),
      org: "acme",
      onMcpServerUsagesChange: vi.fn(),
    };
    const poolKeysOfLastCall = () => mcpSetupCalls.at(-1)?.[1] as ReadonlySet<string>;

    const { rerender } = render(<SessionComposer {...props} />, { wrapper: VaultWrapper });
    // No listed vaults: My vault's key is in the pool, so its read landed.
    await waitFor(() => expect(poolKeysOfLastCall().has("MY_KEY")).toBe(true));
    expect(mcpSetupCalls.at(-1)?.[2]).toEqual([]);

    const listed = [{ org: "acme", slug: "support-tools" }];
    rerender(<SessionComposer {...props} initialVaultRefs={listed} />);
    expect(mcpSetupCalls.at(-1)?.[2]).toEqual(listed);
    expect(poolKeysOfLastCall().has("MY_KEY")).toBe(false);
  });

  it("saves a sign-in started from the MCP picker into the first listed vault, and into My vault when none is listed", async () => {
    const client = {
      ...createMinimalStigmerMock(),
      vault: { ...noMyVaultClient(), getByReference: vi.fn().mockResolvedValue(supportTools) },
    } as unknown as Stigmer;
    function VaultWrapper({ children }: { children: ReactNode }) {
      return (
        <StigmerContext.Provider value={client}>
          <ModelRegistryContext.Provider value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}>
            {children}
          </ModelRegistryContext.Provider>
        </StigmerContext.Provider>
      );
    }
    const props = { onSubmit: vi.fn(), org: "acme", onMcpServerUsagesChange: vi.fn() };

    const { rerender } = render(<SessionComposer {...props} />, { wrapper: VaultWrapper });
    await openMenu(screen.getByRole("button", { name: "Configure agent, tools, and skills" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /MCP Servers/ }));
    expect(await screen.findByText("MCP picker")).toBeTruthy();
    expect(pickerSignInVaults.at(-1)).toBeUndefined();

    rerender(<SessionComposer {...props} initialVaultRefs={[{ org: "acme", slug: "support-tools" }]} />);
    await waitFor(() =>
      expect(pickerSignInVaults.at(-1)).toEqual({ id: "vlt_support", org: "org_acme", name: "Support tools" }),
    );
  });
});
