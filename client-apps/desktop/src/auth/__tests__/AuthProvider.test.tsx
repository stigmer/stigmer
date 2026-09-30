// ---------------------------------------------------------------------------
// AuthProvider — the desktop's sign-in, session renewal and sign-out
//
// Driven end to end over Tauri's IPC mock: the real provider asks the host to
// open the system browser, and the test answers as the deep link would, by
// emitting `auth-callback` through Tauri's event layer. Only Auth0's token
// endpoint (Tauri's HTTP plugin) is stubbed at its module. Pinned here:
//
//   - the mode: a local API URL runs signed in with no token; any other URL,
//     an unusable one included, signs in, and the sign-in screen names a URL
//     that is not a usable http(s) URL;
//   - the flow: the callback's state must be the one sent, an identity
//     provider error or a cancel ends the flow, a code is exchanged with the
//     verifier whose challenge was sent, and a flow nobody finishes times out;
//   - the session: it is renewed five minutes before expiry (at once when
//     already inside that window), a failed renewal signs the person out, and
//     the token getter stays one function across renewals;
//   - sign-out clears the session and revokes the refresh token.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauri, type TauriMock } from "../../__test-utils__/tauri";
import { generateChallenge, type StoredTokens } from "../pkce";

const env = vi.hoisted(() => ({ apiUrl: "https://api.stigmer.ai" }));
vi.mock("../../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config")>();
  return {
    ...actual,
    get API_URL() {
      return env.apiUrl;
    },
  };
});

const http = vi.hoisted(() => ({
  fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: http.fetch }));

import { AuthProvider, useAuth } from "../AuthProvider";
import { LoginScreen } from "../LoginScreen";

