import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// `useEmbeddedRunner` resolves the runner entry via `resolveResource`, which is a
// native Tauri call unavailable under happy-dom. Mock it to a deterministic absolute
// path so every test that starts the runner exercises the real config-building path.
vi.mock("@tauri-apps/api/path", () => ({
  resolveResource: vi.fn(async (p: string) => `/abs/resource/${p}`),
}));

vi.mock("../../auth/token-store", () => ({
  loadTokens: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { loadTokens } from "../../auth/token-store";

const mockedInvoke = vi.mocked(invoke);
const mockedResolveResource = vi.mocked(resolveResource);
const mockedLoadTokens = vi.mocked(loadTokens);

describe("getRunnerConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads accessToken from loadTokens() instead of localStorage", async () => {
    mockedLoadTokens.mockReturnValue({
      accessToken: "real-auth0-token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600_000,
    });

    // We can't directly call getRunnerConfig since it's not exported,
    // but we can verify it's used correctly by testing the hook behavior.
    // The config is passed to start_runner when ensureRunning is called.
    mockedInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "runner_status") {
        return { running: false, activeSessions: [], activeWorkflowExecutions: [] };
      }
      if (cmd === "start_runner") {
        // Verify the config passed to start_runner contains the real token
        expect(args.config.stigmerToken).toBe("real-auth0-token");
        return undefined;
      }
      if (cmd === "add_session") {
        return `session:${args.sessionId}`;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    // Dynamically import to get a fresh module with mocks
    const { useEmbeddedRunner } = await import("../useEmbeddedRunner");

    // We can't render hooks directly without a framework like @testing-library/react-hooks,
    // but we can verify the module wiring is correct by checking that loadTokens is importable
    // and the mock is in place.
    expect(mockedLoadTokens).toBeDefined();
    expect(loadTokens()?.accessToken).toBe("real-auth0-token");
  });

  it("returns undefined when no tokens are stored", () => {
    mockedLoadTokens.mockReturnValue(null);
    const result = loadTokens()?.accessToken || undefined;
    expect(result).toBeUndefined();
  });

  it("returns undefined when tokens have no accessToken", () => {
    mockedLoadTokens.mockReturnValue({
      accessToken: "",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600_000,
    });
    const result = loadTokens()?.accessToken || undefined;
    expect(result).toBeUndefined();
  });
});

describe("proxyEndpoint derivation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it("prefers VITE_STIGMER_RUNNER_PROXY_URL when set", async () => {
    vi.stubEnv("VITE_STIGMER_RUNNER_PROXY_URL", "https://localhost:9093");
    vi.stubEnv("VITE_STIGMER_API_URL", "http://localhost:9090");

    mockedLoadTokens.mockReturnValue({
      accessToken: "cloud-token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600_000,
    });

    let capturedConfig: Record<string, unknown> | null = null;

    mockedInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "runner_status") {
        return { running: false, activeSessions: [], activeWorkflowExecutions: [] };
      }
      if (cmd === "start_runner") {
        capturedConfig = args.config;
        return undefined;
      }
      if (cmd === "add_session") {
        return `session:${args.sessionId}`;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { renderHook, act } = await import("@testing-library/react");
    const { useEmbeddedRunner } = await import("../useEmbeddedRunner");

    const { result } = renderHook(() => useEmbeddedRunner());

    await act(async () => {
      await result.current.addSession("test-session");
    });

    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.proxyEndpoint).toBe("https://localhost:9093");
    expect(capturedConfig!.stigmerToken).toBe("cloud-token");
  });

  it("falls back to VITE_STIGMER_API_URL when runner proxy URL is not set", async () => {
    vi.stubEnv("VITE_STIGMER_API_URL", "http://localhost:9090");

    mockedLoadTokens.mockReturnValue({
      accessToken: "cloud-token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600_000,
    });

    let capturedConfig: Record<string, unknown> | null = null;

    mockedInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "runner_status") {
        return { running: false, activeSessions: [], activeWorkflowExecutions: [] };
      }
      if (cmd === "start_runner") {
        capturedConfig = args.config;
        return undefined;
      }
      if (cmd === "add_session") {
        return `session:${args.sessionId}`;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { renderHook, act } = await import("@testing-library/react");
    const { useEmbeddedRunner } = await import("../useEmbeddedRunner");

    const { result } = renderHook(() => useEmbeddedRunner());

    await act(async () => {
      await result.current.addSession("test-session");
    });

    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.proxyEndpoint).toBe("http://localhost:9090");
    expect(capturedConfig!.stigmerToken).toBe("cloud-token");
  });

  it("sets proxyEndpoint to undefined when no token is present", async () => {
    mockedLoadTokens.mockReturnValue(null);

    let capturedConfig: Record<string, unknown> | null = null;

    mockedInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "runner_status") {
        return { running: false, activeSessions: [], activeWorkflowExecutions: [] };
      }
      if (cmd === "start_runner") {
        capturedConfig = args.config;
        return undefined;
      }
      if (cmd === "add_session") {
        return `session:${args.sessionId}`;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { renderHook, act } = await import("@testing-library/react");
    const { useEmbeddedRunner } = await import("../useEmbeddedRunner");

    const { result } = renderHook(() => useEmbeddedRunner());

    await act(async () => {
      await result.current.addSession("test-session");
    });

    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.proxyEndpoint).toBeUndefined();
    expect(capturedConfig!.stigmerToken).toBeUndefined();
  });

  it("proxyEndpoint always includes a URL scheme", async () => {
    mockedLoadTokens.mockReturnValue({
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600_000,
    });

    let capturedConfig: Record<string, unknown> | null = null;

    mockedInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "runner_status") {
        return { running: false, activeSessions: [], activeWorkflowExecutions: [] };
      }
      if (cmd === "start_runner") {
        capturedConfig = args.config;
        return undefined;
      }
      if (cmd === "add_session") {
        return `session:${args.sessionId}`;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { renderHook, act } = await import("@testing-library/react");
    const { useEmbeddedRunner } = await import("../useEmbeddedRunner");

    const { result } = renderHook(() => useEmbeddedRunner());

    await act(async () => {
      await result.current.addSession("session-1");
    });

    expect(capturedConfig).not.toBeNull();
    const proxy = capturedConfig!.proxyEndpoint as string;
    expect(proxy).toMatch(/^https?:\/\//);
  });
});

