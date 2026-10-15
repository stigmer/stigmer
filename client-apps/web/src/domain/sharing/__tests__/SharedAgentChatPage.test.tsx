import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// SharedAgentChatPage audience routing.
//
// The page probes the anonymous getAgentProfile once and branches:
// public share -> guest chat (zero login); NOT_FOUND -> the member path,
// which offers "sign in if you have access" to anonymous visitors and
// renders the org-audience chat with the member's own client once signed
// in. These tests pin that routing; the chat organism itself is covered
// by the SDK's SharedAgentChat tests. The link (`/chat/<channel id>`) names
// only the web channel, by its id: the probe, the guest mint and the chat all
// receive that id, never an organization or slug.
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

const SHARE_ID = "ash_01j9z3k8f2q4m6n7p8r9s0t1v2";
const route = vi.hoisted(() => ({
  channelId: "ash_01j9z3k8f2q4m6n7p8r9s0t1v2" as string | null,
  reads: [] as Array<[string, number]>,
}));
vi.mock("@/domain/_shared/hooks/useStaticRouteParam", () => ({
  useStaticRouteParam: (name: string, depth: number) => {
    route.reads.push([name, depth]);
    return name === "share" ? route.channelId : null;
  },
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

// The anonymous probe goes through `new Stigmer().channel.getAgentProfile`.
const getAgentProfileMock = vi.fn<(request?: unknown) => Promise<unknown>>();
const stigmerConfigs: unknown[] = [];
const guestAuthConfigs: Record<string, unknown>[] = [];
vi.mock("@stigmer/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/sdk")>();
  return {
    ...actual,
    Stigmer: class MockStigmer {
      channel = { getAgentProfile: getAgentProfileMock };
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
  route.reads.length = 0;
  route.channelId = SHARE_ID;
  getAgentProfileMock.mockReset();
  window.history.replaceState(null, "", `/chat/${SHARE_ID}`);
  setAuth({
    isAuthenticated: false,
    isLoading: false,
    accessToken: null,
    login: vi.fn(),
  });
});

afterEach(cleanup);

describe("SharedAgentChatPage audience routing", () => {
  it("renders nothing and asks nothing while the route has no share id (the static-export placeholder pass)", () => {
    route.channelId = null;

    const { container } = render(<SharedAgentChatPage />);

    expect(container.innerHTML).toBe("");
    expect(getAgentProfileMock).not.toHaveBeenCalled();
    expect(guestAuthConfigs).toEqual([]);
    expect(sharedAgentChatProps).toEqual([]);
  });

  it("public share: probe resolves -> guest chat with the default (public) audience", async () => {
    getAgentProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    expect(sharedAgentChatProps[0].sharingAudience).toBeUndefined();
    expect(screen.getByTestId("chat-probe")).toBeTruthy();
  });

  it("names the share by the link's one segment, its id, everywhere", async () => {
    getAgentProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    // The route has one dynamic segment: `/chat/[share]`.
    expect(route.reads).toContainEqual(["share", 1]);
    expect(route.reads.map(([name]) => name)).not.toContain("org");
    expect(route.reads.map(([name]) => name)).not.toContain("slug");
    // Probe, guest mint and chat all carry the channel id and nothing else.
    const probe = getAgentProfileMock.mock.calls[0][0] as Record<string, unknown>;
    expect(probe).toMatchObject({ channelId: route.channelId });
    expect(probe).not.toHaveProperty("org");
    expect(probe).not.toHaveProperty("slug");
    expect(guestAuthConfigs[0]).toMatchObject({
      baseUrl: "https://api.example.com",
      channelId: route.channelId,
    });
    expect(guestAuthConfigs[0]).not.toHaveProperty("org");
    expect(guestAuthConfigs[0]).not.toHaveProperty("slug");
    expect(sharedAgentChatProps[0].channelId).toBe(route.channelId);
    expect(sharedAgentChatProps[0]).not.toHaveProperty("org");
    expect(sharedAgentChatProps[0]).not.toHaveProperty("slug");
  });

  it("org share, anonymous visitor: NOT_FOUND -> sign-in-if-you-have-access surface", async () => {
    getAgentProfileMock.mockRejectedValue(notFoundError());
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
    getAgentProfileMock.mockRejectedValue(notFoundError());
    setAuth({ isAuthenticated: true, accessToken: "member-token" });

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    expect(sharedAgentChatProps[0].sharingAudience).toBe("org");
    expect(sharedAgentChatProps[0].channelId).toBe(route.channelId);
  });

  it("transient probe failure falls back to the guest path (retry surface lives there)", async () => {
    getAgentProfileMock.mockRejectedValue(new Error("network down"));

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    expect(sharedAgentChatProps[0].sharingAudience).toBeUndefined();
  });

  it("waits for auth resolution before choosing sign-in vs member", async () => {
    getAgentProfileMock.mockRejectedValue(notFoundError());
    setAuth({ isAuthenticated: false, isLoading: true });

    const { container } = render(<SharedAgentChatPage />);

    // While the OIDC session restore is in flight the page must not
    // flash the sign-in card at a member who is about to be recognized.
    await waitFor(() => expect(getAgentProfileMock).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("SharedAgentChatPage locked links (?k= token)", () => {
  it("threads the ?k= token through the probe, the guest mint, and the chat", async () => {
    window.history.replaceState(null, "", `/chat/${route.channelId}?k=tok123`);
    getAgentProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    // Probe: the request message carries the token so a locked link
    // resolves as public instead of falling to the member path.
    expect(getAgentProfileMock.mock.calls[0][0]).toMatchObject({
      channelId: route.channelId,
      linkToken: "tok123",
    });
    // Guest mint: the same token rides mintGuestToken, where the server
    // validates it against the web channel's live link token.
    expect(guestAuthConfigs[0]).toMatchObject({ linkToken: "tok123" });
    // Chat: the profile fetch inside SharedAgentChat needs it too.
    expect(sharedAgentChatProps[0].linkToken).toBe("tok123");
  });

  it("plain links carry no token anywhere", async () => {
    getAgentProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<SharedAgentChatPage />);

    await waitFor(() => expect(sharedAgentChatProps.length).toBeGreaterThan(0));
    expect(getAgentProfileMock.mock.calls[0][0]).toMatchObject({ linkToken: "" });
    expect(guestAuthConfigs[0]).not.toHaveProperty("linkToken");
    expect(sharedAgentChatProps[0].linkToken).toBe("");
  });
});
