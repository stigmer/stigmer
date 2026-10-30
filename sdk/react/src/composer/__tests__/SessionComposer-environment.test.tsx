/**
 * The composer's Environment entry, for a new conversation's first message:
 * - offered only when the host enables it (the flow decides where it
 *   applies: `useNewSessionFlow.environment.test.tsx`);
 * - the menu says which Environment applies and why, in the shared words:
 *   the agent's default, else the organization's, else none, and the
 *   person's own pick once made, which counts 1;
 * - the panel's picker starts at the inherited row, named as the person
 *   knows it;
 * - the pick rides the submit as `environmentRef`, and an untouched entry
 *   sends no context at all.
 * The picker itself is pinned in `environment/__tests__/EnvironmentPicker.test.tsx`
 * and stubbed here, as is the agent's setup.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ResourceRef, Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { noMyVaultClient } from "../../__tests__/helpers/no-my-vault";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";

vi.mock("../../agent/useAgentSetup", () => ({
  useAgentSetup: () => ({
    state: { status: "ready", agentRef: { org: "acme", slug: "analyst" }, agentName: "Analyst", resolution: { mode: "saved" } },
    resolveAgent: vi.fn(),
    submitEnvVars: vi.fn(),
    signInCompleted: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("../PersonalKeyDisclosure.js", () => ({
  PersonalKeyDisclosure: () => null,
}));

vi.mock("../../environment/useEnvironmentList.js", () => ({
  useEnvironmentList: () => ({
    environments: [
      { metadata: { org: "acme", slug: "data-science", name: "Data science" } },
      { metadata: { org: "acme", slug: "base-tools", name: "" } },
    ],
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  environmentName: (environment: { metadata?: { name?: string; slug?: string } }) =>
    environment.metadata?.name || environment.metadata?.slug || "",
}));

vi.mock("../../environment/EnvironmentPicker.js", () => ({
  EnvironmentPicker: ({
    onChange,
    defaultLabel,
  }: {
    readonly onChange: (ref: ResourceRef | undefined) => void;
    readonly defaultLabel?: string;
  }) => (
    <div>
      <p>{`First row: ${defaultLabel}`}</p>
      <button type="button" onClick={() => onChange({ org: "acme", slug: "base-tools" })}>
        Pick base-tools
      </button>
    </div>
  ),
}));

import { SessionComposer } from "../SessionComposer";
import { RunSettingsIcon } from "../icons";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(cleanup);

function client(): Stigmer {
  return {
    file: { uploadFile: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
    vault: noMyVaultClient(),
    identityAccount: { whoAmI: vi.fn().mockResolvedValue({ metadata: { id: "ida_me" } }) },
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: { baseUrl: "http://localhost:8080", getAccessToken: vi.fn().mockResolvedValue("") },
  } as unknown as Stigmer;
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <StigmerContext.Provider value={client()}>
      <ModelRegistryContext.Provider value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}>
        {children}
      </ModelRegistryContext.Provider>
    </StigmerContext.Provider>
  );
}

const PROPS = {
  org: "acme",
  agentRef: { org: "acme", slug: "analyst" },
  onAgentRefChange: vi.fn(),
  onSkillRefsChange: vi.fn(),
  skillRefs: [],
};

async function openConfigure() {
  await openMenu(screen.getByRole("button", { name: "Configure agent, tools, and skills" }));
}

async function send(onSubmit: ReturnType<typeof vi.fn>, message: string) {
  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: message } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return onSubmit.mock.calls[0]![2] as { environmentRef?: ResourceRef } | undefined;
}

describe("SessionComposer — the new conversation's Environment", () => {
  it("offers no entry unless the host enables it", async () => {
    render(<SessionComposer onSubmit={vi.fn()} {...PROPS} />, { wrapper: Providers });
    await openConfigure();
    expect(screen.queryByRole("menuitem", { name: /Environment/ })).toBeNull();
  });

  it("says the agent's default applies, by the name the person knows it by", async () => {
    render(
      <SessionComposer
        onSubmit={vi.fn()}
        {...PROPS}
        enableEnvironmentPicker
        environmentDefaults={{ agent: { org: "acme", slug: "data-science" }, organization: { org: "acme", slug: "base-tools" } }}
      />,
      { wrapper: Providers },
    );
    await openConfigure();
    const item = screen.getByRole("menuitem", { name: /Environment/ });
    expect(item.textContent).toContain("Data science · the agent's default");
    fireEvent.click(item);
    expect(screen.getByText("First row: Default: Data science (the agent's default)")).toBeTruthy();
  });

  it("falls back to the organization's default, then to none", async () => {
    const { rerender } = render(
      <SessionComposer
        onSubmit={vi.fn()}
        {...PROPS}
        enableEnvironmentPicker
        environmentDefaults={{ organization: { org: "acme", slug: "base-tools" } }}
      />,
      { wrapper: Providers },
    );
    await openConfigure();
    expect(screen.getByRole("menuitem", { name: /Environment/ }).textContent).toContain(
      "base-tools · the organization's default",
    );
    rerender(<SessionComposer onSubmit={vi.fn()} {...PROPS} enableEnvironmentPicker environmentDefaults={{}} />);
    expect(screen.getByRole("menuitem", { name: /Environment/ }).textContent).toContain(
      "No environment: the server's standard sandbox",
    );
  });

  it("sends the person's pick, says it was chosen for this conversation, and counts it", async () => {
    const onSubmit = vi.fn();
    render(
      <SessionComposer
        onSubmit={onSubmit}
        {...PROPS}
        enableEnvironmentPicker
        environmentDefaults={{ agent: { org: "acme", slug: "data-science" } }}
      />,
      { wrapper: Providers },
    );
    await openConfigure();
    fireEvent.click(screen.getByRole("menuitem", { name: /Environment/ }));
    fireEvent.click(screen.getByRole("button", { name: "Pick base-tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to configuration menu" }));
    const item = screen.getByRole("menuitem", { name: /Environment/ });
    expect(item.textContent).toContain("base-tools · chosen for this conversation");
    expect(item.textContent).toContain("1");

    const context = await send(onSubmit, "Train it");
    expect(context?.environmentRef).toEqual({ org: "acme", slug: "base-tools" });
  });

  it("sends no context when the entry was not touched", async () => {
    const onSubmit = vi.fn();
    render(
      <SessionComposer
        onSubmit={onSubmit}
        {...PROPS}
        enableEnvironmentPicker
        environmentDefaults={{ agent: { org: "acme", slug: "data-science" } }}
      />,
      { wrapper: Providers },
    );
    expect(await send(onSubmit, "Train it")).toBeUndefined();
  });
});

describe("SessionComposer — rows the host adds to the configure menu", () => {
  it("lists a host's row after its own, with its detail, and opens the host's panel", async () => {
    render(
      <SessionComposer
        onSubmit={vi.fn()}
        {...PROPS}
        extraSettings={[
          {
            item: { id: "run-settings", icon: <RunSettingsIcon />, label: "Run settings", count: 1, detail: "Stigmer · Cloud" },
            panel: <p>How the next turn runs</p>,
          },
        ]}
      />,
      { wrapper: Providers },
    );
    await openConfigure();
    const row = screen.getByRole("menuitem", { name: /Run settings/ });
    expect(row.textContent).toContain("Stigmer · Cloud");
    fireEvent.click(row);
    expect(await screen.findByText("How the next turn runs")).toBeTruthy();
  });
});
