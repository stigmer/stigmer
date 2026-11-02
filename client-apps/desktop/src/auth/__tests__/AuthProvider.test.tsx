// ---------------------------------------------------------------------------
// AuthProvider — the desktop's sign-in, session renewal and sign-out, in the
// mode the server's answer picks
//
// Driven over Tauri's IPC mock: the real provider asks the Rust host for the
// session (`auth_session`), to sign in (`auth_sign_in`), to renew
// (`auth_refresh`) and to sign out (`auth_sign_out`), and the test answers as
// the host would. The flow itself (discovery, PKCE, the browser, the
// callback's state, the code exchange, the keychain) is the host's, pinned in
// src-tauri/src/oidc.rs and session_store.rs. Pinned here:
//
//   - the mode: a server that trusts every request runs signed in with no
//     token; one that signs people in signs in through the provider it
//     announced, for that server;
//   - the session: the host's session restores the person signed in, it is
//     renewed five minutes before expiry with one token getter throughout, a
//     refused renewal signs the person out, and sign-out asks the host to
//     forget and revoke it;
//   - web storage holds no sign-in, and the tokens older builds kept there
//     are forgotten.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NativeSignIn } from "@stigmer/client";
import { mockTauri, type CommandArgs } from "../../__test-utils__/tauri";

const sonner = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock("sonner", () => ({ toast: { message: sonner.message } }));
import { AuthProvider, useAuth, type SessionView } from "../AuthProvider";

const SERVER = "https://stigmer.acme.internal";
const ACME: NativeSignIn = {
  issuer: "https://id.acme.internal/",
  audience: "https://stigmer.acme.internal",
  clientId: "acme-desktop",
};
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

function view(accessToken: string, expiresAt: number): SessionView {
  return {
    accessToken,
    expiresAt,
    user: { sub: "acme|ada", email: "ada@acme.internal", name: "Ada" },
    keptBetweenLaunches: true,
  };
}

let lastGetter: (() => string | null) | undefined;

function Probe() {
  const { isAuthEnabled, isAuthenticated, isInitialized, getAccessToken, user, login, logout } = useAuth();
  lastGetter = getAccessToken;
  return (
    <div>
      <p data-testid="state">
        enabled={String(isAuthEnabled)} authenticated={String(isAuthenticated)} initialized=
        {String(isInitialized)} token={String(getAccessToken())} user={user?.email ?? "none"}
      </p>
      <button onClick={() => void login().catch(() => {})}>sign in</button>
      <button onClick={logout}>sign out</button>
    </div>
  );
}

function stateLine(): string {
  return screen.getByTestId("state").textContent ?? "";
}

function renderSignIn() {
  return render(
    <AuthProvider mode="sign-in" server={SERVER} nativeSignIn={ACME}>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  lastGetter = undefined;
});

describe("the auth mode", () => {
  it("runs signed in with no token and asks the host nothing on a server that trusts every request", () => {
    const tauri = mockTauri();
    render(
      <AuthProvider mode="open">
        <Probe />
      </AuthProvider>,
    );

    expect(stateLine()).toContain("enabled=false authenticated=true initialized=true token=null");
    expect(tauri.calls).toEqual([]);
  });

  it("DSK-02 signs in through the provider the server announced, for that server", async () => {
    const tauri = mockTauri({
      auth_session: () => null,
      auth_sign_in: () => view("access-1", Date.now() + 60 * MINUTE),
    });
    renderSignIn();
    await waitFor(() => expect(stateLine()).toContain("enabled=true authenticated=false initialized=true"));

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));

    await waitFor(() => expect(stateLine()).toContain("authenticated=true"));
    expect(tauri.callsTo("auth_sign_in")).toEqual([{ server: SERVER, signIn: ACME }]);
    expect(stateLine()).toContain("token=access-1 user=ada@acme.internal");
  });
});

