import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentSetup } from "../useAgentSetup";

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

// Minimal client — resolveToInstance performs no network calls, so an
// empty client is sufficient. org is null to keep usePersonalEnvironment idle.
const client = {} as never;

describe("useAgentSetup.resolveToInstance", () => {
  it("transitions straight to a 'saved' resolution for the chosen instance", async () => {
    const { result } = renderHook(() => useAgentSetup(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.state.status).toBe("idle");

    let returned: any;
    await act(async () => {
      returned = await result.current.resolveToInstance(
        { org: "acme", slug: "code-reviewer" },
        "ain-123",
      );
    });

    // Imperative return value
    expect(returned.status).toBe("ready");
    expect(returned.resolution).toEqual({ mode: "saved", instanceId: "ain-123" });
    expect(returned.agentRef).toEqual({ org: "acme", slug: "code-reviewer" });

    // State machine reached "ready" with the same resolution (no env prompt)
    expect(result.current.state.status).toBe("ready");
    if (result.current.state.status === "ready") {
      expect(result.current.state.resolution).toEqual({
        mode: "saved",
        instanceId: "ain-123",
      });
    }
  });

  it("uses the provided agentName when given, else falls back to the slug", async () => {
    const { result } = renderHook(() => useAgentSetup(null), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.resolveToInstance(
        { org: "acme", slug: "code-reviewer" },
        "ain-123",
        "Code Reviewer",
      );
    });

    expect(result.current.state.status).toBe("ready");
    if (result.current.state.status === "ready") {
      expect(result.current.state.agentName).toBe("Code Reviewer");
    }
  });
});
