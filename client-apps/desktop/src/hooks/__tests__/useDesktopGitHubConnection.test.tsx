// ---------------------------------------------------------------------------
// useDesktopGitHubConnection — GitHub sign-in from a webview that cannot open
// popups
//
// Run over Tauri's IPC mock; the SDK's useGitHubConnection is replaced by a
// recorder, since what this hook owns is the wiring around it:
//
//   - where the login page returns: the web console's desktop bridge on
//     Stigmer Cloud in a packaged build, the host's loopback callback server
//     (by its port) in every other edition and in any development build;
//   - the browser is the system browser, opened by the host;
//   - a `sign-in-callback` event is completed exactly with its code and its
//     state; an event carrying an error, or missing its code or state, is
//     never completed;
//   - the localhost server is one-shot, so it is started again after every
//     callback, good or bad;
//   - a server that fails to start, and a completion that fails, are logged,
//     never thrown into the webview.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UseGitHubConnectionConfig } from "@stigmer/react";
import { mockTauri, type TauriMock } from "../../__test-utils__/tauri";

const sdk = vi.hoisted(() => ({
  mode: "cloud" as string,
  configs: [] as (UseGitHubConnectionConfig | undefined)[],
  handleCallback: vi.fn(async (_code: string, _state: string) => {}),
}));

vi.mock("@stigmer/react", () => ({
  useDeploymentMode: () => sdk.mode,
  useGitHubConnection: (
    _org: string | null,
    config?: UseGitHubConnectionConfig,
  ) => {
    sdk.configs.push(config);
    return { handleCallback: sdk.handleCallback };
  },
}));

import { useDesktopGitHubConnection } from "../useDesktopGitHubConnection";

function host(): TauriMock {
  let port = 41000;
  return mockTauri({
    start_sign_in_callback_server: () => ++port,
    open_auth_in_browser: () => null,
  });
}

const latestConfig = () => sdk.configs.at(-1);

describe("useDesktopGitHubConnection", () => {
  beforeEach(() => {
    sdk.mode = "cloud";
    sdk.configs = [];
    sdk.handleCallback.mockReset();
    sdk.handleCallback.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("on Stigmer Cloud, packaged", () => {
    beforeEach(() => {
      vi.stubEnv("DEV", false);
    });

    it("sends GitHub back through the web console's desktop hand-back page, with no local server", async () => {
      const tauri = host();
      renderHook(() => useDesktopGitHubConnection("acme"));

      expect(latestConfig()?.returnTo).toEqual({ kind: "desktop" });
      await act(async () => {});
      expect(tauri.callsTo("start_sign_in_callback_server")).toEqual([]);
    });

    it("opens the authorization in the system browser through the host", async () => {
      const tauri = host();
      renderHook(() => useDesktopGitHubConnection("acme"));

      await act(
        () =>
          latestConfig()?.openUrl?.(
            "https://github.com/login/oauth/authorize?x=1",
          ) ?? Promise.resolve(),
      );
      expect(tauri.callsTo("open_auth_in_browser")).toEqual([
        { authUrl: "https://github.com/login/oauth/authorize?x=1" },
      ]);
    });

    it("completes a deep-linked callback with its code and its state", async () => {
      const tauri = host();
      renderHook(() => useDesktopGitHubConnection("acme"));
      await act(async () => {});

      await act(() =>
        tauri.emit("sign-in-callback", { code: "gh-code", state: "gh-state" }),
      );

      expect(sdk.handleCallback).toHaveBeenCalledTimes(1);
      expect(sdk.handleCallback).toHaveBeenCalledWith("gh-code", "gh-state");
    });
  });

  describe.each(["local", "enterprise"])("in the %s edition", (mode) => {
    beforeEach(() => {
      sdk.mode = mode;
      vi.stubEnv("DEV", false);
    });

    it("starts the loopback callback server and returns the login page to its port", async () => {
      const tauri = host();
      renderHook(() => useDesktopGitHubConnection("acme"));

      await waitFor(() =>
        expect(latestConfig()?.returnTo).toEqual({ kind: "loopback", port: 41001 }),
      );
      expect(tauri.callsTo("start_sign_in_callback_server")).toHaveLength(1);
    });

    it("logs a callback server that fails to start", async () => {
      mockTauri({ start_sign_in_callback_server: () => Promise.reject(new Error("port in use")) });
      renderHook(() => useDesktopGitHubConnection("acme"));
      await waitFor(() =>
        expect(console.error).toHaveBeenCalledWith(
          "Failed to start the sign-in callback server:",
          expect.anything(),
        ),
      );
    });

    it("logs a completion that fails", async () => {
      const tauri = host();
      sdk.handleCallback.mockRejectedValue(new Error("exchange refused"));
      renderHook(() => useDesktopGitHubConnection("acme"));
      await waitFor(() => expect(latestConfig()?.returnTo).toBeDefined());

      await act(() => tauri.emit("sign-in-callback", { code: "c", state: "s" }));

      await waitFor(() =>
        expect(console.error).toHaveBeenCalledWith("GitHub sign-in failed:", expect.any(Error)),
      );
    });

    it("completes the callback, then starts a fresh one-shot server", async () => {
      const tauri = host();
      renderHook(() => useDesktopGitHubConnection("acme"));
      await waitFor(() => expect(latestConfig()?.returnTo).toBeDefined());

      await act(() => tauri.emit("sign-in-callback", { code: "c", state: "s" }));

      expect(sdk.handleCallback).toHaveBeenCalledWith("c", "s");
      await waitFor(() =>
        expect(tauri.callsTo("start_sign_in_callback_server")).toHaveLength(2),
      );
    });

    it("offers no return choice to the SDK until the server has a port", () => {
      mockTauri({ start_sign_in_callback_server: () => new Promise(() => {}) });
      renderHook(() => useDesktopGitHubConnection("acme"));
      expect(latestConfig()).toBeUndefined();
    });
  });

  it("uses the localhost server on Stigmer Cloud too in a development build, where deep links reach the packaged app", async () => {
    const tauri = host();
    renderHook(() => useDesktopGitHubConnection("acme"));

    await waitFor(() =>
      expect(latestConfig()?.returnTo).toEqual({ kind: "loopback", port: 41001 }),
    );
    expect(tauri.callsTo("start_sign_in_callback_server")).toHaveLength(1);
  });

  it.each([
    [
      "an error",
      { error: "access_denied", error_description: "denied", state: "s" },
    ],
    ["no code", { state: "s" }],
    ["no state", { code: "c" }],
  ])(
    "never completes a callback carrying %s, and restarts the one-shot server",
    async (_label, payload) => {
      sdk.mode = "local";
      const tauri = host();
      renderHook(() => useDesktopGitHubConnection("acme"));
      await waitFor(() =>
        expect(tauri.callsTo("start_sign_in_callback_server")).toHaveLength(1),
      );

      await act(() => tauri.emit("sign-in-callback", payload));

      expect(sdk.handleCallback).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(tauri.callsTo("start_sign_in_callback_server")).toHaveLength(2),
      );
    },
  );

  it("stops listening once unmounted", async () => {
    const tauri = host();
    const { unmount } = renderHook(() => useDesktopGitHubConnection("acme"));
    await act(async () => {});
    unmount();
    await act(async () => {});

    await act(() => tauri.emit("sign-in-callback", { code: "c", state: "s" }));
    expect(sdk.handleCallback).not.toHaveBeenCalled();
  });
});
