// Pins the Workflow Architect probe the AI-assisted entry points render
// on (workflow-architect.ts): the reference the flows hand to the session
// create is the one the probe asks with; an agent under the slug is
// `available`; a NOT_FOUND is `absent` without an error; a failed probe is
// `absent` with the error exposed; no Organization in scope is a stable
// `absent` that never dials the client.

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import {
  WORKFLOW_ARCHITECT_SLUG,
  useWorkflowArchitect,
  workflowArchitectRef,
} from "../workflow-architect";

function clientWith(getByReference: (...args: unknown[]) => Promise<unknown>) {
  return { agent: { getByReference } } as never;
}

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

describe("workflowArchitectRef", () => {
  it("is the architect in the given Organization, under the one slug", () => {
    expect(workflowArchitectRef("acme")).toEqual({
      org: "acme",
      slug: WORKFLOW_ARCHITECT_SLUG,
    });
  });
});

describe("useWorkflowArchitect", () => {
  it("asks with the reference the flows use, and is available when the agent exists", async () => {
    const agent = {
      metadata: { id: "agt_1", slug: WORKFLOW_ARCHITECT_SLUG, org: "acme" },
    };
    const getByReference = vi.fn().mockResolvedValue(agent);

    const { result } = renderHook(() => useWorkflowArchitect("acme"), {
      wrapper: wrapper(clientWith(getByReference)),
    });

    expect(result.current.availability).toBe("loading");
    await waitFor(() =>
      expect(result.current.availability).toBe("available"),
    );
    expect(result.current.agent).toBe(agent);
    expect(result.current.error).toBeNull();
    expect(getByReference).toHaveBeenCalledWith(workflowArchitectRef("acme"));
  });

  it("is absent, without an error, when no agent exists under the slug", async () => {
    // The SDK client surfaces a NOT_FOUND as a StigmerError the hook's
    // `isNotFound` classifier reads (sdk/typescript/src/gen/errors.ts).
    const getByReference = vi
      .fn()
      .mockRejectedValue(
        new StigmerError("not-found", "no such agent", Code.NotFound),
      );

    const { result } = renderHook(() => useWorkflowArchitect("acme"), {
      wrapper: wrapper(clientWith(getByReference)),
    });

    await waitFor(() => expect(result.current.availability).toBe("absent"));
    expect(result.current.agent).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("is absent with the error exposed when the probe itself fails", async () => {
    const failure = new StigmerError(
      "unavailable",
      "backend unreachable",
      Code.Unavailable,
    );
    const getByReference = vi.fn().mockRejectedValue(failure);

    const { result } = renderHook(() => useWorkflowArchitect("acme"), {
      wrapper: wrapper(clientWith(getByReference)),
    });

    await waitFor(() => expect(result.current.availability).toBe("absent"));
    expect(result.current.agent).toBeNull();
    expect(result.current.error).toBe(failure);
  });

  it("never dials the client without an Organization in scope, and reports absent", () => {
    const getByReference = vi.fn();

    const nothing = renderHook(() => useWorkflowArchitect(null), {
      wrapper: wrapper(clientWith(getByReference)),
    });
    const undefinedOrg = renderHook(() => useWorkflowArchitect(undefined), {
      wrapper: wrapper(clientWith(getByReference)),
    });

    expect(nothing.result.current.availability).toBe("absent");
    expect(undefinedOrg.result.current.availability).toBe("absent");
    expect(getByReference).not.toHaveBeenCalled();
  });

  it("returns a referentially stable value while nothing changes", async () => {
    const getByReference = vi.fn().mockResolvedValue({ metadata: { id: "agt_1" } });

    const { result, rerender } = renderHook(() => useWorkflowArchitect("acme"), {
      wrapper: wrapper(clientWith(getByReference)),
    });
    await waitFor(() =>
      expect(result.current.availability).toBe("available"),
    );

    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
  });
});
