// ---------------------------------------------------------------------------
// App — what the desktop shows before and after sign-in, and how it talks
//
// The composition root is pinned with its links replaced by markers:
//
//   - the server's answer picks what follows, never its address: a server
//     that cannot be used shows why (the connect screen), one that trusts
//     every request opens with no sign-in, one that signs people in signs in
//     through the provider it announced;
//   - nothing of the app renders until the session is resolved, and a signed-
//     out person sees only the sign-in screen;
//   - the signed-in chain keeps the web console's order (updater, identity
//     gate, fetch cache, organizations, then the routes);
//   - the one SDK client talks to the chosen server through Tauri's HTTP
//     plugin, with the session's own token getter, in the edition the server
//     said;
//   - choosing another server covers the app without unmounting it;
//   - a running embedded runner is handed each new access token once.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const ACME_SIGN_IN = {
  issuer: "https://id.acme.internal/",
  audience: "https://stigmer.acme.internal",
  clientId: "acme-desktop",
};

const server = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}));
vi.mock("../server/ServerProvider", () => ({
  ServerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useServer: () => server.state,
}));
vi.mock("../server/ConnectScreen", () => ({
  ConnectScreen: () => <p>connect screen</p>,
  ChooseServerScreen: () => <p>server form</p>,
}));

const auth = vi.hoisted(() => ({
  isInitialized: true,
  isAuthenticated: true,
  token: "token-1" as string | null,
  getAccessToken: null as null | (() => string | null),
}));
const authProps = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));
vi.mock("../auth/AuthProvider", () => {
  const getAccessToken = () => auth.token;
  auth.getAccessToken = getAccessToken;
  return {
    AuthProvider: (props: Record<string, unknown> & { children: React.ReactNode }) => {
      authProps.calls.push(props);
      return <>{props.children}</>;
    },
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
vi.mock("@stigmer/react-sdk", () => ({
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

// The SDK client is recorded.
const sdk = vi.hoisted(() => ({
  configs: [] as Record<string, unknown>[],
}));
vi.mock("@stigmer/client", () => ({
  Stigmer: class {
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

function connectedTo(outcome: Record<string, unknown>, deploymentMode: string) {
  server.state = {
    origin: "https://stigmer.acme.internal",
    label: "stigmer.acme.internal",
    connection: { phase: "connected", outcome, deploymentMode },
    isChoosing: false,
  };
}

describe("App", () => {
  beforeEach(() => {
    connectedTo({ kind: "sign-in", nativeSignIn: ACME_SIGN_IN }, "cloud");
    authProps.calls = [];
    auth.isInitialized = true;
    auth.isAuthenticated = true;
    auth.token = "token-1";
    runner.isRunning = false;
    runner.updateRunnerToken.mockReset();
    runner.updateRunnerToken.mockResolvedValue(undefined);
    providerProps.calls = [];
    sdk.configs = [];
  });

  it("DSK-07 shows why the server cannot be used, instead of the app, while it cannot", () => {
    for (const connection of [
      { phase: "connecting" },
      { phase: "failed", failure: "unreachable", detail: "connection refused" },
      { phase: "failed", failure: "not-stigmer", detail: "HTTP 404" },
      { phase: "unusable", detail: "not a web address" },
      { phase: "connected", outcome: { kind: "not-set-up" }, deploymentMode: "local" },
    ]) {
      server.state = { ...server.state, connection };
      const { unmount } = render(<App />);
      expect(screen.getByText("connect screen")).toBeTruthy();
      expect(screen.queryByText("the routes")).toBeNull();
      expect(authProps.calls).toEqual([]);
      unmount();
    }
  });

  it("opens with no sign-in on a server that trusts every request", () => {
    connectedTo({ kind: "open" }, "local");
    render(<App />);

    expect(authProps.calls.at(-1)).toMatchObject({ mode: "open" });
    expect(lastProviderProps().deploymentMode).toBe("local");
  });

  it("DSK-02 signs in through the provider the server announced, for that server", () => {
    render(<App />);

    expect(authProps.calls.at(-1)).toMatchObject({
      mode: "sign-in",
      server: "https://stigmer.acme.internal",
      nativeSignIn: ACME_SIGN_IN,
    });
  });

  it("covers the app with the server form, leaving the app mounted", () => {
    server.state = { ...server.state, isChoosing: true };
    render(<App />);

    expect(screen.getByRole("dialog", { name: "Use another server" }).textContent).toBe("server form");
    expect(screen.getByText("the routes")).toBeTruthy();
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

  it("builds one SDK client on the chosen server, through Tauri's HTTP plugin, with the session's token getter", () => {
    render(<App />);

    expect(sdk.configs).toHaveLength(1);
    const config = sdk.configs[0] ?? {};
    expect(config.baseUrl).toBe("https://stigmer.acme.internal");
    expect(config.fetch).toBe(tauriHttp.fetch);
    expect(config.getAccessToken).toBe(auth.getAccessToken);
    expect(lastProviderProps()).toMatchObject({
      executionTarget: "local",
      runnerAdapter: RUNNER_ADAPTER,
      colorMode: "dark",
      deploymentMode: "cloud",
    });
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
