/**
 * The composer's per-conversation vault choice: My vault, a tick, and the
 * shared vaults in order, which the conversation uses exactly. Pinned: the
 * Vaults panel's pick rides the submit as `includeMyVault` with `vaults`,
 * together, and an untouched picker sends neither; a pick belongs to its
 * conversation, so a composer kept mounted while the host moves to another
 * conversation (the desktop app) drops it; the agent's setup weighs the
 * conversation's choice, with only the platform's own keys as its pool.
 * Only a conversation's creator may change its vaults: a teammate sees the
 * pick read-only and nothing they save ticks it. For the creator, a typed
 * key saved in My vault (the agent's) and a sign-in landing in My vault
 * (from the Plugins panel's sign-in rows) tick My vault in a conversation
 * that left it out, so the next turn uses them, keeping the vaults it
 * lists. A teammate's saved key that the conversation still does not read keeps the
 * agent panel open on what is owed, committing nothing. The personal-keys
 * line shows only while My vault is included. The
 * picker itself is pinned in `vault/__tests__/vault-components.test.tsx`
 * and stubbed here; agent setup is driven directly (its own tests cover the
 * state machine).
 */
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ResourceRef, Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { noMyVaultClient } from "../../__tests__/helpers/no-my-vault";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ConversationVaults } from "../../vault/conversationVaults";
import type { VaultPickerMyVault } from "../../vault/VaultPicker";

const READY_STATE = {
  status: "ready",
  agentRef: { org: "acme", slug: "reviewer" },
  agentName: "Reviewer",
  resolution: { mode: "saved" },
};

const mockAgentSetup = {
  state: READY_STATE as Record<string, unknown>,
  resolveAgent: vi.fn(),
  submitEnvVars: vi.fn(),
  signInCompleted: vi.fn(),
  reset: vi.fn(),
};
const agentSetupCalls: unknown[][] = [];
vi.mock("../../agent/useAgentSetup", () => ({
  useAgentSetup: (...args: unknown[]) => {
    agentSetupCalls.push(args);
    return mockAgentSetup;
  },
}));

vi.mock("../../plugin/PluginPicker.js", () => ({
  PluginPicker: () => <p>Plugin picker</p>,
}));

vi.mock("../../plugin/PluginServerSignIns.js", () => ({
  PluginServerSignIns: ({ onSignedIn }: { readonly onSignedIn?: (address: string) => void }) => (
    <button type="button" onClick={() => onSignedIn?.("https://mcp.linear.app/mcp")}>
      Sign in to Linear
    </button>
  ),
}));

vi.mock("../PersonalKeyDisclosure.js", () => ({
  PersonalKeyDisclosure: () => <p>Personal keys line</p>,
}));

