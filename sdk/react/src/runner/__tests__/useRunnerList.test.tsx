import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  RunnerSchema,
  RunnerStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useRunnerList } from "../useRunnerList";

function makeRunner(id: string, name: string, phase: RunnerPhase) {
  const runner = create(RunnerSchema);
  runner.metadata = create(ApiResourceMetadataSchema);
  runner.metadata.id = id;
  runner.metadata.name = name;
  runner.status = create(RunnerStatusSchema);
  runner.status.phase = phase;
  return runner;
}

function buildMockClient(listMock: ReturnType<typeof vi.fn>) {
  return {
    runner: { list: listMock },
  } as unknown as Stigmer;
}

function makeWrapper(client: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>
      {children}
    </StigmerContext.Provider>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useRunnerList — refetchInterval", () => {
  let listMock: ReturnType<typeof vi.fn>;
  let client: Stigmer;

  beforeEach(() => {
    vi.useFakeTimers();
    listMock = vi.fn();
    client = buildMockClient(listMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls when refetchInterval is set", async () => {
    const runners = [makeRunner("r1", "dev", RunnerPhase.PENDING)];
    listMock.mockResolvedValue({ items: runners });

    const { result } = renderHook(
      () => useRunnerList("acme", { refetchInterval: 2000 }),
      { wrapper: makeWrapper(client) },
    );

    // Initial fetch.
    await flush();
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(result.current.runners).toHaveLength(1);

    // Advance by one interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("does not poll when refetchInterval is false", async () => {
    listMock.mockResolvedValue({ items: [] });

    renderHook(
      () => useRunnerList("acme", { refetchInterval: false }),
      { wrapper: makeWrapper(client) },
    );

    await flush();
    expect(listMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
