import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  RunnerSchema,
  RunnerStatusSchema,
  type Runner,
} from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useStopRunner } from "../useStopRunner";

function makeRunner(id: string, phase: RunnerPhase): Runner {
  const runner = create(RunnerSchema);
  runner.metadata = create(ApiResourceMetadataSchema);
  runner.metadata.id = id;
  runner.status = create(RunnerStatusSchema);
  runner.status.phase = phase;
  return runner;
}

function buildMockClient(overrides: {
  stop?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    runner: {
      stop: overrides.stop ?? vi.fn(),
    },
  } as unknown as Stigmer;
}

function makeWrapper(client: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>
      {children}
    </StigmerContext.Provider>
  );
}

describe("useStopRunner", () => {
  let stopMock: ReturnType<typeof vi.fn>;
  let client: Stigmer;

  beforeEach(() => {
    stopMock = vi.fn();
    client = buildMockClient({ stop: stopMock });
  });

  it("calls runner.stop with correct proto message and returns the runner", async () => {
    const stoppedRunner = makeRunner("rnr_1", RunnerPhase.STOPPED);
    stopMock.mockResolvedValueOnce(stoppedRunner);

    const { result } = renderHook(() => useStopRunner(), {
      wrapper: makeWrapper(client),
    });

    expect(result.current.isStopping).toBe(false);
    expect(result.current.error).toBeNull();

    let returned: Runner;
    await act(async () => {
      returned = await result.current.stop({
        runnerId: "rnr_1",
        reason: "user requested",
      });
    });

    expect(stopMock).toHaveBeenCalledOnce();
    const protoArg = stopMock.mock.calls[0][0];
    expect(protoArg.runnerId).toBe("rnr_1");
    expect(protoArg.reason).toBe("user requested");

    expect(returned!).toBe(stoppedRunner);
    expect(result.current.isStopping).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("defaults reason to empty string when omitted", async () => {
    const stoppedRunner = makeRunner("rnr_2", RunnerPhase.STOPPED);
    stopMock.mockResolvedValueOnce(stoppedRunner);

    const { result } = renderHook(() => useStopRunner(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.stop({ runnerId: "rnr_2" });
    });

    const protoArg = stopMock.mock.calls[0][0];
    expect(protoArg.reason).toBe("");
  });

  it("sets error and rethrows on failure", async () => {
    const rpcError = new Error("runner not found");
    stopMock.mockRejectedValueOnce(rpcError);

    const { result } = renderHook(() => useStopRunner(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await expect(
        result.current.stop({ runnerId: "rnr_missing" }),
      ).rejects.toThrow("runner not found");
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("runner not found");
    expect(result.current.isStopping).toBe(false);
  });

  it("clears error via clearError", async () => {
    stopMock.mockRejectedValueOnce(new Error("fail"));

    const { result } = renderHook(() => useStopRunner(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.stop({ runnerId: "rnr_1" }).catch(() => {});
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it("resets previous error on a new successful stop", async () => {
    stopMock.mockRejectedValueOnce(new Error("first fail"));

    const { result } = renderHook(() => useStopRunner(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.stop({ runnerId: "rnr_1" }).catch(() => {});
    });
    expect(result.current.error).not.toBeNull();

    const stoppedRunner = makeRunner("rnr_1", RunnerPhase.STOPPED);
    stopMock.mockResolvedValueOnce(stoppedRunner);

    await act(async () => {
      await result.current.stop({ runnerId: "rnr_1" });
    });
    expect(result.current.error).toBeNull();
  });
});