describe("DSK-06 the sign-in stays out of web storage", () => {
  it("leaves no token in the page's storage after signing in", async () => {
    mockTauri({
      auth_session: () => null,
      auth_sign_in: () => view("access-secret", Date.now() + 60 * MINUTE),
    });
    renderSignIn();
    await waitFor(() => expect(stateLine()).toContain("initialized=true"));

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));
    await waitFor(() => expect(stateLine()).toContain("authenticated=true"));

    const stored = [
      ...Array.from({ length: localStorage.length }, (_, i) => localStorage.getItem(localStorage.key(i) ?? "")),
      ...Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.getItem(sessionStorage.key(i) ?? "")),
    ].join("\n");
    expect(stored).not.toContain("access-secret");
  });

  it("forgets the tokens an older build kept in web storage", () => {
    localStorage.setItem("stigmer:auth:tokens", JSON.stringify({ accessToken: "old", refreshToken: "old-refresh" }));
    localStorage.setItem("stigmer:lastRoute", "/dashboard");
    mockTauri({ auth_session: () => null });
    renderSignIn();

    expect(localStorage.getItem("stigmer:auth:tokens")).toBeNull();
    expect(localStorage.getItem("stigmer:lastRoute"), "other settings stay").toBe("/dashboard");
  });
});

describe("the provider's lifetime", () => {
  it("is not initialized until the host has answered", async () => {
    let answer: (found: SessionView | null) => void = () => {};
    mockTauri({ auth_session: () => new Promise((resolve) => (answer = resolve)) });
    renderSignIn();

    expect(stateLine()).toContain("initialized=false");
    await act(async () => answer(null));
    expect(stateLine()).toContain("initialized=true");
  });

  it("adopts nothing the host answers after the provider left", async () => {
    vi.stubEnv("DEV", false);
    sonner.message.mockReset();
    let answer: (found: SessionView | null) => void = () => {};
    mockTauri({ auth_session: () => new Promise((resolve) => (answer = resolve)) });
    const { unmount } = renderSignIn();

    unmount();
    await act(async () => answer({ ...view("late", Date.now() + 60 * MINUTE), keptBetweenLaunches: false }));
    expect(sonner.message).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("starts a new sign-in state for another server, never showing the old one's", async () => {
    mockTauri({
      auth_session: (args) =>
        args.server === SERVER ? view("access-acme", Date.now() + 60 * MINUTE) : new Promise(() => {}),
    });
    const { rerender } = renderSignIn();
    await waitFor(() => expect(stateLine()).toContain("token=access-acme"));

    rerender(
      <AuthProvider mode="sign-in" server="https://stigmer.other.internal" nativeSignIn={ACME}>
        <Probe />
      </AuthProvider>,
    );

    expect(stateLine()).toContain("authenticated=false");
    expect(stateLine()).toContain("token=null");
  });

  it("refuses to be read outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrowError("useAuth must be used within AuthProvider");
  });
});

describe("a sign-in nothing keeps", () => {
  it("says, once a person signs in, that the app will ask again next time when no keychain keeps it", async () => {
    vi.stubEnv("DEV", false);
    sonner.message.mockReset();
    mockTauri({
      auth_session: () => null,
      auth_sign_in: () => ({ ...view("access-1", Date.now() + 60 * MINUTE), keptBetweenLaunches: false }),
    });
    renderSignIn();
    await waitFor(() => expect(stateLine()).toContain("initialized=true"));

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));

    await waitFor(() => expect(stateLine()).toContain("authenticated=true"));
    expect(sonner.message).toHaveBeenCalledWith(
      "This computer has no keychain the app can use, so you will sign in again next time.",
      { id: "sign-in-not-kept" },
    );
    vi.unstubAllEnvs();
  });

  it("says nothing when the keychain keeps the sign-in", async () => {
    vi.stubEnv("DEV", false);
    sonner.message.mockReset();
    mockTauri({ auth_session: () => view("access-1", Date.now() + 60 * MINUTE) });
    renderSignIn();

    await waitFor(() => expect(stateLine()).toContain("authenticated=true"));
    expect(sonner.message).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("the session", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores a stored, unexpired session as signed in", async () => {
    const tauri = mockTauri({ auth_session: () => view("access-1", NOW + 60 * MINUTE) });
    renderSignIn();

    await waitFor(() => expect(stateLine()).toContain("authenticated=true initialized=true token=access-1"));
    expect(tauri.callsTo("auth_session")).toEqual([{ server: SERVER }]);
  });

  it("shows the sign-in screen when the host holds no session, or cannot ask the provider", async () => {
    mockTauri({
      auth_session: () => {
        throw "The app could not reach the sign-in provider";
      },
    });
    renderSignIn();

    await waitFor(() => expect(stateLine()).toContain("authenticated=false initialized=true token=null"));
  });

  it("renews five minutes before the expiry, keeping one token getter across the renewal", async () => {
    const refreshes: CommandArgs[] = [];
    mockTauri({
      auth_session: () => view("access-1", NOW + 20 * MINUTE),
      auth_refresh: (args) => {
        refreshes.push(args);
        return view("access-2", NOW + 80 * MINUTE);
      },
    });
    renderSignIn();
    await waitFor(() => expect(stateLine()).toContain("token=access-1"));
    const getterBefore = lastGetter;

    await act(async () => {
      vi.advanceTimersByTime(14 * MINUTE);
    });
    expect(refreshes).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(2 * MINUTE);
    });
    await waitFor(() => expect(stateLine()).toContain("token=access-2"));
    expect(refreshes).toEqual([{ server: SERVER }]);
    expect(lastGetter).toBe(getterBefore);
  });

  it("signs the person out when a renewal fails", async () => {
    mockTauri({
      auth_session: () => view("access-1", NOW + 30_000),
      auth_refresh: () => null,
    });
    renderSignIn();

    await waitFor(() => expect(stateLine()).toContain("authenticated=false initialized=true token=null"));
  });

  it("keeps the session when the provider cannot be reached for a renewal", async () => {
    mockTauri({
      auth_session: () => view("access-1", NOW + 30 * MINUTE),
      auth_refresh: () => {
        throw "The app could not reach the sign-in provider";
      },
    });
    renderSignIn();
    await waitFor(() => expect(stateLine()).toContain("token=access-1"));

    await act(async () => {
      vi.advanceTimersByTime(25 * MINUTE);
    });
    expect(stateLine()).toContain("authenticated=true");
    expect(stateLine()).toContain("token=access-1");
  });

  it("reads a session the host answers already expired as signed out", async () => {
    // The renewal never answers, so only the expiry decides.
    mockTauri({ auth_session: () => view("access-old", NOW - MINUTE), auth_refresh: () => new Promise(() => {}) });
    renderSignIn();

    await waitFor(() => expect(stateLine()).toContain("initialized=true"));
    expect(stateLine()).toContain("authenticated=false");
  });

  it("stops renewing once the person signs out", async () => {
    const refreshes: CommandArgs[] = [];
    mockTauri({
      auth_session: () => view("access-1", NOW + 20 * MINUTE),
      auth_refresh: (args) => {
        refreshes.push(args);
        return view("access-2", NOW + 80 * MINUTE);
      },
      auth_sign_out: () => null,
    });
    renderSignIn();
    await waitFor(() => expect(stateLine()).toContain("token=access-1"));

    await userEvent.click(screen.getByRole("button", { name: "sign out" }));
    await act(async () => {
      vi.advanceTimersByTime(30 * MINUTE);
    });

    expect(refreshes).toEqual([]);
  });

  it("signs out by clearing the session and revoking its refresh token", async () => {
    const tauri = mockTauri({
      auth_session: () => view("access-1", NOW + 60 * MINUTE),
      auth_sign_out: () => null,
    });
    renderSignIn();
    await waitFor(() => expect(stateLine()).toContain("authenticated=true"));

    await userEvent.click(screen.getByRole("button", { name: "sign out" }));

    expect(stateLine()).toContain("authenticated=false");
    expect(stateLine()).toContain("token=null");
    // The host forgets the keychain entry and revokes the refresh token at
    // the provider's revocation endpoint (src-tauri/src/oidc.rs).
    expect(tauri.callsTo("auth_sign_out")).toEqual([{ server: SERVER }]);
  });
});
