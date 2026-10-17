/**
 * The schedule detail view: read state, the banners and their remedies,
 * the run history, and the inline editors' saves. A save is an update
 * naming the spec fields its editor changed, on the schedule's id, and it
 * changes only what its editor owns: the budget editor
 * the cost cap, the engine editor the engine, model, tier and thinking,
 * and a stored tier or thinking (an explicit standard or disabled among
 * them) survives any save that leaves it alone. The vaults editor offers
 * My vault only to the schedule's creator, the one person the server
 * accepts it from.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { act, render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { clone, create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { RoutineSchema, type Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import {
  RoutineFireResultSchema,
  RoutineFireListSchema,
  RoutineFireSchema,
  RoutineFireOutcome,
  RoutineFireOrigin,
} from "@stigmer/protos/ai/stigmer/agentic/routine/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { RoutineDetailView } from "../RoutineDetailView";
import { openMenu } from "../../__tests__/helpers/open-menu";

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

function makeRoutine(overrides?: {
  enabled?: boolean;
  pausedReason?: string;
  lastRunId?: string;
  cron?: string;
  consecutiveFailures?: number;
  vaults?: readonly { org: string; slug: string }[];
  createdBy?: string;
  harness?: Harness;
  runConfig?: {
    modelName?: string;
    maxCostUsd?: number;
    maxToolRounds?: number;
    maxToolResultChars?: number;
    serviceTier?: ServiceTier;
    thinkingMode?: ThinkingMode;
  };
}): Routine {
  return create(RoutineSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Schedule",
    metadata: {
      id: "sch_01example",
      name: "daily-fee-reminders",
      slug: "daily-fee-reminders",
      org: "isc",
    },
    spec: {
      cron: overrides?.cron ?? "0 9 * * *",
      timeZone: "Asia/Kolkata",
      enabled: overrides?.enabled ?? true,
      target: {
        case: "agent",
        value: {
          agentRef: { kind: ApiResourceKind.agent, org: "isc", slug: "fee-reminder" },
          message: "Send today's fee reminders.",
          vaults: (overrides?.vaults ?? []).map((r) => ({
            kind: ApiResourceKind.vault,
            org: r.org,
            slug: r.slug,
          })),
          ...(overrides?.harness !== undefined
            ? { harness: overrides.harness }
            : {}),
          ...(overrides?.runConfig ? { runConfig: overrides.runConfig } : {}),
        },
      },
    },
    status: {
      nextFireAt: timestampFromDate(new Date(NOW.getTime() + 3 * 3_600_000)),
      lastFireAt: timestampFromDate(new Date(NOW.getTime() - 5 * 60_000)),
      lastRunId: overrides?.lastRunId ?? "aex_01run",
      consecutiveFailures:
        overrides?.consecutiveFailures ?? (overrides?.pausedReason ? 5 : 0),
      pausedReason: overrides?.pausedReason ?? "",
      ...(overrides?.createdBy !== undefined
        ? { audit: { specAudit: { createdBy: { id: overrides.createdBy } } } }
        : {}),
    },
  });
}

interface MockClient {
  routine: {
    getByReference: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    fire: ReturnType<typeof vi.fn>;
    listFires: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  // The slug field asks can_delete (whoever may delete may rename);
  // denied unless a test grants it.
  grant: { checkMyPermission: ReturnType<typeof vi.fn> };
  // The vaults inline editor's picker lists the org's vaults, and offers
  // My vault only when the viewer is the schedule's creator.
  vault: { list: ReturnType<typeof vi.fn> };
  identityAccount: { whoAmI: ReturnType<typeof vi.fn> };
}

/** The identity every test views the schedule as. */
const VIEWER_ID = "ida_viewer";

