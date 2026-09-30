// ---------------------------------------------------------------------------
// useDesktopGitHubConnection — GitHub sign-in from a webview that cannot open
// popups
//
// Run over Tauri's IPC mock; the SDK's useGitHubConnection is replaced by a
// recorder, since what this hook owns is the wiring around it:
//
//   - the callback URL: the web console's desktop hand-back page on Stigmer
//     Cloud in a packaged build, the host's localhost callback server in every
//     other edition and in any development build;
//   - the browser is the system browser, opened by the host;
//   - a `github-callback` event is exchanged exactly with its code, its state
//     and the same callback URL the authorization used; an event carrying an
//     error, or missing its code or state, is never exchanged;
//   - the localhost server is one-shot, so it is started again after every
//     callback, good or bad.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UseGitHubConnectionConfig } from "@stigmer/react";
import { mockTauri, type TauriMock } from "../../__test-utils__/tauri";

const sdk = vi.hoisted(() => ({
  mode: "cloud" as string,
  configs: [] as (UseGitHubConnectionConfig | undefined)[],
  handleCallback: vi.fn(
    async (_code: string, _state: string, _url: string) => {},
  ),
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
import { CONSOLE_URL } from "../../config";

const HOSTED_CALLBACK = `${CONSOLE_URL}/auth/github/callback?source=desktop`;

function host(): TauriMock {
  let port = 41000;
  return mockTauri({
    start_github_callback_server: () => ++port,
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

      expect(latestConfig()?.callbackUrl).toBe(HOSTED_CALLBACK);
      await act(async () => {});
      expect(tauri.callsTo("start_github_callback_server")).toEqual([]);
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

    it("exchanges a deep-linked callback with its code, its state and the hosted callback URL", async () => {
      const tauri = host();
      renderHook(() => useDesktopGitHubConnection("acme"));
      await act(async () => {});

      await act(() =>
        tauri.emit("github-callback", { code: "gh-code", state: "gh-state" }),
      );

      expect(sdk.handleCallback).toHaveBeenCalledTimes(1);
      expect(sdk.handleCallback).toHaveBeenCalledWith(
        "gh-code",
        "gh-state",
        HOSTED_CALLBACK,
      );
    });
  });

  describe.each(["local", "enterprise"])("in the %s edition", (mode) => {
    beforeEach(() => {
      sdk.mode = mode;
      vi.stubEnv("DEV", false);
    });

    it("starts the localhost callback server and redirects GitHub to it", async () => {
      const tauri = host();
      renderHook(() => useDesktopGitHubConnection("acme"));

      await waitFor(() =>
        expect(latestConfig()?.callbackUrl).toBe(
          "http://127.0.0.1:41001/auth/github/callback",
        ),
      );
      expect(tauri.callsTo("start_github_callback_server")).toHaveLength(1);
    });

    it("exchanges with the port the authorization used, then starts a fresh one-shot server", async () => {
      const tauri = host();
      renderHook(() => useDesktopGitHubConnection("acme"));
      await waitFor(() => expect(latestConfig()?.callbackUrl).toBeDefined());

      await act(() => tauri.emit("github-callback", { code: "c", state: "s" }));

      expect(sdk.handleCallback).toHaveBeenCalledWith(
        "c",
        "s",
        "http://127.0.0.1:41001/auth/github/callback",
      );
      await waitFor(() =>
        expect(tauri.callsTo("start_github_callback_server")).toHaveLength(2),
      );
    });

    it("offers no callback URL to the SDK until the server has a port", () => {
      mockTauri({ start_github_callback_server: () => new Promise(() => {}) });
      renderHook(() => useDesktopGitHubConnection("acme"));
      expect(latestConfig()).toBeUndefined();
    });
  });

  it("uses the localhost server on Stigmer Cloud too in a development build, where deep links reach the packaged app", async () => {
    const tauri = host();
    renderHook(() => useDesktopGitHubConnection("acme"));

    await waitFor(() =>
      expect(latestConfig()?.callbackUrl).toBe(
        "http://127.0.0.1:41001/auth/github/callback",
      ),
    );
    expect(tauri.callsTo("start_github_callback_server")).toHaveLength(1);
  });

  it.each([
    [
      "an error",
      { error: "access_denied", error_description: "denied", state: "s" },
    ],
    ["no code", { state: "s" }],
    ["no state", { code: "c" }],
  ])(
    "never exchanges a callback carrying %s, and restarts the one-shot server",
    async (_label, payload) => {
      sdk.mode = "local";
      const tauri = host();
      renderHook(() => useDesktopGitHubConnection("acme"));
      await waitFor(() =>
        expect(tauri.callsTo("start_github_callback_server")).toHaveLength(1),
      );

      await act(() => tauri.emit("github-callback", payload));

      expect(sdk.handleCallback).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(tauri.callsTo("start_github_callback_server")).toHaveLength(2),
      );
    },
  );

  it("stops listening once unmounted", async () => {
    const tauri = host();
    const { unmount } = renderHook(() => useDesktopGitHubConnection("acme"));
    await act(async () => {});
    unmount();
    await act(async () => {});

    await act(() => tauri.emit("github-callback", { code: "c", state: "s" }));
    expect(sdk.handleCallback).not.toHaveBeenCalled();
  });
});