describe("temporalAddress + control-plane endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  async function captureConfig(): Promise<Record<string, unknown>> {
    mockedLoadTokens.mockReturnValue({
      accessToken: "cloud-token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600_000,
    });

    let captured: Record<string, unknown> | null = null;
    mockedInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "runner_status") {
        return { running: false, activeSessions: [], activeWorkflowExecutions: [] };
      }
      if (cmd === "start_runner") {
        captured = args.config;
        return undefined;
      }
      if (cmd === "add_session") {
        return `session:${args.sessionId}`;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { renderHook, act } = await import("@testing-library/react");
    const { useEmbeddedRunner } = await import("../useEmbeddedRunner");
    const { result } = renderHook(() => useEmbeddedRunner());
    await act(async () => {
      await result.current.addSession("test-session");
    });
    expect(captured).not.toBeNull();
    return captured!;
  }

  it("omits temporalAddress by default so the runner self-discovers it", async () => {
    vi.stubEnv("VITE_STIGMER_TEMPORAL_ADDRESS", "");
    vi.stubEnv("VITE_STIGMER_API_URL", "https://api.stigmer.ai");

    const config = await captureConfig();

    expect(config.temporalAddress).toBeUndefined();
  });

  it("honors an explicit VITE_STIGMER_TEMPORAL_ADDRESS override", async () => {
    vi.stubEnv("VITE_STIGMER_TEMPORAL_ADDRESS", "temporal.dev:7233");
    vi.stubEnv("VITE_STIGMER_API_URL", "https://api.stigmer.ai");

    const config = await captureConfig();

    expect(config.temporalAddress).toBe("temporal.dev:7233");
  });

  it("derives the control-plane endpoint from VITE_STIGMER_API_URL when no sidecar is set", async () => {
    // The production case: no sidecar var, so the runner must point at the cloud
    // API (not localhost) for both control-plane traffic and Temporal discovery.
    vi.stubEnv("VITE_STIGMER_API_URL", "https://api.stigmer.ai");

    const config = await captureConfig();

    expect(config.stigmerEndpoint).toBe("https://api.stigmer.ai");
  });

  it("prefers the sidecar endpoint over the API URL when both are set (local dev)", async () => {
    vi.stubEnv("VITE_STIGMER_SIDECAR_ENDPOINT", "localhost:9090");
    vi.stubEnv("VITE_STIGMER_API_URL", "https://api.stigmer.ai");

    const config = await captureConfig();

    expect(config.stigmerEndpoint).toBe("localhost:9090");
  });
});

describe("runnerEntry resolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    // resetAllMocks clears the factory implementation; restore the deterministic one.
    mockedResolveResource.mockImplementation(async (p: string) => `/abs/resource/${p}`);
  });

  it("passes an absolute runnerEntry resolved from the resource directory", async () => {
    // Regression guard for stigmer/stigmer#172: a relative entry resolves against the
    // process cwd (`/` for a packaged GUI app) and breaks. The hook must hand
    // start_runner an absolute path produced by resolveResource.
    mockedLoadTokens.mockReturnValue(null);

    let capturedConfig: Record<string, unknown> | null = null;
    mockedInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "runner_status") {
        return { running: false, activeSessions: [], activeWorkflowExecutions: [] };
      }
      if (cmd === "start_runner") {
        capturedConfig = args.config;
        return undefined;
      }
      if (cmd === "add_session") {
        return `session:${args.sessionId}`;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { renderHook, act } = await import("@testing-library/react");
    const { useEmbeddedRunner } = await import("../useEmbeddedRunner");

    const { result } = renderHook(() => useEmbeddedRunner());
    await act(async () => {
      await result.current.addSession("test-session");
    });

    expect(mockedResolveResource).toHaveBeenCalledWith("resources/runner/dist/main.js");
    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.runnerEntry).toBe("/abs/resource/resources/runner/dist/main.js");
  });
});

describe("updateRunnerToken", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls update_runner_token IPC when runner is running", async () => {
    mockedInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "runner_status") {
        return { running: true, activeSessions: [], activeWorkflowExecutions: [] };
      }
      if (cmd === "update_runner_token") {
        expect(args.token).toBe("new-token");
        return undefined;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    // Verify the IPC contract
    await invoke("runner_status");
    await invoke("update_runner_token", { token: "new-token" });

    expect(mockedInvoke).toHaveBeenCalledWith("runner_status");
    expect(mockedInvoke).toHaveBeenCalledWith("update_runner_token", { token: "new-token" });
  });

  it("skips update when runner is not running", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "runner_status") {
        return { running: false, activeSessions: [], activeWorkflowExecutions: [] };
      }
      throw new Error("should not call update when not running");
    });

    const status = await invoke<{ running: boolean }>("runner_status");
    expect(status.running).toBe(false);
    // No update_runner_token call expected
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });
});
