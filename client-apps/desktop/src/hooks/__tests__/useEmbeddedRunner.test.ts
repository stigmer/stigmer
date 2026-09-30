// ---------------------------------------------------------------------------
// useEmbeddedRunner — the desktop starts its embedded runner once, with the
// right configuration, and keeps it in step with the host
//
// Run over Tauri's IPC mock (src/__test-utils__/tauri.ts): the hook's real
// `invoke` and `resolveResource` calls reach handlers named by their wire
// commands, and the session comes from the real token store. Pinned here:
//
//   - getRunnerConfig: the control-plane endpoint, the proxy endpoint (only
//     with a session, always with a scheme), the Temporal override, the
//     runner entry (absolute, or the dev build's live tree) and the bundled
//     Node runtime;
//   - the lifecycle: the runner starts lazily, once, however many sessions
//     ask at the same moment; a failed start surfaces its error and can be
//     retried; a runner the host already runs is adopted, not restarted;
//   - the host's truth wins after a remove, and a token update reaches only a
//     running runner.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  mockTauri,
  type CommandArgs,
  type CommandHandlers,
  type TauriMock,
} from "../../__test-utils__/tauri";
import { saveTokens } from "../../auth/token-store";
import {
  getRunnerConfig,
  useEmbeddedRunner,
  type RunnerConfig,
} from "../useEmbeddedRunner";

// What the desktop's `bundled_node_path` command answers in these tests: the absolute
// path of the Node runtime the build carries (src-tauri/src/runner.rs).
const BUNDLED_NODE = "/abs/resource/resources/runtime/node";

interface HostState {
  running: boolean;
  activeSessions: string[];
  activeWorkflowExecutions: string[];
}

/** A host that answers like src-tauri's runner commands, with a live state. */
function runnerHost(overrides: CommandHandlers = {}): {
  tauri: TauriMock;
  state: HostState;
} {
  const state: HostState = {
    running: false,
    activeSessions: [],
    activeWorkflowExecutions: [],
  };
  const tauri = mockTauri({
    runner_status: () => ({ ...state }),
    bundled_node_path: () => BUNDLED_NODE,
    "plugin:path|resolve_directory": (args: CommandArgs) =>
      `/abs/resource/${String(args.path)}`,
    start_runner: () => {
      state.running = true;
      return null;
    },
    // Idempotent, like the host's own sets (crates/stigmer-runner-host/src/host.rs).
    add_session: (args: CommandArgs) => {
      const id = String(args.sessionId);
      if (!state.activeSessions.includes(id)) state.activeSessions.push(id);
      return `session:${id}`;
    },
    remove_session: () => null,
    add_workflow_execution: (args: CommandArgs) => {
      const id = String(args.executionId);
      if (!state.activeWorkflowExecutions.includes(id))
        state.activeWorkflowExecutions.push(id);
      return `execution:${id}`;
    },
    remove_workflow_execution: () => null,
    update_runner_token: () => null,
    ...overrides,
  });
  return { tauri, state };
}

function signIn(accessToken: string) {
  saveTokens({
    accessToken,
    refreshToken: "refresh",
    expiresAt: Date.now() + 3_600_000,
  });
}

/** Start the runner through the hook, as the first session does, and read the config it was given. */
async function startedConfig(tauri: TauriMock): Promise<RunnerConfig> {
  const { result } = renderHook(() => useEmbeddedRunner());
  await act(async () => {
    await result.current.addSession("test-session");
  });
  const [start] = tauri.callsTo("start_runner");
  expect(start).toBeDefined();
  return start?.config as RunnerConfig;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getRunnerConfig: the session and the proxy", () => {
  it("hands the runner the stored access token as its control-plane credential", async () => {
    runnerHost();
    signIn("real-auth0-token");

    const config = await getRunnerConfig();
    expect(config.stigmerToken).toBe("real-auth0-token");
  });

  it("gives no token and no proxy when nobody is signed in", async () => {
    runnerHost();

    const config = await getRunnerConfig();
    expect(config.stigmerToken).toBeUndefined();
    expect(config.proxyEndpoint).toBeUndefined();
  });

  it("treats an empty stored access token as no session", async () => {
    runnerHost();
    signIn("");

    const config = await getRunnerConfig();
    expect(config.stigmerToken).toBeUndefined();
    expect(config.proxyEndpoint).toBeUndefined();
  });

  it("prefers VITE_STIGMER_RUNNER_PROXY_URL when set", async () => {
    vi.stubEnv("VITE_STIGMER_RUNNER_PROXY_URL", "https://localhost:9093");
    vi.stubEnv("VITE_STIGMER_API_URL", "http://localhost:9090");
    runnerHost();
    signIn("cloud-token");

    const config = await getRunnerConfig();
    expect(config.proxyEndpoint).toBe("https://localhost:9093");
    expect(config.stigmerToken).toBe("cloud-token");
  });

  it("falls back to VITE_STIGMER_API_URL when the runner proxy URL is not set", async () => {
    vi.stubEnv("VITE_STIGMER_API_URL", "http://localhost:9090");
    runnerHost();
    signIn("cloud-token");

    const config = await getRunnerConfig();
    expect(config.proxyEndpoint).toBe("http://localhost:9090");
  });

  it.each([
    ["a bare host", "localhost:9090", "http://localhost:9090"],
    ["a bare TLS host", "api.stigmer.ai:443", "https://api.stigmer.ai:443"],
  ])(
    "gives the proxy a URL scheme when the only endpoint is %s",
    async (_label, sidecar, proxy) => {
      vi.stubEnv("VITE_STIGMER_API_URL", "");
      vi.stubEnv("VITE_STIGMER_SIDECAR_ENDPOINT", sidecar);
      runnerHost();
      signIn("token");

      const config = await getRunnerConfig();
      expect(config.proxyEndpoint).toBe(proxy);
    },
  );
});

