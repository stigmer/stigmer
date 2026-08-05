import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { clone, create, equals } from "@bufbuild/protobuf";
import { ScheduleSchema, type Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ScheduleListSchema,
  ScheduleTriggerResultSchema,
  ScheduleRunListSchema,
  ScheduleRunSchema,
  ScheduleRunOutcome,
  ScheduleRunOrigin,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { StigmerError } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useSchedule } from "../useSchedule";
import { useScheduleList } from "../useScheduleList";
import { useScheduleCount } from "../useScheduleCount";
import { useResumeSchedule } from "../useResumeSchedule";
import { useTriggerSchedule } from "../useTriggerSchedule";
import { useScheduleRuns } from "../useScheduleRuns";
import { useSetScheduleEnabled } from "../useSetScheduleEnabled";

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
      create(ScheduleListSchema, { items: [SCHEDULE], totalCount: 1 }),
    );
    const client = { schedule: { list } };

    const { result } = renderHook(() => useScheduleList("isc"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.schedules).toHaveLength(1);
    expect(result.current.schedules[0].spec?.cron).toBe("0 9 * * *");
    expect(result.current.totalCount).toBe(1);
    expect(result.current.totalPages).toBe(1);
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
  it("reads only the total count", async () => {
    const list = vi.fn().mockResolvedValue(
      create(ScheduleListSchema, { items: [SCHEDULE], totalCount: 7 }),
    );
    const client = { schedule: { list } };

    const { result } = renderHook(() => useScheduleCount("isc"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.count).toBe(7);
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
      outcome: ScheduleRunOutcome.STARTED,
      executionId: "aex_01run",
      schedule: SCHEDULE,
    });
    const trigger = vi.fn().mockResolvedValue(started);
    const client = { schedule: { trigger } };

    const { result } = renderHook(() => useTriggerSchedule(), {
      wrapper: wrapper(client),
    });

    const res = await result.current.triggerSchedule("sch_01example");

    expect(trigger).toHaveBeenCalledWith("sch_01example");
    expect(res.outcome).toBe(ScheduleRunOutcome.STARTED);
    expect(res.executionId).toBe("aex_01run");
    expect(toast.success).toHaveBeenCalledWith("Run started");
  });

  it("resolves a REFUSED result and toasts the gate's reason verbatim", async () => {
    // A refused run is a SUCCESSFUL trigger honestly reported (DD-017
    // D-6): the promise resolves, and the gate's own copy is surfaced,
    // never paraphrased.
    const refused = create(ScheduleTriggerResultSchema, {
      outcome: ScheduleRunOutcome.REFUSED,
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

    expect(res.outcome).toBe(ScheduleRunOutcome.REFUSED);
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

describe("useScheduleRuns", () => {
  it("fetches a schedule's run history, newest first", async () => {
    const listRuns = vi.fn().mockResolvedValue(
      create(ScheduleRunListSchema, {
        totalCount: 2,
        items: [
          create(ScheduleRunSchema, {
            scheduleId: "sch_01example",
            origin: ScheduleRunOrigin.MANUAL,
            outcome: ScheduleRunOutcome.STARTED,
            executionId: "aex_01run",
          }),
          create(ScheduleRunSchema, {
            scheduleId: "sch_01example",
            origin: ScheduleRunOrigin.CRON,
            outcome: ScheduleRunOutcome.REFUSED,
            reason: "run refused: missing credential",
          }),
        ],
      }),
    );
    const client = { schedule: { listRuns } };

    const { result } = renderHook(() => useScheduleRuns("sch_01example"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.runs).toHaveLength(2);
    expect(result.current.totalCount).toBe(2);
    expect(result.current.runs[1].reason).toBe("run refused: missing credential");
  });

  it("skips fetching when scheduleId is null", () => {
    const listRuns = vi.fn();
    const client = { schedule: { listRuns } };

    const { result } = renderHook(() => useScheduleRuns(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.runs).toEqual([]);
    expect(listRuns).not.toHaveBeenCalled();
  });
});

describe("useSetScheduleEnabled", () => {
  it("re-applies the full proto with only spec.enabled flipped", async () => {
    const apply = vi.fn(async (doc: { message: unknown }) => ({
      yamlKind: "Schedule",
      displayName: "Schedule",
      name: "daily-fee-reminders",
      slug: "daily-fee-reminders",
      org: "isc",
      id: "sch_01example",
      message: doc.message,
    }));
    const client = { manifest: { apply } };

    const { result } = renderHook(() => useSetScheduleEnabled(), {
      wrapper: wrapper(client),
    });

    const applied = await result.current.setEnabled(SCHEDULE, false);

    // The apply went through the manifest engine with a real
    // ManifestDocument (registry handler resolved from the proto type).
    expect(apply).toHaveBeenCalledOnce();
    const doc = apply.mock.calls[0][0] as {
      handler: { yamlKind: string };
      message: Schedule;
    };
    expect(doc.handler.yamlKind).toBe("Schedule");

    // Round-trip field preservation: everything survives except the
    // flipped flag. In particular metadata.tags — the field the curated
    // ScheduleInput path would have silently wiped.
    const expected = clone(ScheduleSchema, SCHEDULE);
    expected.spec!.enabled = false;
    expect(equals(ScheduleSchema, doc.message, expected)).toBe(true);
    expect(doc.message.metadata?.tags).toEqual(["billing"]);

    // The caller's copy is never mutated.
    expect(SCHEDULE.spec?.enabled).toBe(true);

    expect((applied as Schedule).spec?.enabled).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Schedule disabled");
  });

  it("toasts 'enabled' when turning the schedule on", async () => {
    const disabled = clone(ScheduleSchema, SCHEDULE);
    disabled.spec!.enabled = false;
    const apply = vi.fn(async (doc: { message: unknown }) => ({
      yamlKind: "Schedule",
      displayName: "Schedule",
      name: "daily-fee-reminders",
      slug: "daily-fee-reminders",
      org: "isc",
      id: "sch_01example",
      message: doc.message,
    }));
    const client = { manifest: { apply } };

    const { result } = renderHook(() => useSetScheduleEnabled(), {
      wrapper: wrapper(client),
    });

    await result.current.setEnabled(disabled, true);
    expect(toast.success).toHaveBeenCalledWith("Schedule enabled");
  });

  it("rejects a schedule without a spec", async () => {
    const bare = create(ScheduleSchema, {
      metadata: { name: "x", org: "isc" },
    });
    const client = { manifest: { apply: vi.fn() } };

    const { result } = renderHook(() => useSetScheduleEnabled(), {
      wrapper: wrapper(client),
    });

    await expect(result.current.setEnabled(bare, true)).rejects.toThrow(/no spec/);
    expect(client.manifest.apply).not.toHaveBeenCalled();
  });
});
