// ---------------------------------------------------------------------------
// useDeploymentMode — the guess and the answer are told apart
//
// The hook starts from a hostname guess ("local" for localhost, "cloud" for
// anything else — so "cloud" for every self-host) and corrects itself when
// getServerInfo answers. Anything rendered on the first frame is rendered
// on the guess. Since 20260913.02 (sp.console-login) the hook says which
// it is returning, so a surface that must not show the wrong shape (the
// login page, Q-CL-4) can wait for `resolved` instead of branching on the
// guess. A server that cannot answer (an older server without the RPC, or
// no server at all) resolves to the guess: the fallback is the best answer
// there is, and a skeleton that never lifts would be worse than a guess.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";

vi.mock("@/config/env", () => ({
  getApiBaseUrl: () => "https://stigmer.example.com",
}));

import { useDeploymentMode } from "../useDeploymentMode";

function clientAnswering(deploymentMode: string): Stigmer {
  return {
    platform: { getServerInfo: vi.fn(async () => ({ deploymentMode })) },
  } as unknown as Stigmer;
}

function clientFailing(): Stigmer {
  return {
    platform: {
      getServerInfo: vi.fn(async () => {
        throw new Error("unimplemented");
      }),
    },
  } as unknown as Stigmer;
}

describe("useDeploymentMode", () => {
  beforeEach(() => vi.clearAllMocks());
  // Unmount so no state update from a settling getServerInfo lands after
  // the environment is torn down (the web vitest config has no globals,
  // so testing-library's auto-cleanup is not wired).
  afterEach(cleanup);

  it("starts unresolved on the hostname guess (a self-host guesses 'cloud')", () => {
    const { result } = renderHook(() => useDeploymentMode(undefined));
    expect(result.current).toEqual({ mode: "cloud", resolved: false });
  });

  it("resolves to the server's answer, replacing the guess", async () => {
    const { result } = renderHook(() =>
      useDeploymentMode(clientAnswering("local")),
    );
    expect(result.current.resolved).toBe(false);
    await waitFor(() =>
      expect(result.current).toEqual({ mode: "local", resolved: true }),
    );
  });

  it("resolves to the guess when the server cannot answer (older servers)", async () => {
    const { result } = renderHook(() => useDeploymentMode(clientFailing()));
    await waitFor(() =>
      expect(result.current).toEqual({ mode: "cloud", resolved: true }),
    );
  });
});
