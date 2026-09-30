// ---------------------------------------------------------------------------
// App — what the desktop shows before and after sign-in, and how it talks
//
// The composition root is pinned with its links replaced by markers:
//
//   - nothing of the app renders until the session is resolved, and a signed-
//     out person sees only the sign-in screen;
//   - the signed-in chain keeps the web console's order (updater, identity
//     gate, fetch cache, organizations, then the routes);
//   - the one SDK client talks to this build's API URL through Tauri's HTTP
//     plugin, with the session's own token getter;
//   - the deployment mode starts as the URL's guess and takes the server's
//     answer when it comes (an Enterprise server included), keeping the
//     guess when the server cannot answer;
//   - a running embedded runner is handed each new access token once.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const env = vi.hoisted(() => ({ apiUrl: "https://api.stigmer.ai" }));
vi.mock("../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config")>();
  return {
    ...actual,
    get API_URL() {
      return env.apiUrl;
    },
  };
});

const auth = vi.hoisted(() => ({
  isInitialized: true,
  isAuthenticated: true,
  token: "token-1" as string | null,
  getAccessToken: null as null | (() => string | null),
}));
vi.mock("../auth/AuthProvider", () => {
  const getAccessToken = () => auth.token;
  auth.getAccessToken = getAccessToken;
  return {
    AuthProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useAuth: () => ({
      isInitialized: auth.isInitialized,
      isAuthenticated: auth.isAuthenticated,
      getAccessToken,
    }),
  };
});

const runner = vi.hoisted(() => ({
  isRunning: false,
  updateRunnerToken: vi.fn(async (_token: string | null) => {}),
}));
vi.mock("../hooks/EmbeddedRunnerContext", () => ({
  EmbeddedRunnerProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useRunner: () => ({
    isRunning: runner.isRunning,
    updateRunnerToken: runner.updateRunnerToken,
  }),
}));

const RUNNER_ADAPTER = { kind: "tauri-runner-adapter" };
vi.mock("../hooks/useTauriRunnerAdapter", () => ({
  useTauriRunnerAdapter: () => RUNNER_ADAPTER,
}));
vi.mock("../hooks/useColorModePreference", () => ({
  useColorModePreference: () => ({ colorMode: "dark" }),
}));

function marker(name: string) {
  return function Marker({ children }: { children?: React.ReactNode }) {
    return <div data-chain={name}>{children}</div>;
  };
}

vi.mock("../auth/LoginScreen", () => ({
  LoginScreen: () => <p>sign-in screen</p>,
}));
vi.mock("../identity/IdentityAccountGate", () => ({
  IdentityAccountGate: marker("identity"),
}));
vi.mock("../hooks/AppUpdaterContext", () => ({
  AppUpdaterProvider: marker("updater"),
}));
vi.mock("../routes", () => ({ router: {} }));
vi.mock("react-router-dom", () => ({
  RouterProvider: () => <p>the routes</p>,
}));
vi.mock("sonner", () => ({ Toaster: () => null }));

const providerProps = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
}));
vi.mock("@stigmer/react", () => ({
  StigmerProvider: (
    props: Record<string, unknown> & { children: React.ReactNode },
  ) => {
    providerProps.calls.push(props);
    return <div data-chain="stigmer">{props.children}</div>;
  },
  FetchCacheProvider: marker("fetch-cache"),
  OrgProvider: marker("org"),
}));

const tauriHttp = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: tauriHttp.fetch }));

// The SDK client is recorded, and its server-info answer is the test's.
const sdk = vi.hoisted(() => ({
  configs: [] as Record<string, unknown>[],
  serverInfo: null as null | (() => Promise<{ deploymentMode: string }>),
}));
vi.mock("@stigmer/sdk", () => ({
  Stigmer: class {
    platform = {
      getServerInfo: () =>
        sdk.serverInfo ? sdk.serverInfo() : new Promise<never>(() => {}),
    };
    constructor(config: Record<string, unknown>) {
      sdk.configs.push(config);
    }
  },
}));