const TOKENS_KEY = "stigmer:auth:tokens";
const LOOPBACK_PORT = 17001;
const MINUTE = 60_000;

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "none" })}.${encode(claims)}.signature`;
}

function storeTokens(tokens: StoredTokens) {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

function storedTokens(): StoredTokens | null {
  return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? "null");
}

function tokenAnswer(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The form fields of every request sent to one Auth0 endpoint. */
function formsSentTo(path: string): Record<string, string>[] {
  return http.fetch.mock.calls
    .filter(([url]) => String(url).endsWith(path))
    .map(([, init]) =>
      Object.fromEntries(new URLSearchParams(String(init?.body))),
    );
}

let outcome: string[] = [];
let lastGetter: (() => string | null) | null = null;

function Probe() {
  const auth = useAuth();
  lastGetter = auth.getAccessToken;
  return (
    <div>
      <p>
        enabled={String(auth.isAuthEnabled)} authenticated=
        {String(auth.isAuthenticated)} initialized={String(auth.isInitialized)}{" "}
        token={String(auth.getAccessToken())} user=
        {auth.user?.email ?? "none"}
      </p>
      <button
        onClick={() => {
          auth.login().then(
            () => outcome.push("signed in"),
            (err: Error) => outcome.push(`${err.name}: ${err.message}`),
          );
        }}
      >
        sign in
      </button>
      <button onClick={auth.logout}>sign out</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

function stateLine(): string {
  return screen.getByText(/^enabled=/).textContent ?? "";
}

/** Click sign in and wait for the host to be asked to open the browser. */
async function startSignIn(tauri: TauriMock): Promise<URL> {
  await userEvent.click(screen.getByRole("button", { name: "sign in" }));
  await waitFor(() =>
    expect(tauri.callsTo("open_auth_in_browser")).toHaveLength(1),
  );
  return new URL(String(tauri.callsTo("open_auth_in_browser")[0]?.authUrl));
}

function hostMock(): TauriMock {
  return mockTauri({
    start_auth_callback_server: () => LOOPBACK_PORT,
    open_auth_in_browser: () => null,
  });
}

describe("the auth mode", () => {
  beforeEach(() => {
    localStorage.clear();
    http.fetch.mockReset();
  });

  it("runs signed in with no token and no sign-in against a local server", () => {
    env.apiUrl = "http://localhost:7234";
    mockTauri();
    renderProvider();

    expect(stateLine()).toBe(
      "enabled=false authenticated=true initialized=true token=null user=none",
    );
  });

  it("signs in against a remote server", () => {
    env.apiUrl = "https://api.stigmer.ai";
    mockTauri();
    renderProvider();

    expect(stateLine()).toContain("enabled=true authenticated=false");
  });

  it("fails closed on an API URL that does not parse, and the sign-in screen says why", () => {
    env.apiUrl = "api.stigmer.ai:443";
    mockTauri();
    render(
      <AuthProvider>
        <Probe />
        <LoginScreen />
      </AuthProvider>,
    );

    expect(stateLine()).toContain("enabled=true authenticated=false");
    expect(screen.getByRole("alert").textContent).toContain(
      "This build’s API address is not a valid URL (api.stigmer.ai:443)",
    );
  });

  it("names no URL problem on the sign-in screen for a valid URL", () => {
    env.apiUrl = "https://api.stigmer.ai";
    mockTauri();
    render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});

describe("signing in", () => {
  beforeEach(() => {
    env.apiUrl = "https://api.stigmer.ai";
    localStorage.clear();
    http.fetch.mockReset();
    outcome = [];
    // The provider logs every failed sign-in; the outcomes are asserted.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exchanges the returned code with the verifier whose challenge it sent, and stores the session", async () => {
    const tauri = hostMock();
    http.fetch.mockResolvedValue(
      tokenAnswer({
        access_token: "access-1",
        refresh_token: "refresh-1",
        id_token: jwt({ sub: "auth0|1", email: "ada@example.com" }),
        expires_in: 3600,
      }),
    );
    renderProvider();

    const authorize = await startSignIn(tauri);
    const state = authorize.searchParams.get("state");
    expect(state).toBeTruthy();

    await act(() => tauri.emit("auth-callback", { code: "code-1", state }));
    await waitFor(() => expect(outcome).toEqual(["signed in"]));

    const [exchange] = formsSentTo("/oauth/token");
    expect(exchange?.code).toBe("code-1");
    // The verifier sent now must be the one whose challenge went out first.
    expect(await generateChallenge(exchange?.code_verifier ?? "")).toBe(
      authorize.searchParams.get("code_challenge"),
    );
    expect(storedTokens()?.accessToken).toBe("access-1");
    expect(stateLine()).toContain(
      "authenticated=true initialized=true token=access-1 user=ada@example.com",
    );
  });

  it("in a development build, redirects to the host's loopback server, and exchanges with the same redirect", async () => {
    const tauri = hostMock();
    http.fetch.mockResolvedValue(tokenAnswer({ access_token: "a" }));
    renderProvider();

    const authorize = await startSignIn(tauri);
    const redirect = `http://127.0.0.1:${LOOPBACK_PORT}/auth/callback`;
    expect(authorize.searchParams.get("redirect_uri")).toBe(redirect);

    await act(() =>
      tauri.emit("auth-callback", {
        code: "c",
        state: authorize.searchParams.get("state"),
      }),
    );
    await waitFor(() => expect(outcome).toEqual(["signed in"]));
    expect(formsSentTo("/oauth/token")[0]?.redirect_uri).toBe(redirect);
  });

  it("in a packaged build, redirects to the app's deep link and starts no loopback server", async () => {
    vi.stubEnv("DEV", false);
    const tauri = hostMock();
    renderProvider();

    const authorize = await startSignIn(tauri);
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "stigmer://auth/callback",
    );
    expect(tauri.callsTo("start_auth_callback_server")).toEqual([]);
  });

  it("refuses a callback whose state is not the one it sent, and exchanges nothing", async () => {
    const tauri = hostMock();
    renderProvider();

    await startSignIn(tauri);
    await act(() =>
      tauri.emit("auth-callback", { code: "code-1", state: "forged" }),
    );

    await waitFor(() =>
      expect(outcome).toEqual(["Error: OAuth state mismatch"]),
    );
    expect(http.fetch).not.toHaveBeenCalled();
    expect(storedTokens()).toBeNull();
  });

  it("ends the flow with the identity provider's own description of an error", async () => {
    const tauri = hostMock();
    renderProvider();

    const authorize = await startSignIn(tauri);
    await act(() =>
      tauri.emit("auth-callback", {
        state: authorize.searchParams.get("state"),
        error: "access_denied",
        error_description: "The user denied access",
      }),
    );

    await waitFor(() =>
      expect(outcome).toEqual(["Error: The user denied access"]),
    );
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it("refuses a callback that carries the right state but no code", async () => {
    const tauri = hostMock();
    renderProvider();

    const authorize = await startSignIn(tauri);
    await act(() =>
      tauri.emit("auth-callback", {
        state: authorize.searchParams.get("state"),
      }),
    );

    await waitFor(() =>
      expect(outcome).toEqual(["Error: No authorization code received"]),
    );
  });

  it("ends the flow as a cancel, which the sign-in screen treats as no failure", async () => {
    const tauri = hostMock();
    renderProvider();

    await startSignIn(tauri);
    await act(() => tauri.emit("auth-cancelled"));

    await waitFor(() =>
      expect(outcome).toEqual(["LoginCancelledError: Login cancelled"]),
    );
  });

  it("times a flow nobody finishes out after five minutes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const tauri = hostMock();
    renderProvider();

    await startSignIn(tauri);
    // A second short of the deadline (the clock also runs in real time).
    await act(async () => {
      vi.advanceTimersByTime(5 * MINUTE - 1000);
    });
    expect(outcome).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await waitFor(() =>
      expect(outcome).toEqual(["Error: Authentication timed out"]),
    );
  });

  it("ignores a second callback once the flow has ended", async () => {
    const tauri = hostMock();
    http.fetch.mockResolvedValue(tokenAnswer({ access_token: "a" }));
    renderProvider();

    const authorize = await startSignIn(tauri);
    const state = authorize.searchParams.get("state");
    await act(() => tauri.emit("auth-callback", { code: "first", state }));
    await waitFor(() => expect(outcome).toEqual(["signed in"]));

    await act(() => tauri.emit("auth-callback", { code: "second", state }));
    expect(formsSentTo("/oauth/token").map((form) => form.code)).toEqual([
      "first",
    ]);
  });
});

