/**
 * Pins how a workflow's child turn resolves to the session page it opens:
 * the turn's target names its session by id, and that id is the answer; a
 * turn whose target is anything else (a new conversation's session spec the
 * server has not yet replaced, or no target at all) resolves to no session
 * rather than a guess; and a null id fetches nothing. The fetch lifecycle
 * itself is `useFetch`'s and pinned there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentRunSchema,
  type AgentRun,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { AgentRunSpec } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/spec_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";

vi.mock("../../hooks", () => ({
  useStigmer: vi.fn(),
}));

import { useStigmer } from "../../hooks";
import { useResolveAgentRunSession } from "../useResolveAgentRunSession";

function turn(target: AgentRunSpec["target"]): AgentRun {
  return create(AgentRunSchema, {
    metadata: { id: "aex_1" },
    spec: { target, message: "go" },
  });
}

describe("useResolveAgentRunSession", () => {
  const mockGet = vi.fn<(id: string) => Promise<AgentRun>>();

  beforeEach(() => {
    mockGet.mockReset();
    (useStigmer as ReturnType<typeof vi.fn>).mockReturnValue({
      agentRun: { get: mockGet },
    });
  });

  it("resolves a turn to the session its target names", async () => {
    mockGet.mockResolvedValue(turn({ case: "sessionId", value: "ses_42" }));

    const { result } = renderHook(() =>
      useResolveAgentRunSession("aex_1"),
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
      useResolveAgentRunSession("aex_1"),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.sessionId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches nothing for a null id", () => {
    const { result } = renderHook(() => useResolveAgentRunSession(null));

    expect(result.current.sessionId).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