import { App } from "../App";

function chainAround(text: string): string[] {
  const chain: string[] = [];
  for (
    let node = screen.getByText(text).parentElement;
    node;
    node = node.parentElement
  ) {
    const name = node.getAttribute("data-chain");
    if (name) chain.unshift(name);
  }
  return chain;
}

const lastProviderProps = () => providerProps.calls.at(-1) ?? {};

describe("App", () => {
  beforeEach(() => {
    env.apiUrl = "https://api.stigmer.ai";
    auth.isInitialized = true;
    auth.isAuthenticated = true;
    auth.token = "token-1";
    runner.isRunning = false;
    runner.updateRunnerToken.mockReset();
    runner.updateRunnerToken.mockResolvedValue(undefined);
    providerProps.calls = [];
    sdk.configs = [];
    sdk.serverInfo = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("renders nothing of the app, and no sign-in, until the session is resolved", () => {
    auth.isInitialized = false;
    render(<App />);

    expect(screen.queryByText("sign-in screen")).toBeNull();
    expect(screen.queryByText("the routes")).toBeNull();
  });

  it("shows only the sign-in screen to a signed-out person", () => {
    auth.isAuthenticated = false;
    render(<App />);

    expect(screen.getByText("sign-in screen")).toBeTruthy();
    expect(screen.queryByText("the routes")).toBeNull();
  });

  it("wraps the routes in the signed-in chain, in the web console's order", () => {
    render(<App />);

    expect(chainAround("the routes")).toEqual([
      "stigmer",
      "updater",
      "identity",
      "fetch-cache",
      "org",
    ]);
  });

  it("builds one SDK client on this build's API URL, through Tauri's HTTP plugin, with the session's token getter", () => {
    render(<App />);

    expect(sdk.configs).toHaveLength(1);
    const config = sdk.configs[0] ?? {};
    expect(config.baseUrl).toBe("https://api.stigmer.ai");
    expect(config.fetch).toBe(tauriHttp.fetch);
    expect(config.getAccessToken).toBe(auth.getAccessToken);
    expect(lastProviderProps()).toMatchObject({
      executionTarget: "local",
      runnerAdapter: RUNNER_ADAPTER,
      colorMode: "dark",
    });
  });

  it.each([
    ["http://localhost:7234", "local"],
    ["https://api.stigmer.ai", "cloud"],
  ])(
    "guesses the mode from %s as %s before the server answers",
    (apiUrl, mode) => {
      env.apiUrl = apiUrl;
      render(<App />);
      expect(lastProviderProps().deploymentMode).toBe(mode);
    },
  );

  it("takes the server's answer over the guess, an Enterprise server included", async () => {
    sdk.serverInfo = async () => ({ deploymentMode: "enterprise" });
    render(<App />);

    await waitFor(() =>
      expect(lastProviderProps().deploymentMode).toBe("enterprise"),
    );
  });

  it("keeps the guess when the server cannot answer", async () => {
    sdk.serverInfo = async () => {
      throw new Error("unimplemented");
    };
    render(<App />);

    await act(async () => {});
    expect(lastProviderProps().deploymentMode).toBe("cloud");
  });

  it("hands a running runner each new token once, and a stopped runner none", async () => {
    runner.isRunning = true;
    const { rerender } = render(<App />);
    await act(async () => {});
    expect(runner.updateRunnerToken.mock.calls).toEqual([["token-1"]]);

    rerender(<App />);
    await act(async () => {});
    expect(runner.updateRunnerToken.mock.calls).toEqual([["token-1"]]);

    auth.token = "token-2";
    rerender(<App />);
    await act(async () => {});
    expect(runner.updateRunnerToken.mock.calls).toEqual([
      ["token-1"],
      ["token-2"],
    ]);

    runner.isRunning = false;
    auth.token = "token-3";
    rerender(<App />);
    await act(async () => {});
    expect(runner.updateRunnerToken.mock.calls).toEqual([
      ["token-1"],
      ["token-2"],
    ]);
  });
});