describe("getRunnerConfig: Temporal and the control-plane endpoint", () => {
  beforeEach(() => {
    signIn("cloud-token");
  });

  it("omits temporalAddress by default so the runner self-discovers it", async () => {
    vi.stubEnv("VITE_STIGMER_TEMPORAL_ADDRESS", "");
    vi.stubEnv("VITE_STIGMER_API_URL", "https://api.stigmer.ai");
    runnerHost();

    expect("temporalAddress" in (await getRunnerConfig())).toBe(false);
  });

  it("honors an explicit VITE_STIGMER_TEMPORAL_ADDRESS override", async () => {
    vi.stubEnv("VITE_STIGMER_TEMPORAL_ADDRESS", "temporal.dev:7233");
    vi.stubEnv("VITE_STIGMER_API_URL", "https://api.stigmer.ai");
    runnerHost();

    expect((await getRunnerConfig()).temporalAddress).toBe("temporal.dev:7233");
  });

  it("derives the control-plane endpoint from VITE_STIGMER_API_URL when no sidecar is set", async () => {
    // The production case: no sidecar var, so the runner must point at the cloud
    // API (not localhost) for both control-plane traffic and Temporal discovery.
    vi.stubEnv("VITE_STIGMER_API_URL", "https://api.stigmer.ai");
    runnerHost();

    expect((await getRunnerConfig()).stigmerEndpoint).toBe(
      "https://api.stigmer.ai",
    );
  });

  it("prefers the sidecar endpoint over the API URL when both are set (local dev)", async () => {
    vi.stubEnv("VITE_STIGMER_SIDECAR_ENDPOINT", "localhost:9090");
    vi.stubEnv("VITE_STIGMER_API_URL", "https://api.stigmer.ai");
    runnerHost();

    expect((await getRunnerConfig()).stigmerEndpoint).toBe("localhost:9090");
  });
});

describe("getRunnerConfig: the runner entry and the Node runtime", () => {
  it("passes an absolute runnerEntry resolved from the resource directory", async () => {
    // Regression guard for stigmer/stigmer#172: a relative entry resolves against the
    // process cwd (`/` for a packaged GUI app) and breaks. The hook must hand
    // start_runner an absolute path produced by resolveResource.
    const { tauri } = runnerHost();

    const config = await getRunnerConfig();
    expect(tauri.callsTo("plugin:path|resolve_directory")).toEqual([
      expect.objectContaining({ path: "resources/runner/dist/main.js" }),
    ]);
    expect(config.runnerEntry).toBe(
      "/abs/resource/resources/runner/dist/main.js",
    );
  });

  it("prefers VITE_STIGMER_RUNNER_ENTRY in dev and bypasses the staged copy", async () => {
    // Regression guard for stigmer/stigmer#181: Tauri's staged resource copy
    // drifts (fresh dist/ over stale src/) and trips the runner freshness guard.
    // In dev, setup-runner-dev.sh injects the live in-repo runner entry, which the
    // hook must use verbatim instead of resolving the drift-prone staged copy.
    vi.stubEnv(
      "VITE_STIGMER_RUNNER_ENTRY",
      "/repo/backend/services/runner/dist/main.js",
    );
    const { tauri } = runnerHost();

    const config = await getRunnerConfig();
    expect(tauri.callsTo("plugin:path|resolve_directory")).toEqual([]);
    expect(config.runnerEntry).toBe(
      "/repo/backend/services/runner/dist/main.js",
    );
  });

  it("ignores VITE_STIGMER_RUNNER_ENTRY in a packaged build", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv(
      "VITE_STIGMER_RUNNER_ENTRY",
      "/repo/backend/services/runner/dist/main.js",
    );
    runnerHost();

    expect((await getRunnerConfig()).runnerEntry).toBe(
      "/abs/resource/resources/runner/dist/main.js",
    );
  });

  it("starts the runner with the bundled Node runtime, never a bare `node`", async () => {
    // Regression guard for stigmer/stigmer#1068: a bare `node` resolves against the GUI
    // session's PATH, which for an app launched from Finder, the Dock or the Start menu
    // holds no user-installed Node. The hook must hand start_runner the absolute path of
    // the engine the build carries, as the desktop's bundled_node_path command reports it.
    const { tauri } = runnerHost();

    const config = await startedConfig(tauri);
    expect(tauri.callsTo("bundled_node_path")).toHaveLength(1);
    expect(config.nodeBinary).toBe(BUNDLED_NODE);
  });
});

