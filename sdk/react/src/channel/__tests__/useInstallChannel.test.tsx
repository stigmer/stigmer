import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { StigmerError, getErrorReason } from "@stigmer/sdk";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { StigmerContext } from "../../context";
import { useInstallChannel } from "../useInstallChannel";

function createMockStigmer(overrides: {
  initiateInstall?: (input: unknown) => Promise<unknown>;
} = {}) {
  return {
    agentChannel: {
      initiateInstall:
        overrides.initiateInstall ??
        vi.fn().mockResolvedValue({ completed: true }),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

describe("useInstallChannel", () => {
  it("runs the whole install in one call when the server answers completed", async () => {
    const initiateInstall = vi.fn().mockResolvedValue({ completed: true });
    const client = createMockStigmer({ initiateInstall });

    const { result } = renderHook(() => useInstallChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.install("ach_1");
    });

    expect(initiateInstall).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: "ach_1" }),
    );
    expect(result.current.phase).toBe("done");
    expect(result.current.error).toBeNull();
    expect(result.current.isInProgress).toBe(false);
  });

  it("tracks the installing phase during the flight", async () => {
    let resolveInstall: (value: unknown) => void = () => {};
    const initiateInstall = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveInstall = resolve; }),
    );
    const client = createMockStigmer({ initiateInstall });

    const { result } = renderHook(() => useInstallChannel(), {
      wrapper: wrapper(client),
    });

    let installPromise: Promise<void> = Promise.resolve();
    act(() => {
      installPromise = result.current.install("ach_1");
    });

    await waitFor(() => expect(result.current.isInProgress).toBe(true));
    expect(result.current.phase).toBe("installing");

    await act(async () => {
      resolveInstall({ completed: true });
      await installPromise;
    });
    expect(result.current.phase).toBe("done");
  });

  it("refuses a completed=false answer — a redirect provider was routed to the direct hook", async () => {
    // DD-WA-1b: the server's flag is the authoritative install style. A
    // false answer here means a client wiring error, surfaced loudly
    // rather than silently treated as success.
    const initiateInstall = vi.fn().mockResolvedValue({
      completed: false,
      authorizationUrl: "https://slack.com/oauth",
      state: "s",
    });
    const client = createMockStigmer({ initiateInstall });

    const { result } = renderHook(() => useInstallChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(result.current.install("ach_1")).rejects.toThrow(
        /interactive install/i,
      );
    });

    expect(result.current.error?.message).toMatch(/interactive install/i);
    expect(result.current.phase).toBe("idle");
  });

  it("surfaces server refusals with their copy and resets to idle", async () => {
    const initiateInstall = vi.fn().mockRejectedValue(
      new StigmerError(
        "failed-precondition",
        "WhatsApp rejected the channel app's access token.",
        9,
      ),
    );
    const client = createMockStigmer({ initiateInstall });

    const { result } = renderHook(() => useInstallChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(result.current.install("ach_1")).rejects.toThrow(
        /access token/i,
      );
    });

    expect(result.current.error?.message).toMatch(/access token/i);
    expect(result.current.phase).toBe("idle");

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("preserves the ErrorInfo reason chain for guided refusals", async () => {
    // The wire shape of the duplicate-number refusal: FAILED_PRECONDITION
    // with a google.rpc.ErrorInfo detail, wrapped by the SDK into a
    // StigmerError with the ConnectError chained as cause.
    const connectError = new ConnectError(
      "This WhatsApp number is already connected.",
      Code.FailedPrecondition,
      undefined,
      [
        {
          desc: ErrorInfoSchema,
          value: {
            domain: "stigmer.ai",
            reason: "WHATSAPP_NUMBER_ALREADY_CONNECTED",
            metadata: {
              display_phone_number: "+1 555 025 3483",
              channel_app_id: "chapp_1",
            },
          },
        },
      ],
    );
    const initiateInstall = vi.fn().mockRejectedValue(
      new StigmerError(
        "failed-precondition",
        connectError.rawMessage,
        Code.FailedPrecondition,
        { cause: connectError },
      ),
    );
    const client = createMockStigmer({ initiateInstall });

    const { result } = renderHook(() => useInstallChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(result.current.install("ach_1")).rejects.toThrow();
    });

    // The hook must not re-wrap the error in a way that severs the cause
    // chain — the dialog's guided refusal reads the reason through it.
    const reason = getErrorReason(result.current.error);
    expect(reason?.reason).toBe("WHATSAPP_NUMBER_ALREADY_CONNECTED");
    expect(reason?.metadata.display_phone_number).toBe("+1 555 025 3483");
  });
});
