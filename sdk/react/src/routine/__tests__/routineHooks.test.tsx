import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { clone, create, equals } from "@bufbuild/protobuf";
import { RoutineSchema, type Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  RoutineListSchema,
  RoutineFireResultSchema,
  RoutineFireListSchema,
  RoutineFireSchema,
  RoutineFireOutcome,
  RoutineFireOrigin,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { StigmerError } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useRoutine } from "../useRoutine";
import { useRoutineList } from "../useRoutineList";
import { useRoutineCount } from "../useRoutineCount";
import { useResumeRoutine } from "../useResumeRoutine";
import { useFireRoutine } from "../useFireRoutine";
import { useRoutineFires } from "../useRoutineFires";
import { useSetRoutineEnabled } from "../useSetRoutineEnabled";
import { useUpdateRoutineSpec } from "../useUpdateRoutineSpec";

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

// Shaped like a server-returned routine, including metadata the curated
// RoutineInput cannot express (tags) — the round-trip canary.
const ROUTINE = create(RoutineSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Routine",
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
    agent: {
        agentRef: { kind: ApiResourceKind.agent, org: "isc", slug: "fee-reminder" },
        message: "Send today's fee reminders.",
      },
  },
  status: { consecutiveFailures: 2 },
});

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

describe("useRoutine", () => {
  it("fetches a routine by org/slug reference", async () => {
    const getByReference = vi.fn().mockResolvedValue(ROUTINE);
    const client = { routine: { getByReference } };

    const { result } = renderHook(() => useRoutine("isc", "daily-fee-reminders"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.routine).toBe(ROUTINE);
    expect(result.current.error).toBeNull();
    expect(getByReference).toHaveBeenCalledWith({
      org: "isc",
      slug: "daily-fee-reminders",
    });
  });

  it("treats NOT_FOUND as null, not an error", async () => {
    // Positional ctor: (code, message, connectCode) — 5 is Connect NotFound.
    const notFound = new StigmerError("not-found", "Routine 'x' not found", 5);
    const client = {
      routine: { getByReference: vi.fn().mockRejectedValue(notFound) },
    };

    const { result } = renderHook(() => useRoutine("isc", "x"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.routine).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("skips fetching when org or slug is null", () => {
    const getByReference = vi.fn();
    const client = { routine: { getByReference } };

    const { result } = renderHook(() => useRoutine(null, "x"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(getByReference).not.toHaveBeenCalled();
  });
});

describe("useRoutineList", () => {
  it("fetches a page of full Routine protos", async () => {
    const list = vi.fn().mockResolvedValue(
      create(RoutineListSchema, { entries: [ROUTINE]}),
    );
    const client = { routine: { list } };

    const { result } = renderHook(() => useRoutineList("isc"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.routines).toHaveLength(1);
    expect(result.current.routines[0].spec?.cron).toBe("0 9 * * *");
    expect(result.current.hasMore).toBe(false);
  });

  it("skips fetching when org is null", () => {
    const list = vi.fn();
    const client = { routine: { list } };

    const { result } = renderHook(() => useRoutineList(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.routines).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("useRoutineCount", () => {
  it("counts the largest first page and says whether more follow", async () => {
    const list = vi.fn().mockResolvedValue(
      create(RoutineListSchema, { entries: [ROUTINE], nextPageToken: "tok_2" }),
    );
    const client = { routine: { list } };

    const { result } = renderHook(() => useRoutineCount("isc"), {
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

describe("useResumeRoutine", () => {
  it("resumes by id and toasts success", async () => {
    const resume = vi.fn().mockResolvedValue(ROUTINE);
    const client = { routine: { resume } };

    const { result } = renderHook(() => useResumeRoutine(), {
      wrapper: wrapper(client),
    });

    const resumed = await result.current.resumeRoutine("sch_01example");

    expect(resumed).toBe(ROUTINE);
    expect(resume).toHaveBeenCalledWith("sch_01example");
    expect(toast.success).toHaveBeenCalledWith("Routine resumed");
  });

  it("relays a failure and sets error state", async () => {
    const failure = new Error("boom");
    const client = { routine: { resume: vi.fn().mockRejectedValue(failure) } };

    const { result } = renderHook(() => useResumeRoutine(), {
      wrapper: wrapper(client),
    });

    await expect(result.current.resumeRoutine("sch_x")).rejects.toThrow("boom");
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("useFireRoutine", () => {
  it("resolves a STARTED result and toasts success", async () => {
    const started = create(RoutineFireResultSchema, {
      outcome: RoutineFireOutcome.STARTED,
      runId: "aex_01run",
      routine: ROUTINE,
    });
    const trigger = vi.fn().mockResolvedValue(started);
    const client = { routine: { fire: trigger } };

    const { result } = renderHook(() => useFireRoutine(), {
      wrapper: wrapper(client),
    });

    const res = await result.current.fireRoutine("sch_01example");

    expect(trigger).toHaveBeenCalledWith(expect.objectContaining({ id: "sch_01example" }));
    expect(res.outcome).toBe(RoutineFireOutcome.STARTED);
    expect(res.runId).toBe("aex_01run");
    expect(toast.success).toHaveBeenCalledWith("Run started");
  });

  it("resolves a REFUSED result and toasts the gate's reason verbatim", async () => {
    // A refused run is a SUCCESSFUL trigger honestly reported: the
    // promise resolves, and the gate's own copy is surfaced,
    // never paraphrased.
    const refused = create(RoutineFireResultSchema, {
      outcome: RoutineFireOutcome.REFUSED,
      refusalReason:
        "run refused: The organization cannot fund a scheduled run right now.",
      routine: ROUTINE,
    });
    const trigger = vi.fn().mockResolvedValue(refused);
    const client = { routine: { fire: trigger } };

    const { result } = renderHook(() => useFireRoutine(), {
      wrapper: wrapper(client),
    });

    const res = await result.current.fireRoutine("sch_01example");

    expect(res.outcome).toBe(RoutineFireOutcome.REFUSED);
    expect(toast.error).toHaveBeenCalledWith(
      "run refused: The organization cannot fund a scheduled run right now.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("relays a trigger-level gRPC refusal (disabled) verbatim and rejects", async () => {
    // A disabled routine is refused at the trigger itself — a gRPC
    // error, not a result. Copy is byte-identical across editions.
    const refusal = new StigmerError(
      "failed-precondition",
      "routine is disabled (spec.enabled=false) — enable it before firing",
      9, // Connect FailedPrecondition
    );
    const client = { routine: { fire: vi.fn().mockRejectedValue(refusal) } };

    const { result } = renderHook(() => useFireRoutine(), {
      wrapper: wrapper(client),
    });

    await expect(result.current.fireRoutine("sch_x")).rejects.toThrow();
    expect(toast.error).toHaveBeenCalledWith(
      "routine is disabled (spec.enabled=false) — enable it before firing",
    );
  });
});

describe("useRoutineFires", () => {
  it("fetches a routine's run history, newest first", async () => {
    const listFires = vi.fn().mockResolvedValue(
      create(RoutineFireListSchema, {
        entries: [
          create(RoutineFireSchema, {
            routineId: "sch_01example",
            origin: RoutineFireOrigin.MANUAL,
            outcome: RoutineFireOutcome.STARTED,
            runId: "aex_01run",
          }),
          create(RoutineFireSchema, {
            routineId: "sch_01example",
            origin: RoutineFireOrigin.SCHEDULE,
            outcome: RoutineFireOutcome.REFUSED,
            reason: "run refused: missing credential",
          }),
        ],
        nextPageToken: "",
      }),
    );
    const client = { routine: { listFires } };

    const { result } = renderHook(() => useRoutineFires("sch_01example"), {
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
      create(RoutineFireSchema, { routineId: "sch_01example", reason });
    const listFires = vi.fn((input: { pageToken: string }) =>
      Promise.resolve(
        input.pageToken === ""
          ? create(RoutineFireListSchema, { entries: [fire("newest")], nextPageToken: "tok_2" })
          : create(RoutineFireListSchema, { entries: [fire("older")], nextPageToken: "" }),
      ),
    );
    const client = { routine: { listFires } };

    const { result } = renderHook(() => useRoutineFires("sch_01example", { pageSize: 1 }), {
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

  it("skips fetching when routineId is null", () => {
    const listFires = vi.fn();
    const client = { routine: { listFires } };

    const { result } = renderHook(() => useRoutineFires(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.fires).toEqual([]);
    expect(listFires).not.toHaveBeenCalled();
  });
});

describe("useSetRoutineEnabled", () => {
  it("names spec.enabled alone, on the routine's id and the etag it was loaded at", async () => {
    const loaded = clone(RoutineSchema, ROUTINE);
    loaded.metadata!.etag = "etag-at-load";
    const update = vi.fn(async (resource: Routine, _paths: string[]) => {
      const stored = clone(RoutineSchema, ROUTINE);
      stored.spec!.enabled = resource.spec?.enabled ?? false;
      return stored;
    });
    const client = { routine: { update } };

    const { result } = renderHook(() => useSetRoutineEnabled(), {
      wrapper: wrapper(client),
    });

    const updated = await result.current.setEnabled(loaded, false);

    // The flag alone: every other field (the tags, the cron, the target)
    // keeps its stored value without being sent back.
    const sent = sentUpdate<Routine>(update);
    expect(sent.paths).toEqual(["spec.enabled"]);
    expect(sent.resource.spec?.enabled).toBe(false);
    expect(sent.id).toBe("sch_01example");
    expect(sent.etag).toBe("etag-at-load");

    // The caller's copy is never mutated.
    expect(loaded.spec?.enabled).toBe(true);

    expect(updated.spec?.enabled).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Routine disabled");
  });

  it("toasts 'enabled' when turning the routine on", async () => {
    const disabled = clone(RoutineSchema, ROUTINE);
    disabled.spec!.enabled = false;
    const update = vi.fn(async () => ROUTINE);
    const client = { routine: { update } };

    const { result } = renderHook(() => useSetRoutineEnabled(), {
      wrapper: wrapper(client),
    });

    await result.current.setEnabled(disabled, true);
    expect(toast.success).toHaveBeenCalledWith("Routine enabled");
  });

  it("says to reload a routine changed since it was loaded", async () => {
    const changed = new ConnectError("Routine 'isc/daily-fee-reminders' changed since you read it", Code.Aborted, undefined, [
      { desc: ErrorInfoSchema, value: { domain: "stigmer.ai", reason: "ETAG_MISMATCH", metadata: {} } },
    ]);
    const client = { routine: { update: vi.fn().mockRejectedValue(changed) } };

    const { result } = renderHook(() => useSetRoutineEnabled(), {
      wrapper: wrapper(client),
    });

    await expect(result.current.setEnabled(ROUTINE, false)).rejects.toThrow();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^This routine changed since you opened it/));
  });
});

describe("useUpdateRoutineSpec", () => {
  it("refuses a routine with no spec, sending nothing", async () => {
    const update = vi.fn(async () => ROUTINE);
    const { result } = renderHook(() => useUpdateRoutineSpec(), { wrapper: wrapper({ routine: { update } }) });
    const bare = clone(RoutineSchema, ROUTINE);
    bare.spec = undefined;
    await expect(result.current.updateSpec(bare, () => {})).rejects.toThrow(/Cannot edit this routine: it has no spec/);
    expect(update).not.toHaveBeenCalled();
  });

  it("names only the spec field the edit changed, sends nothing for no change, and says to reload a routine changed since", async () => {
    const update = vi.fn(async () => ROUTINE);
    const client = { routine: { update } };
    const { result } = renderHook(() => useUpdateRoutineSpec(), { wrapper: wrapper(client) });

    await result.current.updateSpec(ROUTINE, (spec) => {
      spec.cron = "0 10 * * *";
    });
    const sent = sentUpdate<Routine>(update);
    expect(sent.paths).toEqual(["spec.cron"]);
    expect(sent.resource.metadata?.id).toBe("sch_01example");

    await result.current.updateSpec(ROUTINE, () => {});
    expect(update).toHaveBeenCalledTimes(1);

    update.mockRejectedValueOnce(
      new ConnectError("changed", Code.Aborted, undefined, [
        { desc: ErrorInfoSchema, value: { domain: "stigmer.ai", reason: "ETAG_MISMATCH", metadata: {} } },
      ]),
    );
    await expect(
      result.current.updateSpec(ROUTINE, (spec) => {
        spec.timeZone = "UTC";
      }),
    ).rejects.toThrow(/^This routine changed since you opened it/);
  });
});