function makeClient(routine: Routine): MockClient {
  return {
    routine: {
      getByReference: vi.fn().mockResolvedValue(routine),
      resume: vi.fn().mockResolvedValue(routine),
      // The synchronous trigger answers with the run's real outcome
      // — a started run by default.
      fire: vi.fn().mockResolvedValue(
        create(RoutineFireResultSchema, {
          outcome: RoutineFireOutcome.STARTED,
          runId: "aex_01triggered",
          routine: routine,
        }),
      ),
      listFires: vi.fn().mockResolvedValue(
        create(RoutineFireListSchema, { entries: []}),
      ),
      delete: vi.fn().mockResolvedValue(routine),
      rename: vi.fn(async ({ slug }: { slug: string }) => {
        const renamed = clone(RoutineSchema, routine);
        renamed.metadata!.slug = slug;
        return renamed;
      }),
      // The update answers the stored schedule with the sent spec fields
      // on it: a whole spec (an inline edit) or the one flag (the toggle).
      update: vi.fn(async (resource: Routine) => {
        const stored = clone(RoutineSchema, routine);
        const sent = resource.spec;
        if (sent !== undefined && "$typeName" in sent) {
          stored.spec = sent;
        } else if (sent !== undefined) {
          Object.assign(stored.spec!, sent);
        }
        return stored;
      }),
    },
    grant: {
      checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: false }),
    },
    vault: {
      list: vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }),
    },
    identityAccount: {
      whoAmI: vi.fn().mockResolvedValue({ metadata: { id: VIEWER_ID } }),
    },
  };
}

function renderView(
  client: MockClient,
  props?: Partial<Parameters<typeof RoutineDetailView>[0]>,
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
    <RoutineDetailView
      org="isc"
      slug="daily-fee-reminders"
      now={NOW}
      {...props}
    />,
    { wrapper: Wrapper },
  );
}


/** A fire ledger of `total` fires, paged by token as the server pages it. */
function pagedFires(total: number) {
  return async (req: { pageSize: number; pageToken: string }) => {
    const start = req.pageToken === "" ? 0 : Number(req.pageToken.slice("after_".length));
    const size = req.pageSize > 0 ? req.pageSize : 50;
    const end = Math.min(start + size, total);
    return create(RoutineFireListSchema, {
      entries: Array.from({ length: end - start }, (_, i) =>
        create(RoutineFireSchema, {
          routineId: "sch_01example",
          origin: RoutineFireOrigin.SCHEDULE,
          outcome: RoutineFireOutcome.COMPLETED,
          nominalFireTime: timestampFromDate(new Date(NOW.getTime() - (start + i + 1) * 60_000)),
        }),
      ),
      nextPageToken: end < total ? `after_${end}` : "",
    });
  };
}

