import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { clone, create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ScheduleSchema, type Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ScheduleTriggerResultSchema,
  ScheduleRunListSchema,
  ScheduleRunSchema,
  ScheduleRunOutcome,
  ScheduleRunOrigin,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ScheduleDetailView } from "../ScheduleDetailView";

vi.mock("../../feedback/toast", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeAll(() => {
  // happy-dom does not implement the native dialog show/close methods.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const NOW = new Date("2026-08-04T10:00:00Z");

function makeSchedule(overrides?: {
  enabled?: boolean;
  pausedReason?: string;
  lastExecutionId?: string;
}): Schedule {
  return create(ScheduleSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Schedule",
    metadata: {
      id: "sch_01example",
      name: "daily-fee-reminders",
      slug: "daily-fee-reminders",
      org: "isc",
    },
    spec: {
      cron: "0 9 * * *",
      timeZone: "Asia/Kolkata",
      enabled: overrides?.enabled ?? true,
      target: {
        case: "agent",
        value: {
          agentRef: { kind: ApiResourceKind.agent, org: "isc", slug: "fee-reminder" },
          message: "Send today's fee reminders.",
        },
      },
    },
    status: {
      nextFireAt: timestampFromDate(new Date(NOW.getTime() + 3 * 3_600_000)),
      lastFireAt: timestampFromDate(new Date(NOW.getTime() - 5 * 60_000)),
      lastExecutionId: overrides?.lastExecutionId ?? "aex_01run",
      consecutiveFailures: overrides?.pausedReason ? 5 : 0,
      pausedReason: overrides?.pausedReason ?? "",
    },
  });
}

interface MockClient {
  schedule: {
    getByReference: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    trigger: ReturnType<typeof vi.fn>;
    listRuns: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  manifest: { apply: ReturnType<typeof vi.fn> };
}

function makeClient(schedule: Schedule): MockClient {
  return {
    schedule: {
      getByReference: vi.fn().mockResolvedValue(schedule),
      resume: vi.fn().mockResolvedValue(schedule),
      // The synchronous trigger answers with the run's real outcome
      // (DD-017 D-6) — a started run by default.
      trigger: vi.fn().mockResolvedValue(
        create(ScheduleTriggerResultSchema, {
          outcome: ScheduleRunOutcome.STARTED,
          executionId: "aex_01triggered",
          schedule,
        }),
      ),
      listRuns: vi.fn().mockResolvedValue(
        create(ScheduleRunListSchema, { items: [], totalCount: 0 }),
      ),
      delete: vi.fn().mockResolvedValue(schedule),
    },
    manifest: {
      apply: vi.fn(async (doc: { message: unknown }) => ({
        yamlKind: "Schedule",
        displayName: "Schedule",
        name: "daily-fee-reminders",
        slug: "daily-fee-reminders",
        org: "isc",
        id: "sch_01example",
        message: doc.message,
      })),
    },
  };
}

function renderView(
  client: MockClient,
  props?: Partial<Parameters<typeof ScheduleDetailView>[0]>,
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return render(
    <ScheduleDetailView
      org="isc"
      slug="daily-fee-reminders"
      now={NOW}
      {...props}
    />,
    { wrapper: Wrapper },
  );
}

describe("ScheduleDetailView", () => {
  it("renders definition and status for an active schedule", async () => {
    renderView(makeClient(makeSchedule()));

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    expect(screen.getByText("0 9 * * *")).toBeTruthy();
    expect(screen.getByText("Asia/Kolkata")).toBeTruthy();
    expect(screen.getByText("isc/fee-reminder")).toBeTruthy();
    expect(screen.getByText("Send today's fee reminders.")).toBeTruthy();
    expect(screen.getByText("in 3h")).toBeTruthy();
    expect(screen.getByText("5m")).toBeTruthy();
    expect(screen.getByText("aex_01run")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    // Active schedules show no state banner.
    expect(screen.queryByText("Schedule is disabled")).toBeNull();
    expect(screen.queryByText("Paused by the platform")).toBeNull();
  });

  it("renders the disabled banner with an inline Enable remedy", async () => {
    const client = makeClient(makeSchedule({ enabled: false }));
    renderView(client);

    await screen.findByText("Schedule is disabled");
    expect(screen.getByText("Disabled")).toBeTruthy();
    // Owner-disabled schedules have no meaningful countdown.
    expect(screen.queryByText("in 3h")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Enable schedule" }));

    await waitFor(() => expect(client.manifest.apply).toHaveBeenCalledOnce());
    const doc = client.manifest.apply.mock.calls[0][0] as { message: Schedule };
    expect(doc.message.spec?.enabled).toBe(true);
  });

  it("renders the paused banner with reason and an inline Resume remedy", async () => {
    const client = makeClient(makeSchedule({ pausedReason: "5 consecutive failures" }));
    renderView(client);

    await screen.findByText("Paused by the platform");
    expect(screen.getByText(/5 consecutive failures — resuming clears/)).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Resume schedule" }));

    await waitFor(() =>
      expect(client.schedule.resume).toHaveBeenCalledWith("sch_01example"),
    );
  });

  it("never collapses disabled and paused: disabled wins, pause stays visible", async () => {
    const client = makeClient(
      makeSchedule({ enabled: false, pausedReason: "5 consecutive failures" }),
    );
    renderView(client);

    await screen.findByText("Schedule is disabled");
    expect(screen.queryByText("Paused by the platform")).toBeNull();
    // The badge says Disabled, but the platform pause is still explained.
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText(/also paused by the platform/)).toBeTruthy();
  });

  it("gates Run now behind a confirmation and refetches after", async () => {
    const client = makeClient(makeSchedule());
    renderView(client);

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));

    // Confirmation first — nothing fired yet.
    await screen.findByText("Run this schedule now?");
    expect(client.schedule.trigger).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Start run"));
    await waitFor(() =>
      expect(client.schedule.trigger).toHaveBeenCalledWith("sch_01example"),
    );
    // Refetch picks up the new last_execution_id.
    await waitFor(() =>
      expect(client.schedule.getByReference.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("offers 'Enable & run now' on a disabled schedule (DD-017 D-5)", async () => {
    const client = makeClient(makeSchedule({ enabled: false }));
    renderView(client);

    await screen.findByText("Schedule is disabled");
    // No plain "Run now": a disabled schedule cannot fire server-side, so
    // the staged-test flow is one click that enables THEN fires.
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
    const enableAndRun = screen.getByRole("button", { name: "Enable & run now" });
    expect((enableAndRun as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(enableAndRun);
    await screen.findByText("Enable and run this schedule now?");
    fireEvent.click(screen.getByText("Enable & run"));

    // Enable (a full-proto re-apply) THEN fire.
    await waitFor(() => expect(client.manifest.apply).toHaveBeenCalledOnce());
    const doc = client.manifest.apply.mock.calls[0][0] as { message: Schedule };
    expect(doc.message.spec?.enabled).toBe(true);
    await waitFor(() =>
      expect(client.schedule.trigger).toHaveBeenCalledWith("sch_01example"),
    );
  });

  it("navigates to the execution on a started run", async () => {
    const onNavigateToExecution = vi.fn();
    const client = makeClient(makeSchedule());
    renderView(client, { onNavigateToExecution });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await screen.findByText("Run this schedule now?");
    fireEvent.click(screen.getByText("Start run"));

    await waitFor(() =>
      expect(onNavigateToExecution).toHaveBeenCalledWith("aex_01triggered"),
    );
  });

  it("renders the run history from the fire ledger", async () => {
    const client = makeClient(makeSchedule());
    client.schedule.listRuns.mockResolvedValue(
      create(ScheduleRunListSchema, {
        totalCount: 1,
        items: [
          create(ScheduleRunSchema, {
            scheduleId: "sch_01example",
            origin: ScheduleRunOrigin.CRON,
            outcome: ScheduleRunOutcome.REFUSED,
            reason:
              "run refused: MCP server 'isc-gym' requires environment variable 'ISC_MCP_SHARED_SECRET'",
            nominalFireTime: timestampFromDate(new Date(NOW.getTime() - 60_000)),
          }),
        ],
      }),
    );
    renderView(client);

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    // The refusal reason — invisible before the ledger — is now on screen.
    await screen.findByText(/ISC_MCP_SHARED_SECRET/);
    expect(screen.getByText("Refused")).toBeTruthy();
  });

  it("navigates through the callback seams (DD-004)", async () => {
    const onNavigateToAgent = vi.fn();
    const onNavigateToExecution = vi.fn();
    renderView(makeClient(makeSchedule()), {
      onNavigateToAgent,
      onNavigateToExecution,
    });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "isc/fee-reminder" }));
    expect(onNavigateToAgent).toHaveBeenCalledWith("isc", "fee-reminder");

    fireEvent.click(screen.getByRole("button", { name: "aex_01run" }));
    expect(onNavigateToExecution).toHaveBeenCalledWith("aex_01run");
  });

  it("renders references as plain text without navigation callbacks", async () => {
    renderView(makeClient(makeSchedule()));

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    expect(screen.queryByRole("button", { name: "isc/fee-reminder" })).toBeNull();
    expect(screen.getByText("isc/fee-reminder")).toBeTruthy();
  });

  it("shows the not-found state for a missing schedule", async () => {
    const client = makeClient(makeSchedule());
    // NOT_FOUND resolves to null via useSchedule's isNotFound handling —
    // simulate the resolved-null directly.
    client.schedule.getByReference.mockResolvedValue(null);
    renderView(client);

    await screen.findByText("Schedule not found");
  });

  it("keeps the caller's schedule untouched when toggling (immutability)", async () => {
    const schedule = makeSchedule({ enabled: false });
    const original = clone(ScheduleSchema, schedule);
    const client = makeClient(schedule);
    renderView(client);

    await screen.findByText("Schedule is disabled");
    fireEvent.click(screen.getByRole("button", { name: "Enable schedule" }));
    await waitFor(() => expect(client.manifest.apply).toHaveBeenCalledOnce());

    expect(schedule.spec?.enabled).toBe(original.spec?.enabled);
  });
});