describe("the runner lifecycle", () => {
  it("starts the runner lazily: nothing at mount, then on the first session", async () => {
    const { tauri } = runnerHost();
    const { result } = renderHook(() => useEmbeddedRunner());
    expect(tauri.calls).toEqual([]);
    expect(result.current.isRunning).toBe(false);

    let queue = "";
    await act(async () => {
      queue = await result.current.addSession("s1");
    });

    expect(queue).toBe("session:s1");
    expect(tauri.callsTo("start_runner")).toHaveLength(1);
    expect(result.current.isRunning).toBe(true);
    expect(result.current.activeSessions).toEqual(["s1"]);
  });

  it("starts the runner once when several sessions ask at the same moment", async () => {
    // Regression guard for stigmer/stigmer#1505: the start guard was set only
    // after the status read, so two callers both started the runner and the
    // host refused the second.
    let finishStart: () => void = () => {};
    const { tauri, state } = runnerHost({
      start_runner: () =>
        new Promise<null>((resolve) => {
          finishStart = () => {
            state.running = true;
            resolve(null);
          };
        }),
    });
    const { result } = renderHook(() => useEmbeddedRunner());

    let both: Promise<[string, string]> = Promise.resolve(["", ""]);
    await act(async () => {
      both = Promise.all([
        result.current.addSession("s1"),
        result.current.addWorkflowExecution("e1"),
      ]);
      await vi.waitFor(() =>
        expect(tauri.callsTo("start_runner")).toHaveLength(1),
      );
    });
    await act(async () => {
      finishStart();
      await both;
    });

    expect(tauri.callsTo("start_runner")).toHaveLength(1);
    expect(result.current.activeSessions).toEqual(["s1"]);
    expect(result.current.activeWorkflowExecutions).toEqual(["e1"]);
  });

  it("starts the runner again once it has exited since it was started", async () => {
    // The second half of stigmer/stigmer#1505: a start that succeeded used to
    // be remembered forever, so a runner that later exited was never restarted.
    const { tauri, state } = runnerHost();
    const { result } = renderHook(() => useEmbeddedRunner());
    await act(async () => {
      await result.current.addSession("s1");
    });

    state.running = false;
    state.activeSessions = [];
    await act(async () => {
      await result.current.addSession("s2");
    });

    expect(tauri.callsTo("start_runner")).toHaveLength(2);
    expect(result.current.isRunning).toBe(true);
  });

  it("gives every caller waiting on one failed start the same error", async () => {
    let fail: (reason: string) => void = () => {};
    const { tauri } = runnerHost({
      start_runner: () =>
        new Promise<null>((_resolve, reject) => {
          fail = reject;
        }),
    });
    const { result } = renderHook(() => useEmbeddedRunner());

    let outcomes: Promise<PromiseSettledResult<string>[]> = Promise.resolve([]);
    await act(async () => {
      outcomes = Promise.allSettled([
        result.current.addSession("s1"),
        result.current.addSession("s2"),
      ]);
      await vi.waitFor(() =>
        expect(tauri.callsTo("start_runner")).toHaveLength(1),
      );
    });
    await act(async () => {
      fail("spawn failed");
      await outcomes;
    });

    expect((await outcomes).map((outcome) => outcome.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(tauri.callsTo("start_runner")).toHaveLength(1);
    expect(tauri.callsTo("add_session")).toEqual([]);
    expect(result.current.error).toBe("spawn failed");
  });

  it("surfaces a build without its runtime as the start error instead of spawning", async () => {
    const missing = "This build of Stigmer carries no Node runtime";
    const { tauri } = runnerHost({
      bundled_node_path: () => {
        throw missing;
      },
    });
    const { result } = renderHook(() => useEmbeddedRunner());

    await act(async () => {
      await expect(result.current.addSession("test-session")).rejects.toBe(
        missing,
      );
    });

    expect(tauri.callsTo("start_runner")).toEqual([]);
    expect(result.current.error).toBe(missing);
    expect(result.current.isRunning).toBe(false);
  });

  it("lets a failed start be retried, and clears the error once it succeeds", async () => {
    let failing = true;
    const { tauri, state } = runnerHost({
      start_runner: () => {
        if (failing) throw "spawn failed";
        state.running = true;
        return null;
      },
    });
    const { result } = renderHook(() => useEmbeddedRunner());

    await act(async () => {
      await expect(result.current.addSession("s1")).rejects.toBe(
        "spawn failed",
      );
    });
    expect(result.current.error).toBe("spawn failed");

    failing = false;
    await act(async () => {
      await result.current.addSession("s1");
    });

    expect(tauri.callsTo("start_runner")).toHaveLength(2);
    expect(result.current.error).toBeNull();
    expect(result.current.isRunning).toBe(true);
  });

  it("adopts a runner the host already runs, with its sessions, instead of starting another", async () => {
    const { tauri, state } = runnerHost();
    state.running = true;
    state.activeSessions = ["earlier"];
    state.activeWorkflowExecutions = ["exec-0"];
    const { result } = renderHook(() => useEmbeddedRunner());

    await act(async () => {
      await result.current.addSession("s1");
    });

    expect(tauri.callsTo("start_runner")).toEqual([]);
    expect(result.current.activeSessions).toEqual(["earlier", "s1"]);
    expect(result.current.activeWorkflowExecutions).toEqual(["exec-0"]);
  });

  it("lists a session once, however many times it is added", async () => {
    runnerHost();
    const { result } = renderHook(() => useEmbeddedRunner());

    await act(async () => {
      await result.current.addSession("s1");
      await result.current.addSession("s1");
    });
    expect(result.current.activeSessions).toEqual(["s1"]);
  });

  it("takes the host's word after a remove, keeping a session whose run continues in the background", async () => {
    const { tauri, state } = runnerHost();
    const { result } = renderHook(() => useEmbeddedRunner());
    await act(async () => {
      await result.current.addSession("s1");
      await result.current.addSession("s2");
    });

    // The host defers s1's teardown (an execution is in flight) and drops s2.
    state.activeSessions = ["s1"];
    await act(async () => {
      await result.current.removeSession("s2");
    });

    expect(tauri.callsTo("remove_session")).toEqual([{ sessionId: "s2" }]);
    expect(result.current.activeSessions).toEqual(["s1"]);
  });

  it("drops a removed workflow execution", async () => {
    runnerHost();
    const { result } = renderHook(() => useEmbeddedRunner());
    await act(async () => {
      await result.current.addWorkflowExecution("e1");
      await result.current.addWorkflowExecution("e2");
      await result.current.removeWorkflowExecution("e1");
    });
    expect(result.current.activeWorkflowExecutions).toEqual(["e2"]);
  });

  it("keeps the last known state when a status poll fails", async () => {
    const { tauri } = runnerHost();
    const { result } = renderHook(() => useEmbeddedRunner());
    await act(async () => {
      await result.current.addSession("s1");
    });

    tauri.handle({
      runner_status: () => {
        throw "host busy";
      },
    });
    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(result.current.isRunning).toBe(true);
    expect(result.current.activeSessions).toEqual(["s1"]);
  });
});

describe("updateRunnerToken", () => {
  it("sends the new token to a running runner", async () => {
    const { tauri, state } = runnerHost();
    state.running = true;
    const { result } = renderHook(() => useEmbeddedRunner());

    await act(async () => {
      await result.current.updateRunnerToken("new-token");
    });
    expect(tauri.callsTo("update_runner_token")).toEqual([
      { token: "new-token" },
    ]);
  });

  it("sends nothing when the runner is not running", async () => {
    const { tauri } = runnerHost();
    const { result } = renderHook(() => useEmbeddedRunner());

    await act(async () => {
      await result.current.updateRunnerToken("new-token");
    });
    expect(tauri.callsTo("runner_status")).toHaveLength(1);
    expect(tauri.callsTo("update_runner_token")).toEqual([]);
  });
});
