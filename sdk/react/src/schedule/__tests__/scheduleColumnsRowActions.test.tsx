import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ScheduleSchema, type Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { StigmerContext } from "../../context";
import { createScheduleColumns } from "../scheduleColumns";
import { ScheduleRowActions } from "../ScheduleRowActions";

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
}): Schedule {
  return create(ScheduleSchema, {
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
          message: "Send reminders.",
        },
      },
    },
    status: {
      nextFireAt: timestampFromDate(new Date(NOW.getTime() + 2 * 3_600_000)),
      lastFireAt: timestampFromDate(new Date(NOW.getTime() - 10 * 60_000)),
      pausedReason: overrides?.pausedReason ?? "",
    },
  });
}

describe("createScheduleColumns", () => {
  const columns = createScheduleColumns({ now: () => NOW });
  const byId = new Map(columns.map((c) => [c.id, c]));

  it("declares the operational column set the issue calls for", () => {
    expect(columns.map((c) => c.id)).toEqual([
      "name",
      "state",
      "cron",
      "next-fire",
      "last-run",
      "target",
    ]);
    // No fake sort affordances: the direct query has one fixed order.
    expect(columns.every((c) => !c.sortable)).toBe(true);
  });

  it("renders live status straight from the Schedule proto", () => {
    const schedule = makeSchedule();
    render(
      <>
        {byId.get("state")!.cell(schedule)}
        {byId.get("next-fire")!.cell(schedule)}
        {byId.get("last-run")!.cell(schedule)}
        {byId.get("target")!.cell(schedule)}
      </>,
    );

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("in 2h")).toBeTruthy();
    expect(screen.getByText("10m")).toBeTruthy();
    expect(screen.getByText("isc/fee-reminder")).toBeTruthy();
  });

  it("shows no countdown for a disabled schedule", () => {
    const schedule = makeSchedule({ enabled: false });
    render(
      <>
        {byId.get("state")!.cell(schedule)}
        {byId.get("next-fire")!.cell(schedule)}
      </>,
    );

    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.queryByText("in 2h")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("ScheduleRowActions", () => {
  function renderRow(
    schedule: Schedule,
    client: unknown,
    onChanged?: () => void,
  ) {
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      );
    }
    return render(
      <ScheduleRowActions schedule={schedule} onChanged={onChanged} />,
      { wrapper: Wrapper },
    );
  }

  it("gates Run now behind a confirmation, then triggers and notifies", async () => {
    const trigger = vi.fn().mockResolvedValue(makeSchedule());
    const onChanged = vi.fn();
    renderRow(makeSchedule(), { schedule: { trigger } }, onChanged);

    fireEvent.click(screen.getByRole("button", { name: /Run .* now/ }));
    expect(trigger).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Start run"));
    await waitFor(() => expect(trigger).toHaveBeenCalledWith("sch_01example"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("offers Resume on a paused schedule, one click", async () => {
    const resume = vi.fn().mockResolvedValue(makeSchedule());
    const onChanged = vi.fn();
    renderRow(
      makeSchedule({ pausedReason: "5 consecutive failures" }),
      { schedule: { resume } },
      onChanged,
    );

    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    await waitFor(() => expect(resume).toHaveBeenCalledWith("sch_01example"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("renders nothing for an owner-disabled schedule", () => {
    const { container } = renderRow(makeSchedule({ enabled: false }), {});
    expect(container.textContent).toBe("");
  });

  it("never bubbles clicks into the row's navigation handler", () => {
    const onRowClick = vi.fn();
    const trigger = vi.fn();
    render(
      <StigmerContext.Provider value={{ schedule: { trigger } } as never}>
        <div onClick={onRowClick}>
          <ScheduleRowActions schedule={makeSchedule()} />
        </div>
      </StigmerContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Run .* now/ }));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