vi.mock("../../vault/VaultPicker.js", () => ({
  VaultPicker: ({
    onChange,
    myVault,
    disabled,
  }: {
    readonly onChange: (refs: ResourceRef[]) => void;
    readonly myVault?: VaultPickerMyVault;
    readonly disabled?: boolean;
  }) => (
    <div>
      <button type="button" disabled={disabled} onClick={() => onChange([{ org: "acme", slug: "support-tools" }])}>
        Pick support-tools
      </button>
      <button type="button" disabled={disabled} onClick={() => myVault?.onChange(!myVault.checked)}>
        {`My vault ${myVault?.checked ? "ticked" : "unticked"}`}
      </button>
    </div>
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

beforeEach(() => {
  mockAgentSetup.state = READY_STATE;
  mockAgentSetup.submitEnvVars.mockReset();
  agentSetupCalls.length = 0;
});

afterEach(cleanup);

/** A client whose signed-in person is `viewerId`, with no My vault yet. */
function client(viewerId = "ida_creator"): Stigmer {
  return {
    run: { uploadAttachment: vi.fn() },
    vault: noMyVaultClient(),
    identityAccount: { whoAmI: vi.fn().mockResolvedValue({ metadata: { id: viewerId } }) },
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: {
      baseUrl: "http://localhost:8080",
      getAccessToken: vi.fn().mockResolvedValue(""),
    },
  } as unknown as Stigmer;
}

function wrapperFor(stigmer: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={stigmer}>
        <ModelRegistryContext.Provider value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}>
          {children}
        </ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

const AGENT_PROPS = {
  org: "acme",
  agentRef: { org: "acme", slug: "reviewer" },
  onAgentRefChange: vi.fn(),
  onSkillRefsChange: vi.fn(),
  skillRefs: [],
  enableVaultPicker: true,
};

async function openPanel(name: RegExp) {
  await openMenu(screen.getByRole("button", { name: "Configure agent, tools, and skills" }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

async function send(onSubmit: ReturnType<typeof vi.fn>, message: string, calls = 1) {
  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: message } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(calls));
  return onSubmit.mock.calls[calls - 1][2] as { vaults?: ResourceRef[]; includeMyVault?: boolean } | undefined;
}

describe("SessionComposer — the conversation's vaults", () => {
  it("sends My vault and the shared vaults picked in the Vaults panel, together", async () => {
    const onSubmit = vi.fn();
    render(<SessionComposer onSubmit={onSubmit} {...AGENT_PROPS} />, { wrapper: wrapperFor(client()) });

    await openPanel(/Vaults/);
    expect(await screen.findByText("This conversation uses exactly these vaults, in order.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick support-tools" }));
    fireEvent.click(screen.getByRole("button", { name: "My vault ticked" }));

    const context = await send(onSubmit, "Review this");
    expect(context?.vaults).toEqual([{ org: "acme", slug: "support-tools" }]);
    expect(context?.includeMyVault).toBe(false);
  });

  it("sends no vault choice when the picker was not touched", async () => {
    const onSubmit = vi.fn();
    render(<SessionComposer onSubmit={onSubmit} {...AGENT_PROPS} initialVaultRefs={[{ org: "acme", slug: "support-tools" }]} />, {
      wrapper: wrapperFor(client()),
    });

    const context = await send(onSubmit, "Review this");
    expect(context).toBeUndefined();
  });

  it("drops the vault pick when the host moves the mounted composer to another conversation", async () => {
    const onSubmit = vi.fn();
    const props = { onSubmit, ...AGENT_PROPS, vaultPickCreatorId: "ida_creator" };
    const { rerender } = render(<SessionComposer {...props} sessionId="ses_a" />, { wrapper: wrapperFor(client()) });

    await openPanel(/Vaults/);
    const pick = await screen.findByRole("button", { name: "Pick support-tools" });
    await waitFor(() => expect((pick as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(pick);

    // Same conversation: the pick stays.
    rerender(<SessionComposer {...props} sessionId="ses_a" />);
    const first = await send(onSubmit, "First");
    expect(first?.vaults).toEqual([{ org: "acme", slug: "support-tools" }]);
    expect(first?.includeMyVault).toBe(true);

    // Another conversation: nothing picked there, so no vault choice rides the send.
    rerender(<SessionComposer {...props} sessionId="ses_b" />);
    const second = await send(onSubmit, "Second", 2);
    expect(second?.vaults).toBeUndefined();
    expect(second?.includeMyVault).toBeUndefined();
  });

  it("hands the conversation's vault choice to the agent's setup, with only the platform's keys as its pool", async () => {
    const props = { onSubmit: vi.fn(), ...AGENT_PROPS, onPluginRefsChange: vi.fn() };
    const { rerender } = render(<SessionComposer {...props} />, { wrapper: wrapperFor(client()) });
    expect(agentSetupCalls.at(-1)?.[2]).toEqual({ includeMyVault: true, vaults: [] } satisfies ConversationVaults);
    const pool = agentSetupCalls.at(-1)?.[1] as ReadonlySet<string>;
    expect(pool.has("STIGMER_SERVER_ADDRESS")).toBe(true);

    const listed = [{ org: "acme", slug: "support-tools" }];
    rerender(<SessionComposer {...props} initialIncludeMyVault={false} initialVaultRefs={listed} />);
    expect(agentSetupCalls.at(-1)?.[2]).toEqual({ includeMyVault: false, vaults: listed });
  });
});

describe("SessionComposer — who may change a conversation's vaults", () => {
  it("shows a teammate the pick read-only", async () => {
    render(
      <SessionComposer onSubmit={vi.fn()} {...AGENT_PROPS} sessionId="ses_a" vaultPickCreatorId="ida_creator" />,
      { wrapper: wrapperFor(client("ida_teammate")) },
    );

    await openPanel(/Vaults/);
    expect(await screen.findByText(/Only the person who started it can change them\./)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pick support-tools" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "My vault ticked" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets the conversation's creator change the pick", async () => {
    render(
      <SessionComposer onSubmit={vi.fn()} {...AGENT_PROPS} sessionId="ses_a" vaultPickCreatorId="ida_creator" />,
      { wrapper: wrapperFor(client("ida_creator")) },
    );

    await openPanel(/Vaults/);
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Pick support-tools" }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByText("This conversation uses exactly these vaults, in order.")).toBeTruthy();
  });
});

describe("SessionComposer — a key or sign-in saved in My vault includes My vault", () => {
  it("ticks My vault for the creator when a typed key is saved there", async () => {
    mockAgentSetup.state = {
      status: "needsEnvVars",
      agentRef: { org: "acme", slug: "reviewer" },
      agentName: "Reviewer",
      missingVariables: [{ key: "API_TOKEN", isSecret: true }],
      pendingSignIns: [],
    };
    mockAgentSetup.submitEnvVars.mockResolvedValue({
      status: "ready",
      agentRef: { org: "acme", slug: "reviewer" },
      agentName: "Reviewer",
      resolution: { mode: "saved" },
    });
    const onSubmit = vi.fn();
    render(<SessionComposer onSubmit={onSubmit} {...AGENT_PROPS} initialIncludeMyVault={false} />, {
      wrapper: wrapperFor(client()),
    });

    await openPanel(/Agent/);
    expect(await screen.findByText(/which this conversation does not use yet/)).toBeTruthy();
    // A secret field is a password input, which has no textbox role.
    const field = document.querySelector<HTMLInputElement>('input[type="password"]');
    if (field === null) throw new Error("the API_TOKEN field is not rendered");
    fireEvent.change(field, { target: { value: "t" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockAgentSetup.submitEnvVars).toHaveBeenCalledWith({
      API_TOKEN: { value: "t", isSecret: true },
    }));

    const context = await send(onSubmit, "Go");
    expect(context?.includeMyVault).toBe(true);
    expect(context?.vaults).toEqual([]);
  });

  it("ticks My vault for the creator when a sign-in from the Plugins panel lands", async () => {
    const onSubmit = vi.fn();
    render(
      <SessionComposer
        onSubmit={onSubmit}
        {...AGENT_PROPS}
        pluginRefs={[{ org: "acme", slug: "linear" }]}
        onPluginRefsChange={vi.fn()}
        initialIncludeMyVault={false}
        initialVaultRefs={[{ org: "acme", slug: "support-tools" }]}
      />,
      { wrapper: wrapperFor(client()) },
    );

    await openPanel(/Plugins/);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to Linear" }));

    const context = await send(onSubmit, "Go");
    expect(context?.includeMyVault).toBe(true);
    expect(context?.vaults).toEqual([{ org: "acme", slug: "support-tools" }]);
  });

  it("keeps the agent panel open on what is owed when a teammate's saved key is still not read", async () => {
    mockAgentSetup.state = {
      status: "needsEnvVars",
      agentRef: { org: "acme", slug: "reviewer" },
      agentName: "Reviewer",
      missingVariables: [{ key: "API_TOKEN", isSecret: true }],
      pendingSignIns: [],
    };
    mockAgentSetup.submitEnvVars.mockResolvedValue({
      status: "needsEnvVars",
      agentRef: { org: "acme", slug: "reviewer" },
      agentName: "Reviewer",
      missingVariables: [{ key: "API_TOKEN", isSecret: true }],
      pendingSignIns: [],
    });
    const onAgentResolutionChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <SessionComposer
        onSubmit={onSubmit}
        {...AGENT_PROPS}
        onAgentResolutionChange={onAgentResolutionChange}
        initialIncludeMyVault={false}
        sessionId="ses_a"
        vaultPickCreatorId="ida_creator"
      />,
      { wrapper: wrapperFor(client("ida_teammate")) },
    );

    await openPanel(/Agent/);
    expect(await screen.findByText(/Only the person who started it can change its vaults\./)).toBeTruthy();
    const field = document.querySelector<HTMLInputElement>('input[type="password"]');
    if (field === null) throw new Error("the API_TOKEN field is not rendered");
    fireEvent.change(field, { target: { value: "t" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockAgentSetup.submitEnvVars).toHaveBeenCalledTimes(1));

    expect(screen.getByText(/a tool that reads Signed in is signed in there/)).toBeTruthy();
    expect(onAgentResolutionChange).not.toHaveBeenCalled();
    const context = await send(onSubmit, "Go");
    expect(context).toBeUndefined();
  });

  it("ticks nothing for a teammate, who cannot change the conversation's vaults", async () => {
    const onSubmit = vi.fn();
    render(
      <SessionComposer
        onSubmit={onSubmit}
        {...AGENT_PROPS}
        pluginRefs={[{ org: "acme", slug: "linear" }]}
        onPluginRefsChange={vi.fn()}
        initialIncludeMyVault={false}
        sessionId="ses_a"
        vaultPickCreatorId="ida_creator"
      />,
      { wrapper: wrapperFor(client("ida_teammate")) },
    );

    await openPanel(/Plugins/);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to Linear" }));

    const context = await send(onSubmit, "Go");
    expect(context).toBeUndefined();
  });
});

describe("SessionComposer — the personal-keys line", () => {
  it("names the agent's keys only while the conversation includes My vault", async () => {
    const props = { onSubmit: vi.fn(), ...AGENT_PROPS, disclosePersonalKeys: true };
    const { rerender } = render(<SessionComposer {...props} />, { wrapper: wrapperFor(client()) });
    expect(screen.getByText("Personal keys line")).toBeTruthy();

    rerender(<SessionComposer {...props} initialIncludeMyVault={false} />);
    expect(screen.queryByText("Personal keys line")).toBeNull();
  });
});
