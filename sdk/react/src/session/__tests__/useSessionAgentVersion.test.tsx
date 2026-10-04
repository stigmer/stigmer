import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useSessionAgentVersion } from "../useSessionAgentVersion";

// ---------------------------------------------------------------------------
// When the session view offers "Update": only when the session's pin
// (`status.agentVersionHash`) and its agent's current version
// (`agent.status.versionHash`) are both known and differ. The agent is read
// by the id the session pinned, never by slug; a guest reads nothing; an
// unreadable agent offers nothing; and labels read as a version's tag where
// it has one, else a short hash. Update calls the move it is given and
// reports a failure instead of throwing. The current version's declared
// keys are reported, sorted, for the notice to name before an update.
// ---------------------------------------------------------------------------

function session(pin: string): Session {
  return create(SessionSchema, {
    metadata: { id: "ses_1" },
    spec: { agentRef: { org: "org_acme", slug: "reviewer", kind: 40 } },
    status: { agentId: "agt_1", agentVersionHash: pin },
  });
}

function makeClient(current: string, get = vi.fn()) {
  get.mockResolvedValue({
    metadata: { id: "agt_1", org: "org_acme", slug: "reviewer", name: "PR Reviewer" },
    spec: { env: { LINEAR_API_KEY: {}, GITHUB_TOKEN: {} } },
    status: { versionHash: current },
  });
  const listVersions = vi.fn().mockResolvedValue({
    versions: [
      { versionHash: "h_new", tag: "v3", isCurrent: true },
      { versionHash: "h_old", tag: "", isCurrent: false },
    ],
  });
  return { agent: { get, listVersions } } as unknown as Stigmer & {
    agent: { get: ReturnType<typeof vi.fn> };
  };
}

function wrapperFor(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useSessionAgentVersion", () => {
  it("is outdated when the pin differs from the agent's current version, read by the pinned id", async () => {
    const client = makeClient("h_new");
    const { result } = renderHook(
      () => useSessionAgentVersion(session("h_old"), { enabled: true, moveToCurrentVersion: vi.fn() }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.isOutdated).toBe(true));
    expect(client.agent.get).toHaveBeenCalledWith("agt_1");
    expect(result.current.agentName).toBe("PR Reviewer");
    await waitFor(() => expect(result.current.labelOf("h_new")).toBe("v3"));
    expect(result.current.labelOf("h_old")).toBe("h_old");
    expect(result.current.labelOf("0123456789abcdef0123")).toBe("0123456789ab");
    expect(result.current.currentPersonalKeys).toEqual(["GITHUB_TOKEN", "LINEAR_API_KEY"]);
  });

  it("is not outdated when the session runs the agent's current version", async () => {
    const client = makeClient("h_new");
    const { result } = renderHook(
      () => useSessionAgentVersion(session("h_new"), { enabled: true, moveToCurrentVersion: vi.fn() }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.currentHash).toBe("h_new"));
    expect(result.current.isOutdated).toBe(false);
  });

  it("reads nothing and offers nothing for a guest", () => {
    const client = makeClient("h_new");
    const { result } = renderHook(
      () => useSessionAgentVersion(session("h_old"), { enabled: false, moveToCurrentVersion: vi.fn() }),
      { wrapper: wrapperFor(client) },
    );

    expect(client.agent.get).not.toHaveBeenCalled();
    expect(result.current.isOutdated).toBe(false);
  });

  it("offers nothing when the agent cannot be read", async () => {
    const get = vi.fn();
    const client = makeClient("h_new", get);
    get.mockReset();
    get.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(
      () => useSessionAgentVersion(session("h_old"), { enabled: true, moveToCurrentVersion: vi.fn() }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current.isOutdated).toBe(false);
  });

  it("update calls the move and reports its failure instead of throwing", async () => {
    const client = makeClient("h_new");
    const move = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined);
    const { result } = renderHook(
      () => useSessionAgentVersion(session("h_old"), { enabled: true, moveToCurrentVersion: move }),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => {
      await result.current.update();
    });
    expect(move).toHaveBeenCalledTimes(1);
    expect(result.current.updateError?.message).toBe("denied");

    await act(async () => {
      await result.current.update();
    });
    expect(result.current.updateError).toBeNull();
    expect(result.current.isUpdating).toBe(false);
  });
});
