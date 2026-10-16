import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { clone, create, equals } from "@bufbuild/protobuf";
import { ScheduleSchema, type Schedule } from "@stigmer/apis/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ScheduleListSchema,
  ScheduleTriggerResultSchema,
  ScheduleFireListSchema,
  ScheduleFireSchema,
  ScheduleFireOutcome,
  ScheduleFireOrigin,
} from "@stigmer/apis/ai/stigmer/agentic/schedule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { StigmerError } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useSchedule } from "../useSchedule";
import { useScheduleList } from "../useScheduleList";
import { useScheduleCount } from "../useScheduleCount";
import { useResumeSchedule } from "../useResumeSchedule";
import { useTriggerSchedule } from "../useTriggerSchedule";
import { useScheduleFires } from "../useScheduleFires";
import { useSetScheduleEnabled } from "../useSetScheduleEnabled";
import { useUpdateScheduleSpec } from "../useUpdateScheduleSpec";

vi.mock("../../feedback/toast", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { toast } from "../../feedback/toast";

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

// Shaped like a server-returned schedule, including metadata the curated
// ScheduleInput cannot express (tags) — the round-trip canary.
const SCHEDULE = create(ScheduleSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Schedule",
  metadata: {
    id: "sch_01example",
    name: "daily-fee-reminders",
    slug: "daily-fee-reminders",
    org: "isc",
    tags: ["billing"],
    labels: { team: "ops" },
  },
  spec: {
    cron: "0 9 * * *",
    timeZone: "Asia/Kolkata",
    enabled: true,
    target: {
      case: "agent",
      value: {
        agentRef: { kind: ApiResourceKind.agent, org: "isc", slug: "fee-reminder" },
        message: "Send today's fee reminders.",
      },
    },
  },
  status: { consecutiveFailures: 2 },
});

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