describe("the session", () => {
  const NOW = 1_800_000_000_000;

  beforeEach(() => {
    env.apiUrl = "https://api.stigmer.ai";
    localStorage.clear();
    http.fetch.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores a stored, unexpired session as signed in", () => {
    storeTokens({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: NOW + 60 * MINUTE,
    });
    mockTauri();
    renderProvider();

    expect(stateLine()).toContain(
      "authenticated=true initialized=true token=access-1",
    );
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it("renews five minutes before the expiry, keeping one token getter across the renewal", async () => {
    storeTokens({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: NOW + 20 * MINUTE,
    });
    http.fetch.mockResolvedValue(
      tokenAnswer({ access_token: "access-2", expires_in: 3600 }),
    );
    mockTauri();
    renderProvider();
    const getterBefore = lastGetter;

    await act(async () => {
      vi.advanceTimersByTime(15 * MINUTE - 1);
    });
    expect(http.fetch).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await waitFor(() => expect(stateLine()).toContain("token=access-2"));
    expect(formsSentTo("/oauth/token")[0]).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
    expect(storedTokens()?.accessToken).toBe("access-2");
    expect(lastGetter).toBe(getterBefore);
  });

  it("renews at once, before it counts as initialized, a session already inside the five-minute window", async () => {
    storeTokens({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: NOW + 30_000,
    });
    let answer: (response: Response) => void = () => {};
    http.fetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );
    mockTauri();
    renderProvider();

    expect(stateLine()).toContain("initialized=false");
    await act(async () => {
      answer(tokenAnswer({ access_token: "access-2", expires_in: 3600 }));
    });
    await waitFor(() =>
      expect(stateLine()).toContain(
        "authenticated=true initialized=true token=access-2",
      ),
    );
  });

  it("signs the person out when a renewal fails", async () => {
    storeTokens({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: NOW + 30_000,
    });
    http.fetch.mockResolvedValue(new Response("revoked", { status: 401 }));
    mockTauri();
    renderProvider();

    await waitFor(() =>
      expect(stateLine()).toContain(
        "authenticated=false initialized=true token=null",
      ),
    );
    expect(storedTokens()).toBeNull();
  });

  it("treats an expired session with no refresh token as signed out, without calling Auth0", () => {
    storeTokens({ accessToken: "access-1", expiresAt: NOW - MINUTE });
    mockTauri();
    renderProvider();

    expect(stateLine()).toContain("authenticated=false initialized=true");
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it("signs out by clearing the session and revoking its refresh token", async () => {
    storeTokens({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: NOW + 60 * MINUTE,
    });
    http.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    mockTauri();
    renderProvider();

    await userEvent.click(screen.getByRole("button", { name: "sign out" }));

    expect(storedTokens()).toBeNull();
    expect(stateLine()).toContain("authenticated=false");
    expect(formsSentTo("/oauth/revoke")).toEqual([
      expect.objectContaining({ token: "refresh-1" }),
    ]);
  });

  it("reads the person's name and email from the ID token, and none from a malformed one", () => {
    storeTokens({
      accessToken: "a",
      expiresAt: NOW + 60 * MINUTE,
      idToken: jwt({ sub: "auth0|1", email: "ada@example.com" }),
    });
    mockTauri();
    const { unmount } = renderProvider();
    expect(stateLine()).toContain("user=ada@example.com");
    unmount();

    storeTokens({
      accessToken: "a",
      expiresAt: NOW + 60 * MINUTE,
      idToken: "not-a-jwt",
    });
    renderProvider();
    expect(stateLine()).toContain("user=none");
  });
});
