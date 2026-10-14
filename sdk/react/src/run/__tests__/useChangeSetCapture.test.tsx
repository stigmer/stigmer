/**
 * Proves useChangeSetCapture (../useChangeSetCapture.ts): idle until
 * enabled (and for an empty run id); once enabled it reads the run and finds
 * the change set's captured bytes in the run's file-review projection; a set
 * the run does not hold is `null`; a failed read is the error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";

vi.mock("../../hooks", () => ({
  useStigmer: vi.fn(),
}));

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { FileChangeSetSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { useStigmer } from "../../hooks";
import { samples } from "../../test/samples";
import { useChangeSetCapture } from "../useChangeSetCapture";

const mockUseStigmer = vi.mocked(useStigmer);

function mockGet(impl: () => Promise<Run>) {
  const get = vi.fn(impl);
  mockUseStigmer.mockReturnValue({ run: { get } } as unknown as ReturnType<typeof useStigmer>);
  return get;
}

function runWithSet(changeSetId: string): Run {
  const run = samples.run({ id: "r1" });
  run.status!.fileChanges = [create(FileChangeSetSchema, { id: changeSetId })];
  return run;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useChangeSetCapture", () => {
  it("reads nothing until enabled, or for an empty run id", () => {
    const get = mockGet(async () => runWithSet("cs-1"));
    const { result, rerender } = renderHook(
      ({ runId, enabled }) => useChangeSetCapture(runId, "cs-1", enabled),
      { initialProps: { runId: "r1", enabled: false } },
    );
    rerender({ runId: "", enabled: true });

    expect(get).not.toHaveBeenCalled();
    expect(result.current).toEqual({ capture: null, isLoading: false, error: null });
  });

  it("finds the change set in the run once enabled", async () => {
    const get = mockGet(async () => runWithSet("cs-1"));
    const { result } = renderHook(() => useChangeSetCapture("r1", "cs-1", true));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.capture?.id).toBe("cs-1"));
    expect(result.current.isLoading).toBe(false);
    expect(get).toHaveBeenCalledWith("r1");
  });

  it("is null for a set the run does not hold", async () => {
    mockGet(async () => runWithSet("cs-other"));
    const { result } = renderHook(() => useChangeSetCapture("r1", "cs-1", true));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.capture).toBeNull();
  });

  it("surfaces a failed read", async () => {
    mockGet(async () => {
      throw new Error("unreachable");
    });
    const { result } = renderHook(() => useChangeSetCapture("r1", "cs-1", true));

    await waitFor(() => expect(result.current.error?.message).toBe("unreachable"));
    expect(result.current.capture).toBeNull();
  });
});
