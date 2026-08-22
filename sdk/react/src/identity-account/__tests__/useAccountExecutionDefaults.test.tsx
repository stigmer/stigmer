import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { DeploymentMode } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
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
  it("returns undefined in local mode without issuing any RPC", async () => {
    const whoAmI = vi.fn();
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI, "local"),
    });

    // Settle any pending effects before asserting the no-RPC invariant.
    await waitFor(() => expect(result.current).toBeUndefined());
    expect(whoAmI).not.toHaveBeenCalled();
  });

  it("shapes declared defaults for the launcher's accountDefaults prop", async () => {
    const whoAmI = vi.fn(async () =>
      accountWithPreferences({
        defaultHarness: "cursor",
        defaultNativeModel: "claude-sonnet-4.6",
        defaultCursorModel: "composer-2.5",
      }),
    );
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI),
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        harness: "cursor",
        nativeModel: "claude-sonnet-4.6",
        cursorModel: "composer-2.5",
      }),
    );
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
        defaultNativeModel: "claude-sonnet-4.6",
      }),
    );
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI),
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        harness: undefined,
        nativeModel: "claude-sonnet-4.6",
        cursorModel: undefined,
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
        nativeModel: undefined,
        cursorModel: undefined,
        autoApprove: true,
      }),
    );
  });

  it("an unset auto-approve bool is no preference, not an explicit false", async () => {
    const whoAmI = vi.fn(async () =>
      accountWithPreferences({
        defaultHarness: "native",
        defaultAutoApprove: false,
      }),
    );
    const { result } = renderHook(() => useAccountExecutionDefaults(), {
      wrapper: createWrapper(whoAmI),
    });

    await waitFor(() => expect(result.current?.harness).toBe("native"));
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
