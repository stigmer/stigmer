import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { DeploymentMode } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { DeploymentModeContext } from "@stigmer/react-core";
import { useAccountExecutionDefaults } from "../useAccountExecutionDefaults";

function accountWithPreferences(
  preferences: Record<string, string | boolean>,
): IdentityAccount {
  return create(IdentityAccountSchema, {
    metadata: { id: "ia-1", name: "Ada", slug: "ada", org: "acme" },
    spec: { idpId: "auth0|abc", preferences },
  });
}

function createWrapper(whoAmI: ReturnType<typeof vi.fn>, mode: DeploymentMode = "cloud") {
  const client = { identityAccount: { whoAmI } } as never;
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <DeploymentModeContext.Provider value={mode}>
          {children}
        </DeploymentModeContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

afterEach(cleanup);

describe("useAccountExecutionDefaults", () => {
  it("reads the account in local mode — the open-source server serves identity accounts", async () => {
    // Before the tier flip this hook stayed idle on a local server. The
    // operator account exists there since the domain moved into
    // @stigmer/server, so a laptop's saved defaults seed the composer too.
    const whoAmI = vi.fn(async () =>
      accountWithPreferences({ defaultHarness: "stigmer" }),
    );
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI, "local"),
    });

    await waitFor(() => expect(result.current).toEqual({ harness: "stigmer" }));
    expect(whoAmI).toHaveBeenCalledTimes(1);
  });

  it("shapes declared defaults for the launcher's accountDefaults prop", async () => {
    const whoAmI = vi.fn(async () =>
      accountWithPreferences({
        defaultHarness: "claude",
        defaultStigmerModel: "claude-sonnet-4.6",
        defaultClaudeModel: "claude-sonnet-5",
      }),
    );
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI),
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        harness: "claude",
        stigmerModel: "claude-sonnet-4.6",
        claudeModel: "claude-sonnet-5",
      }),
    );
  });

  it("reads Claude's engine and its own default model", async () => {
    const whoAmI = vi.fn(async () => accountWithPreferences({ defaultHarness: "claude", defaultClaudeModel: "claude-sonnet-5" }));
    const { result } = renderHook(() => useAccountExecutionDefaults(), { wrapper: createWrapper(whoAmI) });

    await waitFor(() => expect(result.current).toEqual({ harness: "claude", claudeModel: "claude-sonnet-5" }));
  });

  it("returns undefined while loading and when nothing is declared", async () => {
    const whoAmI = vi.fn(async () =>
      accountWithPreferences({ standingContext: "Keep answers terse." }),
    );
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI),
    });

    expect(result.current).toBeUndefined();
    await waitFor(() => expect(whoAmI).toHaveBeenCalled());
    // standing_context alone declares no execution default.
    expect(result.current).toBeUndefined();
  });

  it("treats an unknown persisted harness value as undeclared", async () => {
    const whoAmI = vi.fn(async () =>
      accountWithPreferences({
        defaultHarness: "devin",
        defaultStigmerModel: "claude-sonnet-4.6",
      }),
    );
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI),
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        harness: undefined,
        stigmerModel: "claude-sonnet-4.6",
      }),
    );
  });

  it("a declared auto-approve default alone counts as a declared default", async () => {
    const whoAmI = vi.fn(async () =>
      accountWithPreferences({ defaultAutoApprove: true }),
    );
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI),
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        harness: undefined,
        stigmerModel: undefined,
        autoApprove: true,
      }),
    );
  });

  it("an unset auto-approve bool is no preference, not an explicit false", async () => {
    const whoAmI = vi.fn(async () =>
      accountWithPreferences({
        defaultHarness: "stigmer",
        defaultAutoApprove: false,
      }),
    );
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI),
    });

    await waitFor(() => expect(result.current?.harness).toBe("stigmer"));
    expect(result.current?.autoApprove).toBeUndefined();
  });

  it("returns undefined on a whoAmI failure — degrades to platform defaults", async () => {
    const whoAmI = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI),
    });

    await waitFor(() => expect(whoAmI).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});
