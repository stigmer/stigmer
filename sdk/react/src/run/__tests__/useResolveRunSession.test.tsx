/**
 * Pins how an agent run resolves to the session page it opens: the
 * turn's target names its session by id, and that id is the answer; a
 * turn whose target is anything else (a new conversation's session spec the
 * server has not yet replaced, or no target at all) resolves to no session
 * rather than a guess; a run that does not exist or that the caller cannot
 * see resolves to no session and is not an error, while any other failure
 * is the error a page offers a retry for; and a null id fetches nothing. The
 * fetch lifecycle itself is `useFetch`'s and pinned there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  RunSchema,
  type Run,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { RunSpec } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { StigmerError } from "@stigmer/sdk";

vi.mock("../../hooks", () => ({
  useStigmer: vi.fn(),
}));

import { useStigmer } from "../../hooks";
import { useResolveRunSession } from "../useResolveRunSession";

function turn(target: RunSpec["target"]): Run {
  return create(RunSchema, {
    metadata: { id: "aex_1" },
    spec: { target, message: "go" },
  });
}

describe("useResolveRunSession", () => {
  const mockGet = vi.fn<(id: string) => Promise<Run>>();

  beforeEach(() => {
    mockGet.mockReset();
    (useStigmer as ReturnType<typeof vi.fn>).mockReturnValue({
      run: { get: mockGet },
    });
  });

  it("resolves a turn to the session its target names", async () => {
    mockGet.mockResolvedValue(turn({ case: "sessionId", value: "ses_42" }));

    const { result } = renderHook(() =>
      useResolveRunSession("aex_1"),
    );

    await waitFor(() => expect(result.current.sessionId).toBe("ses_42"));
    expect(mockGet).toHaveBeenCalledWith("aex_1");
    expect(result.current.error).toBeNull();
  });

  it("resolves no session for a turn whose target is not a session id", async () => {
    mockGet.mockResolvedValue(
      turn({
        case: "sessionSpec",
        value: create(SessionSpecSchema, {
          agentRef: { org: "acme", slug: "helper" },
        }),
      }),
    );

    const { result } = renderHook(() =>
      useResolveRunSession("aex_1"),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.sessionId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it.each([
    ["not-found", 5],
    ["permission-denied", 7],
  ] as const)("resolves no session, and no error, for a run the server answers %s", async (code, connectCode) => {
    mockGet.mockRejectedValue(new StigmerError(code, "no such run", connectCode));

    const { result } = renderHook(() => useResolveRunSession("aex_gone"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessionId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("reports any other failure as the error, and reads the run again on refetch", async () => {
    mockGet.mockRejectedValueOnce(new StigmerError("unavailable", "connection refused", 14));
    mockGet.mockResolvedValueOnce(turn({ case: "sessionId", value: "ses_7" }));

    const { result } = renderHook(() => useResolveRunSession("aex_1"));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.sessionId).toBeNull();

    result.current.refetch();

    await waitFor(() => expect(result.current.sessionId).toBe("ses_7"));
    expect(result.current.error).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("fetches nothing for a null id", () => {
    const { result } = renderHook(() => useResolveRunSession(null));

    expect(result.current.sessionId).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