describe("ScheduleDetailView", () => {
  it("renders definition and status for an active schedule", async () => {
    renderView(makeClient(makeRoutine()));

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    // The cadence humanizes into plain English (the stored time zone is
    // part of the sentence); the raw cron stays as the precise record.
    expect(screen.getByText("Every day at 09:00 (Asia/Kolkata)")).toBeTruthy();
    expect(screen.getByText("0 9 * * *")).toBeTruthy();
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
    const client = makeClient(makeRoutine({ enabled: false }));
    renderView(client);

    await screen.findByText("Schedule is disabled");
    expect(screen.getByText("Disabled")).toBeTruthy();
    // Owner-disabled schedules have no meaningful countdown.
    expect(screen.queryByText("in 3h")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Enable schedule" }));

    await waitFor(() => expect(client.routine.update).toHaveBeenCalledOnce());
    const doc = { message: sentUpdate<Routine>(client.routine.update).resource };
    expect(doc.message.spec?.enabled).toBe(true);
  });

  it("renders the paused banner with reason and an inline Resume remedy", async () => {
    const client = makeClient(makeRoutine({ pausedReason: "5 consecutive failures" }));
    renderView(client);

    await screen.findByText("Paused by the platform");
    expect(screen.getByText(/5 consecutive failures — resuming clears/)).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Resume schedule" }));

    await waitFor(() =>
      expect(client.routine.resume).toHaveBeenCalledWith("sch_01example"),
    );
  });

  it("never collapses disabled and paused: disabled wins, pause stays visible", async () => {
    const client = makeClient(
      makeRoutine({ enabled: false, pausedReason: "5 consecutive failures" }),
    );
    renderView(client);

    await screen.findByText("Schedule is disabled");
    expect(screen.queryByText("Paused by the platform")).toBeNull();
    // The badge says Disabled, but the platform pause is still explained.
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText(/also paused by the platform/)).toBeTruthy();
  });

  it("gates Run now behind a confirmation and refetches after", async () => {
    const client = makeClient(makeRoutine());
    renderView(client);

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));

    // Confirmation first — nothing fired yet.
    await screen.findByText("Run this schedule now?");
    expect(client.routine.fire).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Start run"));
    await waitFor(() =>
      expect(client.routine.fire).toHaveBeenCalledWith("sch_01example"),
    );
    // Refetch picks up the new last_run_id.
    await waitFor(() =>
      expect(client.routine.getByReference.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("offers 'Enable & run now' on a disabled schedule", async () => {
    const client = makeClient(makeRoutine({ enabled: false }));
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

    // Enable (an update naming spec.enabled) THEN fire.
    await waitFor(() => expect(client.routine.update).toHaveBeenCalledOnce());
    const doc = { message: sentUpdate<Routine>(client.routine.update).resource };
    expect(doc.message.spec?.enabled).toBe(true);
    await waitFor(() =>
      expect(client.routine.fire).toHaveBeenCalledWith("sch_01example"),
    );
  });

  it("navigates to the execution on a started run", async () => {
    const onNavigateToRun = vi.fn();
    const client = makeClient(makeRoutine());
    renderView(client, { onNavigateToRun });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await screen.findByText("Run this schedule now?");
    fireEvent.click(screen.getByText("Start run"));

    await waitFor(() =>
      expect(onNavigateToRun).toHaveBeenCalledWith("aex_01triggered"),
    );
  });

  it("renders the run history from the fire ledger", async () => {
    const client = makeClient(makeRoutine());
    client.routine.listFires.mockResolvedValue(
      create(RoutineFireListSchema, {
        entries: [
          create(RoutineFireSchema, {
            routineId: "sch_01example",
            origin: RoutineFireOrigin.SCHEDULE,
            outcome: RoutineFireOutcome.REFUSED,
            reason:
              "run refused: MCP server 'isc-gym' requires environment variable 'ISC_MCP_SHARED_SECRET'",
            nominalFireTime: timestampFromDate(new Date(NOW.getTime() - 60_000)),
          }),
        ],
        nextPageToken: "",
      }),
    );
    renderView(client);

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    // The refusal reason — invisible before the ledger — is now on screen.
    await screen.findByText(/ISC_MCP_SHARED_SECRET/);
    expect(screen.getByText("Refused")).toBeTruthy();
  });

  it("states an empty fire history in the History tab, not a blank table", async () => {
    const client = makeClient(makeRoutine());
    client.routine.listFires.mockResolvedValue(create(RoutineFireListSchema, { entries: [], nextPageToken: "" }));
    renderView(client);

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    expect(await screen.findByText(/No fires yet\./)).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Fire history" })).toBeNull();
  });

  it("shows how long a fire's run took, recorded to completed", async () => {
    const client = makeClient(makeRoutine());
    client.routine.listFires.mockResolvedValue(
      create(RoutineFireListSchema, {
        entries: [
          create(RoutineFireSchema, {
            routineId: "sch_01example",
            origin: RoutineFireOrigin.SCHEDULE,
            outcome: RoutineFireOutcome.COMPLETED,
            nominalFireTime: timestampFromDate(new Date(NOW.getTime() - 60_000)),
            recordedAt: timestampFromDate(new Date(NOW.getTime() - 60_000)),
            completedAt: timestampFromDate(new Date(NOW.getTime() - 18_000)),
          }),
        ],
        nextPageToken: "",
      }),
    );
    renderView(client);

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    const table = await screen.findByRole("table", { name: "Fire history" });
    expect(within(table).getByText("42s")).toBeTruthy();
  });

  it("navigates through the callback seams", async () => {
    const onNavigateToAgent = vi.fn();
    const onNavigateToRun = vi.fn();
    renderView(makeClient(makeRoutine()), {
      onNavigateToAgent,
      onNavigateToRun,
    });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "isc/fee-reminder" }));
    expect(onNavigateToAgent).toHaveBeenCalledWith("isc", "fee-reminder");

    fireEvent.click(screen.getByRole("button", { name: "aex_01run" }));
    expect(onNavigateToRun).toHaveBeenCalledWith("aex_01run");
  });

  it("navigates to a ledger row's run from the recent-fires strip and the History table", async () => {
    const onNavigateToRun = vi.fn();
    const client = makeClient(makeRoutine({ lastRunId: "aex_01last" }));
    client.routine.listFires.mockResolvedValue(
      create(RoutineFireListSchema, {
        entries: [
          create(RoutineFireSchema, {
            routineId: "sch_01example",
            origin: RoutineFireOrigin.MANUAL,
            outcome: RoutineFireOutcome.COMPLETED,
            runId: "aex_01ledger",
            nominalFireTime: timestampFromDate(new Date(NOW.getTime() - 60_000)),
          }),
        ],
        nextPageToken: "",
      }),
    );
    renderView(client, { onNavigateToRun });

    fireEvent.click(await screen.findByRole("button", { name: "aex_01ledger" }));
    expect(onNavigateToRun).toHaveBeenLastCalledWith("aex_01ledger");

    fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    const table = await screen.findByRole("table", { name: "Fire history" });
    fireEvent.click(within(table).getByRole("button", { name: "aex_01ledger" }));
    expect(onNavigateToRun).toHaveBeenCalledTimes(2);
    expect(onNavigateToRun).toHaveBeenLastCalledWith("aex_01ledger");
  });

  it("deletes behind a confirmation that says past runs are kept, then reports it", async () => {
    const onDeleted = vi.fn();
    const client = makeClient(makeRoutine());
    renderView(client, { onDeleted });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    await openMenu(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await screen.findByText("Delete this schedule?");
    expect(
      screen.getByText(
        '"daily-fee-reminders" will stop firing and be permanently removed. Past runs are not affected. This cannot be undone.',
      ),
    ).toBeTruthy();
    expect(client.routine.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(client.routine.delete).toHaveBeenCalledWith("sch_01example"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  });

  it("renders references as plain text without navigation callbacks", async () => {
    renderView(makeClient(makeRoutine()));

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    expect(screen.queryByRole("button", { name: "isc/fee-reminder" })).toBeNull();
    expect(screen.getByText("isc/fee-reminder")).toBeTruthy();
  });

  it("shows the not-found state for a missing schedule", async () => {
    const client = makeClient(makeRoutine());
    // NOT_FOUND resolves to null via useSchedule's isNotFound handling —
    // simulate the resolved-null directly.
    client.routine.getByReference.mockResolvedValue(null);
    renderView(client);

    await screen.findByText("Schedule not found");
  });

  it("keeps the caller's schedule untouched when toggling (immutability)", async () => {
    const routine = makeRoutine({ enabled: false });
    const original = clone(RoutineSchema, routine);
    const client = makeClient(routine);
    renderView(client);

    await screen.findByText("Schedule is disabled");
    fireEvent.click(screen.getByRole("button", { name: "Enable schedule" }));
    await waitFor(() => expect(client.routine.update).toHaveBeenCalledOnce());

    expect(routine.spec?.enabled).toBe(original.spec?.enabled);
  });

  // -------------------------------------------------------------------------
  // Cadence humanization
  // -------------------------------------------------------------------------

  it("falls back to the raw cron for expressions outside the builder's shapes", async () => {
    renderView(makeClient(makeRoutine({ cron: "*/5 9-17 * * 1-5" })));

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    // Unrecognized shape: the raw expression IS the primary display —
    // no invented sentence — with the time zone shown alongside.
    expect(screen.getByText("*/5 9-17 * * 1-5")).toBeTruthy();
    expect(screen.getByText("Asia/Kolkata")).toBeTruthy();
    expect(screen.queryByText(/^Every /)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Failure streak
  // -------------------------------------------------------------------------

  it("renders a plain 0 for a healthy failure streak", async () => {
    renderView(makeClient(makeRoutine()));

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    expect(screen.getByText("Failure streak")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.queryByText(/consecutive failed/)).toBeNull();
  });

  it("explains a non-zero failure streak in plain language", async () => {
    renderView(makeClient(makeRoutine({ consecutiveFailures: 2 })));

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    expect(screen.getByText("2 consecutive failed runs")).toBeTruthy();
    // The copy stays qualitative: the pause threshold is server config
    // the API does not expose, so no hardcoded denominator.
    expect(
      screen.getByText(/pauses the schedule automatically/),
    ).toBeTruthy();
    expect(screen.getByText(/Manual runs never count/)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Tabs — Overview and the paginated History tab
  // -------------------------------------------------------------------------

  it("splits into Overview and History tabs, with the recent fires' count as badge", async () => {
    const client = makeClient(makeRoutine());
    client.routine.listFires.mockResolvedValue(
      create(RoutineFireListSchema, {
        entries: [
          create(RoutineFireSchema, {
            routineId: "sch_01example",
            origin: RoutineFireOrigin.SCHEDULE,
            outcome: RoutineFireOutcome.COMPLETED,
            nominalFireTime: timestampFromDate(new Date(NOW.getTime() - 60_000)),
          }),
        ],
        nextPageToken: "",
      }),
    );
    renderView(client);

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    // The badge fills in once the (separate) fires fetch resolves.
    await waitFor(() => {
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((t) => t.textContent)).toEqual(["Overview", "History1"]);
    });
    // Overview is the default: definition on screen, no full table.
    expect(screen.getByText("Target agent")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    await screen.findByRole("table", { name: "Fire history" });
    expect(screen.queryByText("Target agent")).toBeNull();
  });

  it("pages through the fire history next and previous, by token", async () => {
    const client = makeClient(makeRoutine());
    client.routine.listFires.mockImplementation(pagedFires(30));
    renderView(client);

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    await screen.findByText("Page 1");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      const pageTwoCall = client.routine.listFires.mock.calls.find((call) => {
        const req = call[0] as { pageSize: number; pageToken: string };
        return req.pageToken === "after_25" && req.pageSize === 25;
      });
      expect(pageTwoCall).toBeTruthy();
    });
    await screen.findByText("Page 2");
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("Page 1");
  });

  it("links the Overview recent-fires strip to the History tab when older fires follow", async () => {
    const client = makeClient(makeRoutine());
    client.routine.listFires.mockImplementation(pagedFires(12));
    renderView(client);

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(await screen.findByRole("button", { name: "View all fires" }));
    await screen.findByRole("table", { name: "Fire history" });
  });

  // -------------------------------------------------------------------------
  // Inline editing — every save names the spec fields it changed, sending
  // the edited spec as loaded otherwise
  // -------------------------------------------------------------------------

  it("does not offer inline editing without the editable prop", async () => {
    renderView(makeClient(makeRoutine()));

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByText("Send today's fee reminders."));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit cadence" })).toBeNull();
  });

  it("renames the schedule from its slug field, for whoever may delete it, and reports the new slug", async () => {
    const client = makeClient(makeRoutine());
    client.grant.checkMyPermission.mockResolvedValue({ isAuthorized: true });
    const onRenamed = vi.fn();
    renderView(client, { editable: true, onRenamed });

    const field = await screen.findByLabelText("Slug");
    expect(client.grant.checkMyPermission).toHaveBeenCalledWith(
      expect.objectContaining({ relation: "can_delete" }),
    );
    fireEvent.change(field, { target: { value: "weekly-fee-reminders" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(onRenamed).toHaveBeenCalledOnce());
    expect(client.routine.rename.mock.calls[0]![0]).toMatchObject({
      resourceId: "sch_01example",
      slug: "weekly-fee-reminders",
    });
    expect(onRenamed.mock.calls[0]![0].metadata.slug).toBe("weekly-fee-reminders");
  });

  it("offers no slug field to a caller who may not delete the schedule", async () => {
    renderView(makeClient(makeRoutine()), { editable: true });
    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("never offers an edit affordance for the immutable target agent", async () => {
    renderView(makeClient(makeRoutine()), { editable: true });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    // The mutable fields have editors; the server-immutable target does not.
    expect(screen.getByRole("button", { name: "Edit cadence" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /edit target/i }),
    ).toBeNull();
  });

  it("saves an edited message by naming the target it changed, on the schedule's id", async () => {
    const client = makeClient(makeRoutine());
    renderView(client, { editable: true });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByText("Send today's fee reminders."));
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "Send this week's fee reminders." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.routine.update).toHaveBeenCalledOnce());
    const doc = { message: sentUpdate<Routine>(client.routine.update).resource };
    const target =
      doc.message.spec?.target?.case === "agent"
        ? doc.message.spec.target.value
        : undefined;
    expect(target?.message).toBe("Send this week's fee reminders.");
    // The one changed field by its path, on the schedule's id; the rest of
    // the edited spec is sent as loaded.
    expect(sentUpdate<Routine>(client.routine.update).paths).toEqual(["spec.agent"]);
    expect(doc.message.metadata?.id).toBe("sch_01example");
    expect(doc.message.spec?.cron).toBe("0 9 * * *");
    expect(doc.message.spec?.enabled).toBe(true);
    expect(target?.agentRef?.slug).toBe("fee-reminder");
  });

  it("saves an edited cadence through the custom-cron escape hatch", async () => {
    const client = makeClient(makeRoutine());
    renderView(client, { editable: true });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "Edit cadence" }));
    // The stored cron round-trips into the preset picker; Custom
    // prefills from it rather than starting blank.
    fireEvent.click(screen.getByRole("radio", { name: "Custom cron" }));
    fireEvent.change(screen.getByLabelText("Cron expression"), {
      target: { value: "0 9 * * 1-5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.routine.update).toHaveBeenCalledOnce());
    const doc = { message: sentUpdate<Routine>(client.routine.update).resource };
    expect(doc.message.spec?.cron).toBe("0 9 * * 1-5");
    // The time zone rides along with the cadence editor, unchanged here.
    expect(doc.message.spec?.timeZone).toBe("Asia/Kolkata");
  });

  it("saves an edited budget, preserving the model and the API-only tool bounds", async () => {
    const client = makeClient(
      makeRoutine({
        harness: Harness.CURSOR,
        runConfig: { modelName: "composer-2", maxToolRounds: 15, maxToolResultChars: 12000 },
      }),
    );
    renderView(client, { editable: true });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "Edit budget" }));
    fireEvent.change(screen.getByLabelText("Budget per run (USD)"), {
      target: { value: "2.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.routine.update).toHaveBeenCalledOnce());
    const doc = { message: sentUpdate<Routine>(client.routine.update).resource };
    const target =
      doc.message.spec?.target?.case === "agent"
        ? doc.message.spec.target.value
        : undefined;
    expect(target?.runConfig?.maxCostUsd).toBe(2.5);
    // The budget editor owns exactly one field — everything else the
    // run config stores survives the save.
    expect(target?.runConfig?.modelName).toBe("composer-2");
    expect(target?.runConfig?.maxToolRounds).toBe(15);
    expect(target?.runConfig?.maxToolResultChars).toBe(12000);
    expect(target?.harness).toBe(Harness.CURSOR);
  });

  it("a budget-only edit keeps a stored explicit standard tier and disabled thinking", async () => {
    const client = makeClient(
      makeRoutine({
        harness: Harness.CURSOR,
        runConfig: {
          modelName: "composer-2",
          serviceTier: ServiceTier.STANDARD,
          thinkingMode: ThinkingMode.DISABLED,
        },
      }),
    );
    renderView(client, { editable: true });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "Edit budget" }));
    fireEvent.change(screen.getByLabelText("Budget per run (USD)"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.routine.update).toHaveBeenCalledOnce());
    const doc = { message: sentUpdate<Routine>(client.routine.update).resource };
    const target =
      doc.message.spec?.target?.case === "agent"
        ? doc.message.spec.target.value
        : undefined;
    expect(target?.runConfig?.maxCostUsd).toBe(4);
    expect(target?.runConfig?.serviceTier).toBe(ServiceTier.STANDARD);
    expect(target?.runConfig?.thinkingMode).toBe(ThinkingMode.DISABLED);
  });

  it("an engine save that changes nothing writes nothing, so the stored tier and thinking stay", async () => {
    const client = makeClient(
      makeRoutine({
        harness: Harness.CURSOR,
        runConfig: {
          modelName: "composer-2",
          serviceTier: ServiceTier.STANDARD,
          thinkingMode: ThinkingMode.DISABLED,
        },
      }),
    );
    renderView(client, { editable: true });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(
      screen.getByRole("button", { name: "Edit engine and model" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The save names no changed field, so no update is sent: the stored
    // tier and thinking cannot be touched.
    await act(async () => {});
    expect(client.routine.update).not.toHaveBeenCalled();
  });

  it("resetting engine & model drops the stored tier and thinking with the model", async () => {
    const client = makeClient(
      makeRoutine({
        harness: Harness.CURSOR,
        runConfig: {
          modelName: "composer-2",
          maxCostUsd: 1,
          serviceTier: ServiceTier.FAST,
          thinkingMode: ThinkingMode.ENABLED,
        },
      }),
    );
    renderView(client, { editable: true });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(
      screen.getByRole("button", { name: "Edit engine and model" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reset to platform default" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.routine.update).toHaveBeenCalledOnce());
    const doc = { message: sentUpdate<Routine>(client.routine.update).resource };
    const target =
      doc.message.spec?.target?.case === "agent"
        ? doc.message.spec.target.value
        : undefined;
    expect(target?.runConfig?.serviceTier).toBe(ServiceTier.UNSPECIFIED);
    expect(target?.runConfig?.thinkingMode).toBe(ThinkingMode.UNSPECIFIED);
    expect(target?.runConfig?.maxCostUsd).toBe(1);
  });

  it("resetting engine & model unpins both, preserving the budget", async () => {
    const client = makeClient(
      makeRoutine({
        harness: Harness.CURSOR,
        runConfig: { modelName: "composer-2", maxCostUsd: 2.5 },
      }),
    );
    renderView(client, { editable: true });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    // The read view names the pinned engine and model.
    expect(screen.getByText("Cursor · composer-2")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit engine and model" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reset to platform default" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.routine.update).toHaveBeenCalledOnce());
    const doc = { message: sentUpdate<Routine>(client.routine.update).resource };
    const target =
      doc.message.spec?.target?.case === "agent"
        ? doc.message.spec.target.value
        : undefined;
    // Model and harness are one atomic choice: unpinning the model
    // unpins the engine with it (the platform defaults apply again)...
    expect(target?.harness).toBe(Harness.UNSPECIFIED);
    expect(target?.runConfig?.modelName).toBe("");
    // ...while the budget the editor does not own survives.
    expect(target?.runConfig?.maxCostUsd).toBe(2.5);
  });

  it("round-trips vault references with the vault kind stamped", async () => {
    const routine = makeRoutine({
      vaults: [{ org: "isc", slug: "isc-mcp-credentials" }],
    });
    // A reference stored before kinds were stamped: the editor's save
    // stamps it, so the save changes the vaults.
    if (routine.spec?.target.case === "agent") {
      routine.spec.target.value.vaults[0]!.kind = ApiResourceKind.api_resource_kind_unknown;
    }
    const client = makeClient(routine);
    renderView(client, { editable: true });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "Edit vaults" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.routine.update).toHaveBeenCalledOnce());
    const doc = { message: sentUpdate<Routine>(client.routine.update).resource };
    const target =
      doc.message.spec?.target?.case === "agent"
        ? doc.message.spec.target.value
        : undefined;
    expect(target?.vaults).toHaveLength(1);
    expect(target?.vaults?.[0].slug).toBe("isc-mcp-credentials");
    expect(target?.vaults?.[0].kind).toBe(ApiResourceKind.vault);
  });

  it("offers My vault in the vaults editor to the schedule's creator only", async () => {
    const vaults = {
      entries: [
        {
          metadata: { name: "My vault", slug: "my-vault-viewer", org: "isc" },
          spec: { owner: { case: "person", value: VIEWER_ID } },
        },
        {
          metadata: { name: "Team keys", slug: "team-keys", org: "isc" },
          spec: { owner: { case: "org", value: "isc" } },
        },
      ],
      nextPageToken: "",
    };
    const openVaultsEditor = async (createdBy: string): Promise<MockClient> => {
      const client = makeClient(makeRoutine({ createdBy }));
      client.vault.list.mockResolvedValue(vaults);
      renderView(client, { editable: true });
      await screen.findByRole("heading", { name: "daily-fee-reminders" });
      fireEvent.click(screen.getByRole("button", { name: "Edit vaults" }));
      await screen.findByRole("option", { name: "Team keys" });
      return client;
    };

    await openVaultsEditor(VIEWER_ID);
    expect(await screen.findByRole("option", { name: "My vault" })).toBeTruthy();
    cleanup();

    const client = await openVaultsEditor("ida_creator");
    const whoAmI = client.identityAccount.whoAmI;
    await waitFor(() => expect(whoAmI).toHaveBeenCalled());
    await act(async () => {
      await whoAmI.mock.results[0]?.value;
    });
    expect(screen.queryByRole("option", { name: "My vault" })).toBeNull();
  });

  it("keeps the editor open with the server's message on a failed save", async () => {
    const client = makeClient(makeRoutine());
    client.routine.update.mockRejectedValueOnce(
      new Error("spec.cron must have exactly 5 fields"),
    );
    renderView(client, { editable: true });

    await screen.findByRole("heading", { name: "daily-fee-reminders" });
    fireEvent.click(screen.getByRole("button", { name: "Edit cadence" }));
    fireEvent.click(screen.getByRole("radio", { name: "Custom cron" }));
    fireEvent.change(screen.getByLabelText("Cron expression"), {
      target: { value: "0 9 * *" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The server's message lands next to the field; the editor stays
    // open so the draft is not lost.
    await screen.findByText(/must have exactly 5 fields/);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
