// ---------------------------------------------------------------------------
// LoginPageView — one sign-in on every edition, and the sign-up arrival
//
// /login is the signed-out landing. Every edition signs in through the
// deployment's own issuer, so the page is the logo and one "Sign in"
// button, and that button starts the configured issuer's flow with the
// post-login path set to the console's home.
//
// The page has a second arrival: /login?signup=1, the website's "Start
// free". It goes straight on to the issuer's create-account screen with the
// manager's sign-up arguments, replacing its own history entry; a signed-in
// person or a console without sign-in goes home; a failed redirect leaves
// the ordinary page so Sign in still works.
// ---------------------------------------------------------------------------

import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  signinRedirect: vi.fn(),
  getUser: vi.fn(),
  createUserManager: vi.fn(),
  signupRedirectArgs: vi.fn(),
  authConfig: {
    mode: "oidc",
    oidc: {
      issuer: "https://issuer.example.com/",
      clientId: "console",
      audience: "https://api.example.com",
    },
  } as { mode: string; oidc?: Record<string, string> },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("@stigmer/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/client")>()),
  Stigmer: class {},
}));
vi.mock("@stigmer/react-sdk", async () => {
  const kit = await vi.importActual<typeof import("@stigmer/react-sdk")>("@stigmer/react-sdk");
  return {
    Button: kit.Button,
    IconButton: kit.IconButton,
    LinkButton: kit.LinkButton,
    StigmerProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});
// The help line reads the server's answer; here it stands in, so the test
// holds where the page places it.
vi.mock("@stigmer/react-sdk/console", () => ({
  HelpLink: () => <p>Stuck? Talk to us</p>,
}));
vi.mock("@/config/env", () => ({
  getApiBaseUrl: () => "https://stigmer.example.com",
}));
vi.mock("@/auth/config", () => ({
  resolveAuthConfig: () => mocks.authConfig,
}));
vi.mock("@/auth/oidc/oidc-manager", () => ({
  createUserManager: mocks.createUserManager,
  signupRedirectArgs: mocks.signupRedirectArgs,
}));

const ORIGIN = "https://stigmer.example.com";

function arriveAt(path: string): void {
  const happyDom = (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM;
  happyDom.setURL(`${ORIGIN}${path}`);
}

import { LoginPageView } from "../LoginPageView";

describe("LoginPageView", () => {
  beforeEach(() => {
    arriveAt("/login");
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    mocks.createUserManager.mockReset();
    mocks.signinRedirect.mockReset();
  });

  it("shows one 'Sign in' button and nothing else to press", () => {
    render(<LoginPageView />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("CON-13 places the server's help line under Sign in", () => {
    render(<LoginPageView />);
    const help = screen.getByText("Stuck? Talk to us");
    const signIn = screen.getByRole("button", { name: "Sign in" });
    expect(signIn.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("starts the configured issuer's flow and returns home after it", () => {
    mocks.createUserManager.mockReturnValue({
      signinRedirect: mocks.signinRedirect,
    });
    render(<LoginPageView />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(mocks.createUserManager).toHaveBeenCalledWith({
      issuer: "https://issuer.example.com/",
      clientId: "console",
      audience: "https://api.example.com",
    });
    expect(mocks.signinRedirect).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("stigmer:auth:redirect_path")).toBe("/");
  });
});

describe("LoginPageView: the sign-up arrival, /login?signup=1", () => {
  const OIDC = mocks.authConfig;
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    arriveAt("/login?signup=1");
    replace = vi.fn();
    vi.spyOn(window.location, "replace").mockImplementation(replace);
    mocks.getUser.mockResolvedValue(null);
    mocks.signinRedirect.mockResolvedValue(undefined);
    mocks.signupRedirectArgs.mockResolvedValue({ prompt: "create" });
    mocks.createUserManager.mockReturnValue({
      signinRedirect: mocks.signinRedirect,
      getUser: mocks.getUser,
    });
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.restoreAllMocks();
    mocks.createUserManager.mockReset();
    mocks.signinRedirect.mockReset();
    mocks.getUser.mockReset();
    mocks.signupRedirectArgs.mockReset();
    mocks.authConfig = OIDC;
  });

  it("goes straight on to the issuer with the sign-up arguments, replacing its own history entry", async () => {
    render(<LoginPageView />);

    expect(screen.getByText("Taking you to create your account\u2026")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    await waitFor(() => expect(mocks.signinRedirect).toHaveBeenCalledTimes(1));
    expect(mocks.signupRedirectArgs).toHaveBeenCalledWith(
      OIDC.oidc,
      expect.objectContaining({ signinRedirect: mocks.signinRedirect }),
    );
    expect(mocks.signinRedirect).toHaveBeenCalledWith({
      prompt: "create",
      redirectMethod: "replace",
    });
    expect(sessionStorage.getItem("stigmer:auth:redirect_path")).toBe("/");
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends a person already signed in home instead", async () => {
    mocks.getUser.mockResolvedValue({ expired: false });
    render(<LoginPageView />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(mocks.signinRedirect).not.toHaveBeenCalled();
  });

  it("treats an expired stored session as signed out", async () => {
    mocks.getUser.mockResolvedValue({ expired: true });
    render(<LoginPageView />);

    await waitFor(() => expect(mocks.signinRedirect).toHaveBeenCalledTimes(1));
    expect(replace).not.toHaveBeenCalled();
  });

  it("goes home when the console has sign-in turned off", async () => {
    mocks.authConfig = { mode: "disabled" };
    render(<LoginPageView />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(mocks.createUserManager).not.toHaveBeenCalled();
  });

  it("renders the ordinary page when the redirect fails, so Sign in still works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.signinRedirect.mockRejectedValueOnce(new Error("issuer unreachable"));
    render(<LoginPageView />);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByText("Taking you to create your account\u2026")).toBeNull();
  });

  it("starts one redirect under StrictMode, which runs mount effects twice", async () => {
    render(
      <StrictMode>
        <LoginPageView />
      </StrictMode>,
    );

    await waitFor(() => expect(mocks.signinRedirect).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.createUserManager).toHaveBeenCalledTimes(1);
    expect(mocks.signinRedirect).toHaveBeenCalledTimes(1);
  });

  it("leaves a plain /login alone", () => {
    arriveAt("/login?signup=0");
    render(<LoginPageView />);

    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(mocks.createUserManager).not.toHaveBeenCalled();
  });
});
