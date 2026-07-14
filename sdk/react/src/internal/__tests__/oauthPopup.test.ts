import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OAUTH_BROADCAST_CHANNEL,
  OAUTH_CALLBACK_MESSAGE_TYPE,
  closeOAuthPopup,
  openOAuthPopup,
  popupBlockedError,
  waitForOAuthCallback,
  type OAuthPopupHandle,
} from "../oauthPopup.js";

/** Controllable fake popup satisfying the structural handle. */
function fakePopup(): OAuthPopupHandle & { closed: boolean; close: () => void } {
  return {
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

/**
 * Controllable BroadcastChannel fake with a static registry so tests can
 * deliver messages to channels created inside the module under test.
 */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(): void {
    // Delivery is simulated via deliver(); sending is not under test.
  }

  close(): void {
    // no-op
  }

  static deliver(data: unknown): void {
    for (const instance of FakeBroadcastChannel.instances) {
      instance.onmessage?.({ data } as MessageEvent);
    }
  }

  static reset(): void {
    FakeBroadcastChannel.instances = [];
  }
}

/** BroadcastChannel stub whose constructor throws (legacy browsers). */
class UnsupportedBroadcastChannel {
  constructor() {
    throw new Error("BroadcastChannel is not supported");
  }
}

function postWindowMessage(data: unknown, origin = window.location.origin) {
  window.dispatchEvent(new MessageEvent("message", { data, origin }));
}

function validMessage(state: string, code = "auth-code-123") {
  return { type: OAUTH_CALLBACK_MESSAGE_TYPE, code, state };
}

describe("waitForOAuthCallback", () => {
  beforeEach(() => {
    FakeBroadcastChannel.reset();
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves with code and state on a valid postMessage", async () => {
    const wait = waitForOAuthCallback(fakePopup(), "state-1", () => {});
    postWindowMessage(validMessage("state-1"));
    await expect(wait).resolves.toEqual({ code: "auth-code-123", state: "state-1" });
  });

  it("resolves on a valid BroadcastChannel delivery (COOP path)", async () => {
    const wait = waitForOAuthCallback(fakePopup(), "state-1", () => {});
    FakeBroadcastChannel.deliver(validMessage("state-1"));
    await expect(wait).resolves.toEqual({ code: "auth-code-123", state: "state-1" });
  });

  it("ignores messages from a different origin", async () => {
    vi.useFakeTimers();
    const wait = waitForOAuthCallback(fakePopup(), "state-1", () => {});
    const settled = vi.fn();
    wait.then(settled, settled);

    postWindowMessage(validMessage("state-1"), "https://evil.example.com");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).not.toHaveBeenCalled();

    // Deliver a genuine message so the promise settles and cleans up.
    postWindowMessage(validMessage("state-1"));
    await vi.runOnlyPendingTimersAsync();
    await expect(wait).resolves.toBeDefined();
  });

  it("ignores unrelated message payloads", async () => {
    vi.useFakeTimers();
    const wait = waitForOAuthCallback(fakePopup(), "state-1", () => {});
    const settled = vi.fn();
    wait.then(settled, settled);

    postWindowMessage({ type: "something-else", code: "x", state: "state-1" });
    postWindowMessage(undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).not.toHaveBeenCalled();

    postWindowMessage(validMessage("state-1"));
    await vi.runOnlyPendingTimersAsync();
    await expect(wait).resolves.toBeDefined();
  });

  it("rejects on state mismatch", async () => {
    const wait = waitForOAuthCallback(fakePopup(), "state-1", () => {});
    postWindowMessage(validMessage("state-WRONG"));
    await expect(wait).rejects.toThrow(/state mismatch/i);
  });

  it("rejects when the callback carries no code", async () => {
    const wait = waitForOAuthCallback(fakePopup(), "state-1", () => {});
    postWindowMessage(validMessage("state-1", ""));
    await expect(wait).rejects.toThrow(/no authorization code/i);
  });

  it("rejects with a cancellation error and closes the popup on dispose", async () => {
    const popup = fakePopup();
    let dispose: (() => void) | undefined;
    const wait = waitForOAuthCallback(popup, "state-1", (d) => {
      dispose = d;
    });

    dispose?.();
    await expect(wait).rejects.toThrow(/cancelled/i);
    expect(popup.closed).toBe(true);
  });

  it("rejects on timeout and closes the popup", async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    const wait = waitForOAuthCallback(popup, "state-1", () => {});
    const rejection = expect(wait).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
    expect(popup.closed).toBe(true);
  });

  it("does NOT treat popup.closed as user-close when BroadcastChannel is available (COOP)", async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    popup.closed = true; // COOP makes this permanently true.
    const wait = waitForOAuthCallback(popup, "state-1", () => {});
    const settled = vi.fn();
    wait.then(settled, settled);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).not.toHaveBeenCalled();

    FakeBroadcastChannel.deliver(validMessage("state-1"));
    await vi.runOnlyPendingTimersAsync();
    await expect(wait).resolves.toBeDefined();
  });

  it("rejects as user-closed after the grace period when BroadcastChannel is unavailable", async () => {
    vi.stubGlobal("BroadcastChannel", UnsupportedBroadcastChannel);
    vi.useFakeTimers();
    const popup = fakePopup();
    const wait = waitForOAuthCallback(popup, "state-1", () => {});
    const rejection = expect(wait).rejects.toThrow(/closed before completing/i);

    popup.closed = true;
    // First poll marks closedAt; rejection fires only after the 5s grace.
    await vi.advanceTimersByTimeAsync(6_000);
    await rejection;
  });

  it("settles exactly once even when multiple transports deliver", async () => {
    const wait = waitForOAuthCallback(fakePopup(), "state-1", () => {});
    postWindowMessage(validMessage("state-1"));
    FakeBroadcastChannel.deliver(validMessage("state-WRONG"));
    await expect(wait).resolves.toEqual({ code: "auth-code-123", state: "state-1" });
  });
});

describe("openOAuthPopup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a named about:blank popup and returns the window handle", () => {
    const fake = {} as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fake);

    expect(openOAuthPopup()).toBe(fake);
    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      "stigmer_oauth",
      expect.stringContaining("popup=yes"),
    );
  });

  it("returns null when the browser blocks the popup", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openOAuthPopup()).toBeNull();
  });
});

describe("popupBlockedError", () => {
  it("explains what happened and what to do", () => {
    const err = popupBlockedError();
    expect(err.message).toMatch(/blocked/i);
    expect(err.message).toMatch(/allow popups/i);
  });
});

describe("closeOAuthPopup", () => {
  it("closes the popup and tolerates null", () => {
    const popup = fakePopup();
    closeOAuthPopup(popup);
    expect(popup.closed).toBe(true);
    expect(() => closeOAuthPopup(null)).not.toThrow();
  });

  it("swallows cross-origin close() throws", () => {
    const popup: OAuthPopupHandle = {
      closed: false,
      close() {
        throw new Error("cross-origin");
      },
    };
    expect(() => closeOAuthPopup(popup)).not.toThrow();
  });
});
