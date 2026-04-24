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
import { useDeleteRunner } from "../useDeleteRunner";

function makeRunner(id: string, phase: RunnerPhase): Runner {
  const runner = create(RunnerSchema);
  runner.metadata = create(ApiResourceMetadataSchema);
  runner.metadata.id = id;
  runner.status = create(RunnerStatusSchema);
  runner.status.phase = phase;
  return runner;
}

function buildMockClient(overrides: {
  delete?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    runner: {
      delete: overrides.delete ?? vi.fn(),
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

describe("useDeleteRunner", () => {
  let deleteMock: ReturnType<typeof vi.fn>;
  let client: Stigmer;

  beforeEach(() => {
    deleteMock = vi.fn();
    client = buildMockClient({ delete: deleteMock });
  });

  it("calls runner.delete with the ID and returns the deleted runner", async () => {
    const deletedRunner = makeRunner("rnr_del1", RunnerPhase.STOPPED);
    deleteMock.mockResolvedValueOnce(deletedRunner);

    const { result } = renderHook(() => useDeleteRunner(), {
      wrapper: makeWrapper(client),
    });

    expect(result.current.isDeleting).toBe(false);
    expect(result.current.error).toBeNull();

    let returned: Runner;
    await act(async () => {
      returned = await result.current.deleteRunner("rnr_del1");
    });

    expect(deleteMock).toHaveBeenCalledOnce();
    expect(deleteMock).toHaveBeenCalledWith("rnr_del1");

    expect(returned!).toBe(deletedRunner);
    expect(result.current.isDeleting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets error and rethrows on failure", async () => {
    const rpcError = new Error("permission denied");
    deleteMock.mockRejectedValueOnce(rpcError);

    const { result } = renderHook(() => useDeleteRunner(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await expect(
        result.current.deleteRunner("rnr_nope"),
      ).rejects.toThrow("permission denied");
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("permission denied");
    expect(result.current.isDeleting).toBe(false);
  });

  it("handles non-Error rejection values", async () => {
    deleteMock.mockRejectedValueOnce("raw string error");

    const { result } = renderHook(() => useDeleteRunner(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await expect(
        result.current.deleteRunner("rnr_x"),
      ).rejects.toBe("raw string error");
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("raw string error");
  });

  it("clears error via clearError", async () => {
    deleteMock.mockRejectedValueOnce(new Error("fail"));

    const { result } = renderHook(() => useDeleteRunner(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.deleteRunner("rnr_1").catch(() => {});
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it("resets previous error on a new successful delete", async () => {
    deleteMock.mockRejectedValueOnce(new Error("first fail"));

    const { result } = renderHook(() => useDeleteRunner(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.deleteRunner("rnr_1").catch(() => {});
    });
    expect(result.current.error).not.toBeNull();

    const deletedRunner = makeRunner("rnr_1", RunnerPhase.STOPPED);
    deleteMock.mockResolvedValueOnce(deletedRunner);

    await act(async () => {
      await result.current.deleteRunner("rnr_1");
    });
    expect(result.current.error).toBeNull();
  });
});
