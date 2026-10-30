/**
 * The routine list's columns and row actions: the countdown and state
 * columns, Run now through the run dialog with its note, Run now absent for
 * someone who may not fire (`can_fire`), one-click Resume on a paused
 * routine, nothing on a disabled one, and no click reaching the row's
 * navigation.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { RoutineSchema, type Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { StigmerContext } from "@stigmer/react-core";
import { createRoutineColumns } from "../routineColumns";
import { RoutineRowActions } from "../RoutineRowActions";

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

/** The self-check every gated row asks, answering `allowed` for `can_fire`. */
function grantAnswering(allowed: boolean) {
  return {
    checkMyPermission: vi.fn(async (input: { relation: string }) => ({
      isAuthorized: input.relation === "can_fire" ? allowed : true,
    })),
  };
}
afterEach(cleanup);

const NOW = new Date("2026-08-04T10:00:00Z");

function makeRoutine(overrides?: {
  enabled?: boolean;
  pausedReason?: string;
}): Routine {
  return create(RoutineSchema, {
    metadata: {
      id: "rtn_01example",
      name: "daily-fee-reminders",
      slug: "daily-fee-reminders",
      org: "isc",
    },
    spec: {
      cron: "0 9 * * *",
      timeZone: "Asia/Kolkata",
      enabled: overrides?.enabled ?? true,
      agent: {
          agentRef: { kind: ApiResourceKind.agent, org: "isc", slug: "fee-reminder" },
          message: "Send reminders.",
        },
    },
    status: {
      nextFireAt: timestampFromDate(new Date(NOW.getTime() + 2 * 3_600_000)),
      lastFireAt: timestampFromDate(new Date(NOW.getTime() - 10 * 60_000)),
      pausedReason: overrides?.pausedReason ?? "",
    },
  });
}

describe("createRoutineColumns", () => {
  const columns = createRoutineColumns({ now: () => NOW });
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
    const routine = makeRoutine();
    render(
      <>
        {byId.get("state")!.cell(routine)}
        {byId.get("next-fire")!.cell(routine)}
        {byId.get("last-run")!.cell(routine)}
        {byId.get("target")!.cell(routine)}
      </>,
    );

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("in 2h")).toBeTruthy();
    expect(screen.getByText("10m")).toBeTruthy();
    expect(screen.getByText("isc/fee-reminder")).toBeTruthy();
  });

  it("shows no countdown for a disabled routine", () => {
    const routine = makeRoutine({ enabled: false });
    render(
      <>
        {byId.get("state")!.cell(routine)}
        {byId.get("next-fire")!.cell(routine)}
      </>,
    );

    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.queryByText("in 2h")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("RoutineRowActions", () => {
  function renderRow(
    routine: Routine,
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
      <RoutineRowActions routine={routine} onChanged={onChanged} />,
      { wrapper: Wrapper },
    );
  }

  it("opens the run dialog, then fires with the note and notifies", async () => {
    const trigger = vi.fn().mockResolvedValue({ outcome: 0, runId: "" });
    const onChanged = vi.fn();
    renderRow(
      makeRoutine(),
      { routine: { fire: trigger }, grant: grantAnswering(true) },
      onChanged,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Run .* now/ }));
    expect(trigger).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Note for this run/), {
      target: { value: "SEN-4521 fired" },
    });
    fireEvent.click(screen.getByText("Start run"));
    await waitFor(() =>
      expect(trigger).toHaveBeenCalledWith(
        expect.objectContaining({ id: "rtn_01example", text: "SEN-4521 fired" }),
      ),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("offers no Run now to someone who may not fire the routine", async () => {
    const grant = grantAnswering(false);
    renderRow(makeRoutine(), { routine: { fire: vi.fn() }, grant });

    await waitFor(() => expect(grant.checkMyPermission).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: /Run .* now/ })).toBeNull());
    expect(grant.checkMyPermission.mock.calls[0]![0]).toMatchObject({
      relation: "can_fire",
      resource: { kind: "routine", id: "rtn_01example" },
    });
  });

  it("offers Resume on a paused routine, one click", async () => {
    const resume = vi.fn().mockResolvedValue(makeRoutine());
    const onChanged = vi.fn();
    renderRow(
      makeRoutine({ pausedReason: "5 consecutive failures" }),
      { routine: { resume } },
      onChanged,
    );

    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    await waitFor(() => expect(resume).toHaveBeenCalledWith("rtn_01example"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("renders nothing for an owner-disabled routine", () => {
    const { container } = renderRow(makeRoutine({ enabled: false }), {});
    expect(container.textContent).toBe("");
  });

  it("never bubbles clicks into the row's navigation handler", async () => {
    const onRowClick = vi.fn();
    const trigger = vi.fn();
    render(
      <StigmerContext.Provider
        value={{ routine: { fire: trigger }, grant: grantAnswering(true) } as never}
      >
        <div onClick={onRowClick}>
          <RoutineRowActions routine={makeRoutine()} />
        </div>
      </StigmerContext.Provider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Run .* now/ }));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
