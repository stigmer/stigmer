import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerError } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { OAUTH_CALLBACK_MESSAGE_TYPE } from "../../internal/oauthPopup";
import { useConnectSlackChannel } from "../useConnectSlackChannel";

/**
 * Fake popup satisfying what the hook touches: `location.href` (consent
 * navigation), `closed`, and `close()`.
 */
function fakePopup() {
  const popup = {
    closed: false,
    close() {
      popup.closed = true;
    },
    location: { href: "about:blank" },
  };
  return popup as unknown as Window & { closed: boolean; location: { href: string } };
}

function createMockStigmer(overrides: {
  initiateInstall?: (input: unknown) => Promise<unknown>;
  completeInstall?: (input: unknown) => Promise<unknown>;
} = {}) {
  return {
    agentChannel: {
      initiateInstall:
        overrides.initiateInstall ??
        vi.fn().mockResolvedValue({
          authorizationUrl: "https://slack.com/oauth/v2/authorize?x=1",
          state: "state-1",
        }),
      completeInstall:
        overrides.completeInstall ??
        vi.fn().mockResolvedValue({ metadata: { id: "ach_1" } }),
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

function deliverCallback(state: string, code = "auth-code-123") {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: OAUTH_CALLBACK_MESSAGE_TYPE, code, state },
      origin: window.location.origin,
    }),
  );
}

describe("useConnectSlackChannel", () => {
  let popup: ReturnType<typeof fakePopup>;

  beforeEach(() => {
    popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("walks the full phase machine on the happy path", async () => {
    const installed = { metadata: { id: "ach_1" }, status: { installState: 2 } };
    const initiateInstall = vi.fn().mockResolvedValue({
      authorizationUrl: "https://slack.com/oauth/v2/authorize?x=1",
      state: "state-1",
    });
    const completeInstall = vi.fn().mockResolvedValue(installed);
    const client = createMockStigmer({ initiateInstall, completeInstall });

    const { result } = renderHook(() => useConnectSlackChannel(), {
      wrapper: wrapper(client),
    });
    expect(result.current.phase).toBe("idle");

    let connectPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      connectPromise = result.current.connect("ach_1");
    });

    // The popup must navigate to the consent URL once initiate resolves.
    await waitFor(() =>
      expect(result.current.phase).toBe("awaiting-callback"),
    );
    expect(popup.location.href).toBe("https://slack.com/oauth/v2/authorize?x=1");
    expect(initiateInstall).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: "ach_1" }),
    );

    act(() => deliverCallback("state-1"));

    await act(async () => {
      await expect(connectPromise).resolves.toBe(installed);
    });

    expect(completeInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: "ach_1",
        state: "state-1",
        code: "auth-code-123",
      }),
    );
    expect(result.current.phase).toBe("done");
    expect(result.current.isInProgress).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fails fast with a helpful error when the popup is blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const client = createMockStigmer();

    const { result } = renderHook(() => useConnectSlackChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(result.current.connect("ach_1")).rejects.toThrow(
        /allow popups/i,
      );
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.error?.message).toMatch(/blocked/i);
  });

  it("surfaces the server refusal when the deployment cannot run installs", async () => {
    // Unconfigured cloud deployment or OSS edition: initiateInstall
    // answers FAILED_PRECONDITION with server-authored copy. The hook
    // must relay that copy verbatim and close the popup.
    const initiateInstall = vi
      .fn()
      .mockRejectedValue(
        new StigmerError(
          "failed-precondition",
          "channel installs require Stigmer Cloud",
          9,
        ),
      );
    const client = createMockStigmer({ initiateInstall });

    const { result } = renderHook(() => useConnectSlackChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(result.current.connect("ach_1")).rejects.toThrow(
        "channel installs require Stigmer Cloud",
      );
    });

    expect(result.current.error?.message).toBe(
      "channel installs require Stigmer Cloud",
    );
    expect(result.current.phase).toBe("idle");
    expect(popup.closed).toBe(true);
  });

  it("surfaces completeInstall refusals (duplicate workspace, Enterprise Grid)", async () => {
    const completeInstall = vi
      .fn()
      .mockRejectedValue(
        new StigmerError(
          "failed-precondition",
          "This Slack workspace is already connected to a Stigmer agent. " +
            "A workspace can host one agent — disconnect the existing channel first.",
          9,
        ),
      );
    const client = createMockStigmer({ completeInstall });

    const { result } = renderHook(() => useConnectSlackChannel(), {
      wrapper: wrapper(client),
    });

    let connectPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      connectPromise = result.current.connect("ach_1");
    });
    connectPromise.catch(() => {});

    await waitFor(() =>
      expect(result.current.phase).toBe("awaiting-callback"),
    );
    act(() => deliverCallback("state-1"));

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error?.message).toMatch(/already connected/i);
    expect(result.current.phase).toBe("idle");
  });

  it("rejects on state mismatch from the callback", async () => {
    const client = createMockStigmer();

    const { result } = renderHook(() => useConnectSlackChannel(), {
      wrapper: wrapper(client),
    });

    let connectPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      connectPromise = result.current.connect("ach_1");
    });
    connectPromise.catch(() => {});

    await waitFor(() =>
      expect(result.current.phase).toBe("awaiting-callback"),
    );
    act(() => deliverCallback("state-FORGED"));

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error?.message).toMatch(/state mismatch/i);
  });

  it("clearError cancels an in-flight flow without recording an error", async () => {
    const client = createMockStigmer();

    const { result } = renderHook(() => useConnectSlackChannel(), {
      wrapper: wrapper(client),
    });

    let connectPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      connectPromise = result.current.connect("ach_1");
    });
    connectPromise.catch(() => {});

    await waitFor(() =>
      expect(result.current.phase).toBe("awaiting-callback"),
    );

    act(() => result.current.clearError());

    // Cancellation is a user decision, not a failure: no error state,
    // popup closed, back to idle.
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(result.current.error).toBeNull();
    expect(popup.closed).toBe(true);
    await expect(connectPromise).rejects.toThrow(/cancelled/i);
  });

  it("reports isInProgress across all active phases", async () => {
    const client = createMockStigmer();
    const { result } = renderHook(() => useConnectSlackChannel(), {
      wrapper: wrapper(client),
    });

    expect(result.current.isInProgress).toBe(false);

    let connectPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      connectPromise = result.current.connect("ach_1");
    });

    await waitFor(() =>
      expect(result.current.phase).toBe("awaiting-callback"),
    );
    expect(result.current.isInProgress).toBe(true);

    act(() => deliverCallback("state-1"));
    await act(async () => {
      await connectPromise;
    });
    expect(result.current.isInProgress).toBe(false);
  });
});
