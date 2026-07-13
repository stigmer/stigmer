import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// SharedAgentChatPage audience routing (T07).
//
// The page probes the anonymous getSharedProfile once and branches:
// public share -> guest chat (zero login); NOT_FOUND -> the member path,
// which offers "sign in if you have access" to anonymous visitors and
// renders the org-audience chat with the member's own client once signed
// in. These tests pin that routing; the chat organism itself is covered
// by the SDK's SharedAgentChat tests.
// ---------------------------------------------------------------------------

const authState = {
  current: {
    isAuthenticated: false,
    isLoading: false,
    user: null,
    accessToken: null as string | null,
    login: vi.fn(),
    logout: vi.fn(),
  },
};
vi.mock("@/auth", () => ({
  useAuth: () => authState.current,
}));

vi.mock("@/config/env", () => ({
  getApiBaseUrl: () => "https://api.example.com",
}));

vi.mock("@/domain/_shared/hooks/useStaticRouteParam", () => ({
  useStaticRouteParam: (name: string) => (name === "org" ? "acme" : "support-bot"),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

// Standalone page: never embedded in these tests.
vi.mock("@stigmer/embed", () => ({
  isEmbedded: () => false,
  notifyParent: vi.fn(),
  resolveParentOrigin: vi.fn(),
}));

// The anonymous probe goes through `new Stigmer().agentShare.getSharedProfile`.
const getSharedProfileMock = vi.fn<(request?: unknown) => Promise<unknown>>();
const stigmerConfigs: unknown[] = [];
const guestAuthConfigs: Record<string, unknown>[] = [];
vi.mock("@stigmer/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/sdk")>();
  return {
    ...actual,
    Stigmer: class MockStigmer {
      agentShare = { getSharedProfile: getSharedProfileMock };
      constructor(config: unknown) {
        stigmerConfigs.push(config);
      }
    },
    createGuestAuth: (config: Record<string, unknown>) => {
      guestAuthConfigs.push(config);
      return { getAccessToken: vi.fn() };
    },
  };
});

const sharedAgentChatProps: Record<string, unknown>[] = [];
vi.mock("@stigmer/react", () => ({
  StigmerProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="provider">{children}</div>
  ),
  SharedAgentChat: (props: Record<string, unknown>) => {
    sharedAgentChatProps.push(props);
    return <div data-testid="chat-probe" />;
  },
}));

import { StigmerError } from "@stigmer/sdk";
import SharedAgentChatPage from "../SharedAgentChatPage";

// A real StigmerError so the page's (unmocked) isNotFound helper matches it,
// exactly as the transport would produce for a NOT_FOUND status.
function notFoundError(): StigmerError {
  return new StigmerError("not-found", "agent not found", 5);
}

function setAuth(overrides: Partial<(typeof authState)["current"]>) {
  authState.current = { ...authState.current, ...overrides };
}

beforeEach(() => {
  sharedAgentChatProps.length = 0;
  stigmerConfigs.length = 0;
  guestAuthConfigs.length = 0;
  getSharedProfileMock.mockReset();
  window.history.replaceState(null, "", "/chat/acme/support-bot");
  setAuth({
    isAuthenticated: false,
    isLoading: false,
    accessToken: null,
    login: vi.fn(),
  });
});

afterEach(cleanup);

describe("SharedAgentChatPage audience routing", () => {
  it("public share: probe resolves -> guest chat with the default (public) audience", async () => {
    getSharedProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    expect(sharedAgentChatProps[0].sharingAudience).toBeUndefined();
    expect(screen.getByTestId("chat-probe")).toBeTruthy();
  });

  it("org share, anonymous visitor: NOT_FOUND -> sign-in-if-you-have-access surface", async () => {
    getSharedProfileMock.mockRejectedValue(notFoundError());
    const login = vi.fn();
    setAuth({ isAuthenticated: false, login });

    render(<SharedAgentChatPage />);

    const signIn = await screen.findByRole("button", {
      name: /Sign in if you have access/,
    });
    // The surface must stay generic — it must not reveal that the agent
    // exists or that it is members-only specifically.
    expect(screen.getByText(/isn't available/)).toBeTruthy();
    expect(sharedAgentChatProps).toHaveLength(0);

    fireEvent.click(signIn);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("org share, signed-in member: NOT_FOUND -> org-audience chat with the member's token", async () => {
    getSharedProfileMock.mockRejectedValue(notFoundError());
    setAuth({ isAuthenticated: true, accessToken: "member-token" });

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    expect(sharedAgentChatProps[0].sharingAudience).toBe("org");
    expect(sharedAgentChatProps[0].org).toBe("acme");
    expect(sharedAgentChatProps[0].slug).toBe("support-bot");
  });

  it("transient probe failure falls back to the guest path (retry surface lives there)", async () => {
    getSharedProfileMock.mockRejectedValue(new Error("network down"));

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    expect(sharedAgentChatProps[0].sharingAudience).toBeUndefined();
  });

  it("waits for auth resolution before choosing sign-in vs member", async () => {
    getSharedProfileMock.mockRejectedValue(notFoundError());
    setAuth({ isAuthenticated: false, isLoading: true });

    const { container } = render(<SharedAgentChatPage />);

    // While the OIDC session restore is in flight the page must not
    // flash the sign-in card at a member who is about to be recognized.
    await waitFor(() => expect(getSharedProfileMock).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("SharedAgentChatPage locked links (?k= token)", () => {
  it("threads the ?k= token through the probe, the guest mint, and the chat", async () => {
    window.history.replaceState(null, "", "/chat/acme/support-bot?k=tok123");
    getSharedProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    // Probe: the request message carries the token so a locked link
    // resolves as public instead of falling to the member path.
    expect(getSharedProfileMock.mock.calls[0][0]).toMatchObject({
      org: "acme",
      slug: "support-bot",
      linkToken: "tok123",
    });
    // Guest mint: the same token rides mintGuestToken, where the server
    // validates it against the live status.share_link_token.
    expect(guestAuthConfigs[0]).toMatchObject({ linkToken: "tok123" });
    // Chat: the profile fetch inside SharedAgentChat needs it too.
    expect(sharedAgentChatProps[0].linkToken).toBe("tok123");
  });

  it("plain links carry no token anywhere", async () => {
    getSharedProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    expect(getSharedProfileMock.mock.calls[0][0]).toMatchObject({ linkToken: "" });
    expect(guestAuthConfigs[0]).not.toHaveProperty("linkToken");
    expect(sharedAgentChatProps[0].linkToken).toBe("");
  });
});
