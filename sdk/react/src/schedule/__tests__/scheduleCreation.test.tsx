import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelInfo } from "../../models/registry";
import { useCreateSchedule } from "../useCreateSchedule";
import { CadenceField } from "../CadenceField";
import { ScheduleForm } from "../ScheduleForm";
import { VaultPicker } from "../../vault/VaultPicker";
import type { CadencePreset } from "../cadence";

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

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

const CREATED = create(ScheduleSchema, {
  metadata: {
    id: "sch_01new",
    name: "daily-fee-reminders",
    slug: "daily-fee-reminders",
    org: "isc",
  },
  spec: { cron: "0 9 * * *", timeZone: "Asia/Kolkata", enabled: false },
});

const AGENT_RESULT = {
  id: "agt_01example",
  org: "isc",
  slug: "fee-reminder",
  name: "Fee Reminder",
  description: "Sends fee reminders.",
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// ---------------------------------------------------------------------------
// useCreateSchedule
// ---------------------------------------------------------------------------

describe("useCreateSchedule", () => {
  it("applies the input and returns the created schedule", async () => {
    const apply = vi.fn().mockResolvedValue(CREATED);
    const client = { schedule: { apply } };

    const { result } = renderHook(() => useCreateSchedule(), {
      wrapper: wrapper(client),
    });

    const input = {
      name: "daily-fee-reminders",
      org: "isc",
      cron: "0 9 * * *",
      timeZone: "Asia/Kolkata",
      enabled: false,
      agent: {
        agentRef: { org: "isc", slug: "fee-reminder" },
        message: "Send today's reminders.",
      },
    };

    let returned: unknown;
    await act(async () => {
      returned = await result.current.create(input);
    });

    expect(apply).toHaveBeenCalledWith(input);
    expect(returned).toBe(CREATED);
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("captures the error, rethrows, and clears via clearError", async () => {
    const failure = new Error("agent 'isc/fee-reminder' not found");
    const apply = vi.fn().mockRejectedValue(failure);
    const client = { schedule: { apply } };

    const { result } = renderHook(() => useCreateSchedule(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(
        result.current.create({ name: "x", org: "isc" }),
      ).rejects.toThrow(failure);
    });

    expect(result.current.error).toBe(failure);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CadenceField
// ---------------------------------------------------------------------------

function ControlledCadenceField({ initial }: { initial: CadencePreset }) {
  const [value, setValue] = useState<CadencePreset>(initial);
  return <CadenceField value={value} onChange={setValue} timeZone="UTC" />;
}

describe("CadenceField", () => {
  it("summarizes the selected preset in plain English", () => {
    render(
      <ControlledCadenceField initial={{ kind: "daily", hour: 9, minute: 0 }} />,
    );
    expect(screen.getByTestId("cadence-summary").textContent).toBe(
      "Every day at 09:00 (UTC)",
    );
  });

  it("carries the time of day across preset switches", () => {
    render(
      <ControlledCadenceField initial={{ kind: "daily", hour: 9, minute: 30 }} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(screen.getByTestId("cadence-summary").textContent).toBe(
      "Every Monday at 09:30 (UTC)",
    );
  });

  it("prefills the custom escape hatch with the generated cron", () => {
    render(
      <ControlledCadenceField initial={{ kind: "daily", hour: 9, minute: 0 }} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Custom cron" }));
    expect(
      (screen.getByRole("textbox", { name: "Cron expression" }) as HTMLInputElement)
        .value,
    ).toBe("0 9 * * *");
  });

  it("rejects invalid custom cron with the server's wording", () => {
    render(
      <ControlledCadenceField initial={{ kind: "custom", cron: "@every 30s" }} />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "spec.cron must be a calendar expression — @every intervals are not supported",
    );
    expect(screen.queryByTestId("cadence-summary")).toBeNull();
  });

  it("keeps the last selected weekly day locked", () => {
    render(
      <ControlledCadenceField
        initial={{ kind: "weekly", days: [1], hour: 9, minute: 0 }}
      />,
    );
    const monday = screen.getByRole("button", { name: "Monday" });
    expect((monday as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Friday" }));
    expect(
      (screen.getByRole("button", { name: "Monday" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("warns that days 29-31 skip shorter months", () => {
    render(
      <ControlledCadenceField
        initial={{ kind: "monthly", day: 31, hour: 9, minute: 0 }}
      />,
    );
    expect(screen.getByText(/Months without day 31 are skipped/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ScheduleForm
// ---------------------------------------------------------------------------

function createClient(overrides?: {
  apply?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
  vault?: { getMine: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };
}) {
  return {
    schedule: { apply: overrides?.apply ?? vi.fn().mockResolvedValue(CREATED) },
    agent: {
      list:
        overrides?.list ?? vi.fn().mockResolvedValue({ entries: [AGENT_RESULT] }),
    },
    ...(overrides?.vault ? { vault: overrides.vault } : {}),
  };
}

const MY_VAULT = create(VaultSchema, {
  metadata: { id: "vlt_mine", org: "isc", slug: "my-vault-0a1b2c", name: "My vault" },
  spec: { owner: { case: "person", value: "ida_ana" } },
});
const TEAM_VAULT = create(VaultSchema, {
  metadata: { id: "vlt_team", org: "isc", slug: "team-keys", name: "Team keys" },
  spec: { owner: { case: "org", value: "isc" } },
});

/** A client whose caller has a My vault in "isc" beside one shared vault. */
function vaultClient(apply = vi.fn().mockResolvedValue(CREATED)) {
  return createClient({
    apply,
    vault: {
      getMine: vi.fn().mockResolvedValue(MY_VAULT),
      list: vi.fn().mockResolvedValue({ items: [MY_VAULT, TEAM_VAULT], totalCount: 2 }),
    },
  });
}

function optionLabels(group: HTMLElement): string[] {
  return within(group)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

async function pickAgent() {
  fireEvent.click(screen.getByText("Choose an agent…"));
  const result = await screen.findByRole("option", { name: /Fee Reminder/ });
  fireEvent.click(result);
}

describe("ScheduleForm", () => {
  it("disables submit until name, agent, and message are provided", async () => {
    const client = createClient();
    render(<ScheduleForm org="isc" />, { wrapper: wrapper(client) });

    const submit = screen.getByRole("button", { name: "Create schedule" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "daily-fee-reminders" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Send today's reminders." },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await pickAgent();
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits the generated cron, browser time zone, and staged-disabled default", async () => {
    const apply = vi.fn().mockResolvedValue(CREATED);
    const client = createClient({ apply });
    const onComplete = vi.fn();

    render(<ScheduleForm org="isc" onComplete={onComplete} />, {
      wrapper: wrapper(client),
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "daily-fee-reminders" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "  Send today's reminders.  " },
    });
    await pickAgent();

    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(CREATED));
    expect(apply).toHaveBeenCalledWith({
      name: "daily-fee-reminders",
      org: "isc",
      // The default cadence: daily at 09:00.
      cron: "0 9 * * *",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      // Staged-disabled by default — validate with Run now, then enable.
      enabled: false,
      agent: {
        agentRef: { org: "isc", slug: "fee-reminder", kind: 40 },
        message: "Send today's reminders.",
      },
    });
  });

  it("submits the budget as runConfig.maxCostUsd, dropping the blank model", async () => {
    const apply = vi.fn().mockResolvedValue(CREATED);
    const client = createClient({ apply });
    const onComplete = vi.fn();

    render(<ScheduleForm org="isc" onComplete={onComplete} />, {
      wrapper: wrapper(client),
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "daily-fee-reminders" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Send today's reminders." },
    });
    await pickAgent();
    fireEvent.change(screen.getByLabelText(/Budget per run/), {
      target: { value: "0.50" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(CREATED));
    const input = apply.mock.calls[0][0];
    expect(input.agent.runConfig).toEqual({ maxCostUsd: 0.5 });
    // No model picked: neither a model nor a harness is pinned.
    expect(input.agent.harness).toBeUndefined();
  });

  it("submits git workspace entries added through the manual URL input", async () => {
    const apply = vi.fn().mockResolvedValue(CREATED);
    const client = createClient({ apply });
    const onComplete = vi.fn();

    render(<ScheduleForm org="isc" onComplete={onComplete} />, {
      wrapper: wrapper(client),
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "daily-fee-reminders" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Send today's reminders." },
    });
    await pickAgent();

    // No GitHub connection in this client, so the workspace editor's
    // GitHub action drills into the manual URL panel — no OAuth flow.
    fireEvent.click(screen.getByRole("button", { name: /Connect GitHub/ }));
    fireEvent.change(screen.getByLabelText("Git repository URL"), {
      target: { value: "https://github.com/isc/fee-data.git" },
    });
    fireEvent.change(screen.getByLabelText("Branch (optional)"), {
      target: { value: "main" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(CREATED));
    const input = apply.mock.calls[0][0];
    expect(input.agent.workspaceEntries).toEqual([
      {
        name: "isc/fee-data",
        source: {
          gitRepo: { url: "https://github.com/isc/fee-data.git", branch: "main" },
        },
      },
    ]);
  });

  it("picking a model pins the engine it belongs to (harness + model travel together)", async () => {
    const apply = vi.fn().mockResolvedValue(CREATED);
    const client = createClient({ apply });
    const onComplete = vi.fn();

    const registryModel: ModelInfo = {
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
      displayName: "Claude Sonnet 4.6",
      shortDescription: "Balanced default",
      speedTier: "balanced",
      costTier: "standard",
      harness: "cursor",
      featured: true,
      serviceTiers: [],
    };

    function RegistryWrapper({ children }: { children: ReactNode }) {
      const Base = wrapper(client);
      return (
        <ModelRegistryContext.Provider
          value={{
            models: [registryModel],
            isLoading: false,
            error: null,
            refetch: () => {},
          }}
        >
          <Base>{children}</Base>
        </ModelRegistryContext.Provider>
      );
    }

    render(<ScheduleForm org="isc" onComplete={onComplete} />, {
      wrapper: RegistryWrapper,
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "daily-fee-reminders" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Send today's reminders." },
    });
    await pickAgent();

    // Nothing pinned yet: the trigger shows the placeholder.
    fireEvent.click(screen.getByRole("button", { name: /Platform default/ }));
    fireEvent.click(
      await screen.findByRole("option", { name: /Claude Sonnet 4\.6/ }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(CREATED));
    const input = apply.mock.calls[0][0];
    expect(input.agent.runConfig).toEqual({ modelName: "claude-sonnet-4-6" });
    expect(input.agent.harness).toBe(Harness.CURSOR);
  });

  it("toggling the fast tier on a capable model lands service_tier on run_config (#357)", async () => {
    const apply = vi.fn().mockResolvedValue(CREATED);
    const client = createClient({ apply });
    const onComplete = vi.fn();

    const fastCapable: ModelInfo = {
      modelId: "composer-2.5",
      provider: "cursor",
      displayName: "Composer 2.5",
      shortDescription: "Fast agentic model",
      speedTier: "fastest",
      costTier: "economy",
      harness: "cursor",
      featured: true,
      serviceTiers: ["fast"],
    };

    function RegistryWrapper({ children }: { children: ReactNode }) {
      const Base = wrapper(client);
      return (
        <ModelRegistryContext.Provider
          value={{
            models: [fastCapable],
            isLoading: false,
            error: null,
            refetch: () => {},
          }}
        >
          <Base>{children}</Base>
        </ModelRegistryContext.Provider>
      );
    }

    render(<ScheduleForm org="isc" onComplete={onComplete} />, {
      wrapper: RegistryWrapper,
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "daily-fee-reminders" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Send today's reminders." },
    });
    await pickAgent();

    fireEvent.click(screen.getByRole("button", { name: /Platform default/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Composer 2\.5/ }));

    // The popover closed on selection; reopen it — the options-area switch
    // renders only for the now-selected fast-capable model.
    fireEvent.click(screen.getByRole("button", { name: /Composer 2\.5/ }));
    fireEvent.click(await screen.findByRole("switch", { name: "Fast tier" }));

    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(CREATED));
    const input = apply.mock.calls[0][0];
    expect(input.agent.runConfig).toEqual({
      modelName: "composer-2.5",
      serviceTier: ServiceTier.FAST,
    });
  });

  it("surfaces the server error verbatim and stays editable", async () => {
    const apply = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "spec.cron must be a calendar expression — @every intervals are not supported",
        ),
      );
    const client = createClient({ apply });
    const onComplete = vi.fn();

    render(<ScheduleForm org="isc" onComplete={onComplete} />, {
      wrapper: wrapper(client),
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "daily-fee-reminders" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Send today's reminders." },
    });
    await pickAgent();
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("@every intervals are not supported");
    expect(onComplete).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Create schedule" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("names its creator's My vault by default, and sends it with the schedule", async () => {
    const apply = vi.fn().mockResolvedValue(CREATED);
    const client = vaultClient(apply);
    const onComplete = vi.fn();
    render(<ScheduleForm org="isc" onComplete={onComplete} />, {
      wrapper: wrapper(client),
    });

    const selected = await screen.findByRole("list", { name: "Selected vaults (in order)" });
    await waitFor(() => expect(within(selected).getByText("My vault")).toBeTruthy());
    expect(client.vault?.getMine).toHaveBeenCalledWith(expect.objectContaining({ org: "isc" }));

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "daily-fee-reminders" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Send today's reminders." },
    });
    await pickAgent();
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(CREATED));
    expect(apply.mock.calls[0][0].agent.vaults).toEqual([
      { org: "isc", slug: "my-vault-0a1b2c" },
    ]);
  });

  it("offers My vault in its picker, and a picker elsewhere does not", async () => {
    const client = vaultClient();
    const { unmount } = render(<ScheduleForm org="isc" />, { wrapper: wrapper(client) });

    // Removing the default puts My vault back among the offered vaults.
    fireEvent.click(await screen.findByRole("button", { name: "Remove My vault" }));
    const group = screen.getByRole("group", { name: "Vaults" });
    await waitFor(() => expect(optionLabels(group)).toEqual(["+ Add vault", "My vault", "Team keys"]));
    unmount();

    // Any other surface (an agent, a conversation, a share) names shared vaults only.
    render(<VaultPicker org="isc" value={[]} onChange={() => {}} />, { wrapper: wrapper(client) });
    const other = screen.getByRole("group", { name: "Vaults" });
    await waitFor(() => expect(optionLabels(other)).toEqual(["+ Add vault", "Team keys"]));
  });

  it("fires onCancel", () => {
    const client = createClient();
    const onCancel = vi.fn();
    render(<ScheduleForm org="isc" onCancel={onCancel} />, {
      wrapper: wrapper(client),
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
