import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { PersonalKeyDisclosure } from "../PersonalKeyDisclosure";

// ---------------------------------------------------------------------------
// The disclosure before a conversation's first message: it names exactly
// the keys the agent declares (`spec.env`), sorted, as the keys it can read
// from the person's personal environment; it says nothing for an agent that
// declares none or cannot be read. A disclosure, so there is no control.
// ---------------------------------------------------------------------------

afterEach(cleanup);

function wrapperFor(getByReference: ReturnType<typeof vi.fn>) {
  const client = { agent: { getByReference } } as unknown as Stigmer;
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

const REF = { org: "org_acme", slug: "pr-reviewer" };

describe("PersonalKeyDisclosure", () => {
  it("names the keys the agent declares", async () => {
    const getByReference = vi.fn().mockResolvedValue({
      spec: { env: { LINEAR_API_KEY: {}, GITHUB_TOKEN: {} } },
    });
    render(<PersonalKeyDisclosure agentRef={REF} />, { wrapper: wrapperFor(getByReference) });

    await waitFor(() =>
      expect(screen.getByTestId("personal-key-disclosure").textContent).toBe(
        "This agent can read these keys from your personal environment: GITHUB_TOKEN, LINEAR_API_KEY",
      ),
    );
    expect(getByReference).toHaveBeenCalledWith({ org: "org_acme", slug: "pr-reviewer" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says nothing for an agent that declares no keys", async () => {
    const getByReference = vi.fn().mockResolvedValue({ spec: { env: {} } });
    render(<PersonalKeyDisclosure agentRef={REF} />, { wrapper: wrapperFor(getByReference) });

    await waitFor(() => expect(getByReference).toHaveBeenCalled());
    expect(screen.queryByTestId("personal-key-disclosure")).toBeNull();
  });

  it("says nothing when the agent cannot be read", async () => {
    const getByReference = vi.fn().mockRejectedValue(new Error("denied"));
    render(<PersonalKeyDisclosure agentRef={REF} />, { wrapper: wrapperFor(getByReference) });

    await waitFor(() => expect(getByReference).toHaveBeenCalled());
    expect(screen.queryByTestId("personal-key-disclosure")).toBeNull();
  });
});