describe("useSchedule", () => {
  it("fetches a schedule by org/slug reference", async () => {
    const getByReference = vi.fn().mockResolvedValue(SCHEDULE);
    const client = { schedule: { getByReference } };

    const { result } = renderHook(() => useSchedule("isc", "daily-fee-reminders"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.schedule).toBe(SCHEDULE);
    expect(result.current.error).toBeNull();
    expect(getByReference).toHaveBeenCalledWith({
      org: "isc",
      slug: "daily-fee-reminders",
    });
  });

  it("treats NOT_FOUND as null, not an error", async () => {
    // Positional ctor: (code, message, connectCode) — 5 is Connect NotFound.
    const notFound = new StigmerError("not-found", "Schedule 'x' not found", 5);
    const client = {
      schedule: { getByReference: vi.fn().mockRejectedValue(notFound) },
    };

    const { result } = renderHook(() => useSchedule("isc", "x"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.schedule).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("skips fetching when org or slug is null", () => {
    const getByReference = vi.fn();
    const client = { schedule: { getByReference } };

    const { result } = renderHook(() => useSchedule(null, "x"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(getByReference).not.toHaveBeenCalled();
  });
});

describe("useScheduleList", () => {
  it("fetches a page of full Schedule protos", async () => {
    const list = vi.fn().mockResolvedValue(
      create(ScheduleListSchema, { entries: [SCHEDULE]}),
    );
    const client = { schedule: { list } };

    const { result } = renderHook(() => useScheduleList("isc"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.schedules).toHaveLength(1);
    expect(result.current.schedules[0].spec?.cron).toBe("0 9 * * *");
    expect(result.current.hasMore).toBe(false);
  });

  it("skips fetching when org is null", () => {
    const list = vi.fn();
    const client = { schedule: { list } };

    const { result } = renderHook(() => useScheduleList(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.schedules).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("useScheduleCount", () => {
  it("counts the largest first page and says whether more follow", async () => {
    const list = vi.fn().mockResolvedValue(
      create(ScheduleListSchema, { entries: [SCHEDULE], nextPageToken: "tok_2" }),
    );
    const client = { schedule: { list } };

    const { result } = renderHook(() => useScheduleCount("isc"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.count).toBe(1);
    expect(result.current.isLowerBound).toBe(true);
    expect(list.mock.calls[0][0].pageSize).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Behavior hooks
// ---------------------------------------------------------------------------

describe("useResumeSchedule", () => {
  it("resumes by id and toasts success", async () => {
    const resume = vi.fn().mockResolvedValue(SCHEDULE);
    const client = { schedule: { resume } };

    const { result } = renderHook(() => useResumeSchedule(), {
      wrapper: wrapper(client),
    });

    const resumed = await result.current.resumeSchedule("sch_01example");

    expect(resumed).toBe(SCHEDULE);
    expect(resume).toHaveBeenCalledWith("sch_01example");
    expect(toast.success).toHaveBeenCalledWith("Schedule resumed");
  });

  it("relays a failure and sets error state", async () => {
    const failure = new Error("boom");
    const client = { schedule: { resume: vi.fn().mockRejectedValue(failure) } };

    const { result } = renderHook(() => useResumeSchedule(), {
      wrapper: wrapper(client),
    });

    await expect(result.current.resumeSchedule("sch_x")).rejects.toThrow("boom");
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("useTriggerSchedule", () => {
  it("resolves a STARTED result and toasts success", async () => {
    const started = create(ScheduleTriggerResultSchema, {
      outcome: ScheduleFireOutcome.STARTED,
      runId: "aex_01run",
      schedule: SCHEDULE,
    });
    const trigger = vi.fn().mockResolvedValue(started);
    const client = { schedule: { trigger } };

    const { result } = renderHook(() => useTriggerSchedule(), {
      wrapper: wrapper(client),
    });

    const res = await result.current.triggerSchedule("sch_01example");

    expect(trigger).toHaveBeenCalledWith("sch_01example");
    expect(res.outcome).toBe(ScheduleFireOutcome.STARTED);
    expect(res.runId).toBe("aex_01run");
    expect(toast.success).toHaveBeenCalledWith("Run started");
  });

  it("resolves a REFUSED result and toasts the gate's reason verbatim", async () => {
    // A refused run is a SUCCESSFUL trigger honestly reported: the
    // promise resolves, and the gate's own copy is surfaced,
    // never paraphrased.
    const refused = create(ScheduleTriggerResultSchema, {
      outcome: ScheduleFireOutcome.REFUSED,
      refusalReason:
        "run refused: The organization cannot fund a scheduled run right now.",
      schedule: SCHEDULE,
    });
    const trigger = vi.fn().mockResolvedValue(refused);
    const client = { schedule: { trigger } };

    const { result } = renderHook(() => useTriggerSchedule(), {
      wrapper: wrapper(client),
    });

    const res = await result.current.triggerSchedule("sch_01example");

    expect(res.outcome).toBe(ScheduleFireOutcome.REFUSED);
    expect(toast.error).toHaveBeenCalledWith(
      "run refused: The organization cannot fund a scheduled run right now.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("relays a trigger-level gRPC refusal (disabled) verbatim and rejects", async () => {
    // A disabled schedule is refused at the trigger itself — a gRPC
    // error, not a result. Copy is byte-identical across editions.
    const refusal = new StigmerError(
      "failed-precondition",
      "schedule is disabled (spec.enabled=false) — enable it before triggering",
      9, // Connect FailedPrecondition
    );
    const client = { schedule: { trigger: vi.fn().mockRejectedValue(refusal) } };

    const { result } = renderHook(() => useTriggerSchedule(), {
      wrapper: wrapper(client),
    });

    await expect(result.current.triggerSchedule("sch_x")).rejects.toThrow();
    expect(toast.error).toHaveBeenCalledWith(
      "schedule is disabled (spec.enabled=false) — enable it before triggering",
    );
  });
});

describe("useScheduleFires", () => {
  it("fetches a schedule's run history, newest first", async () => {
    const listFires = vi.fn().mockResolvedValue(
      create(ScheduleFireListSchema, {
        entries: [
          create(ScheduleFireSchema, {
            scheduleId: "sch_01example",
            origin: ScheduleFireOrigin.MANUAL,
            outcome: ScheduleFireOutcome.STARTED,
            runId: "aex_01run",
          }),
          create(ScheduleFireSchema, {
            scheduleId: "sch_01example",
            origin: ScheduleFireOrigin.CRON,
            outcome: ScheduleFireOutcome.REFUSED,
            reason: "run refused: missing credential",
          }),
        ],
        nextPageToken: "",
      }),
    );
    const client = { schedule: { listFires } };

    const { result } = renderHook(() => useScheduleFires("sch_01example"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.fires).toHaveLength(2);
    expect(result.current.hasNext).toBe(false);
    expect(result.current.pageNumber).toBe(1);
    expect(result.current.fires[1].reason).toBe("run refused: missing credential");
  });

  it("pages next and previous by token", async () => {
    const fire = (reason: string) =>
      create(ScheduleFireSchema, { scheduleId: "sch_01example", reason });
    const listFires = vi.fn((input: { pageToken: string }) =>
      Promise.resolve(
        input.pageToken === ""
          ? create(ScheduleFireListSchema, { entries: [fire("newest")], nextPageToken: "tok_2" })
          : create(ScheduleFireListSchema, { entries: [fire("older")], nextPageToken: "" }),
      ),
    );
    const client = { schedule: { listFires } };

    const { result } = renderHook(() => useScheduleFires("sch_01example", { pageSize: 1 }), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.fires[0]?.reason).toBe("newest"));
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrevious).toBe(false);

    act(() => result.current.next());
    await waitFor(() => expect(result.current.fires[0]?.reason).toBe("older"));
    expect(result.current.pageNumber).toBe(2);
    expect(result.current.hasNext).toBe(false);
    expect(result.current.hasPrevious).toBe(true);
    expect(listFires.mock.calls[1][0].pageToken).toBe("tok_2");

    act(() => result.current.previous());
    await waitFor(() => expect(result.current.fires[0]?.reason).toBe("newest"));
    expect(result.current.pageNumber).toBe(1);
  });

  it("skips fetching when scheduleId is null", () => {
    const listFires = vi.fn();
    const client = { schedule: { listFires } };

    const { result } = renderHook(() => useScheduleFires(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.fires).toEqual([]);
    expect(listFires).not.toHaveBeenCalled();
  });
});

describe("useSetScheduleEnabled", () => {
  it("names spec.enabled alone, on the schedule's id and the etag it was loaded at", async () => {
    const loaded = clone(ScheduleSchema, SCHEDULE);
    loaded.metadata!.etag = "etag-at-load";
    const update = vi.fn(async (resource: Schedule, _paths: string[]) => {
      const stored = clone(ScheduleSchema, SCHEDULE);
      stored.spec!.enabled = resource.spec?.enabled ?? false;
      return stored;
    });
    const client = { schedule: { update } };

    const { result } = renderHook(() => useSetScheduleEnabled(), {
      wrapper: wrapper(client),
    });

    const updated = await result.current.setEnabled(loaded, false);

    // The flag alone: every other field (the tags, the cron, the target)
    // keeps its stored value without being sent back.
    const sent = sentUpdate<Schedule>(update);
    expect(sent.paths).toEqual(["spec.enabled"]);
    expect(sent.resource.spec?.enabled).toBe(false);
    expect(sent.id).toBe("sch_01example");
    expect(sent.etag).toBe("etag-at-load");

    // The caller's copy is never mutated.
    expect(loaded.spec?.enabled).toBe(true);

    expect(updated.spec?.enabled).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Schedule disabled");
  });

  it("toasts 'enabled' when turning the schedule on", async () => {
    const disabled = clone(ScheduleSchema, SCHEDULE);
    disabled.spec!.enabled = false;
    const update = vi.fn(async () => SCHEDULE);
    const client = { schedule: { update } };

    const { result } = renderHook(() => useSetScheduleEnabled(), {
      wrapper: wrapper(client),
    });

    await result.current.setEnabled(disabled, true);
    expect(toast.success).toHaveBeenCalledWith("Schedule enabled");
  });

  it("says to reload a schedule changed since it was loaded", async () => {
    const changed = new ConnectError("Schedule 'isc/daily-fee-reminders' changed since you read it", Code.Aborted, undefined, [
      { desc: ErrorInfoSchema, value: { domain: "stigmer.ai", reason: "ETAG_MISMATCH", metadata: {} } },
    ]);
    const client = { schedule: { update: vi.fn().mockRejectedValue(changed) } };

    const { result } = renderHook(() => useSetScheduleEnabled(), {
      wrapper: wrapper(client),
    });

    await expect(result.current.setEnabled(SCHEDULE, false)).rejects.toThrow();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^This schedule changed since you opened it/));
  });
});

describe("useUpdateScheduleSpec", () => {
  it("names only the spec field the edit changed, sends nothing for no change, and says to reload a schedule changed since", async () => {
    const update = vi.fn(async () => SCHEDULE);
    const client = { schedule: { update } };
    const { result } = renderHook(() => useUpdateScheduleSpec(), { wrapper: wrapper(client) });

    await result.current.updateSpec(SCHEDULE, (spec) => {
      spec.cron = "0 10 * * *";
    });
    const sent = sentUpdate<Schedule>(update);
    expect(sent.paths).toEqual(["spec.cron"]);
    expect(sent.resource.metadata?.id).toBe("sch_01example");

    await result.current.updateSpec(SCHEDULE, () => {});
    expect(update).toHaveBeenCalledTimes(1);

    update.mockRejectedValueOnce(
      new ConnectError("changed", Code.Aborted, undefined, [
        { desc: ErrorInfoSchema, value: { domain: "stigmer.ai", reason: "ETAG_MISMATCH", metadata: {} } },
      ]),
    );
    await expect(
      result.current.updateSpec(SCHEDULE, (spec) => {
        spec.timeZone = "UTC";
      }),
    ).rejects.toThrow(/^This schedule changed since you opened it/);
  });
});
