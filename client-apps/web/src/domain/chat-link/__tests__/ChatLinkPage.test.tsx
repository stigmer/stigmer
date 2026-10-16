import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// ChatLinkPage audience routing.
//
// The page probes the anonymous getAgentProfile once and branches:
// public chat link -> guest chat (zero login); NOT_FOUND -> the member path,
// which offers "sign in if you have access" to anonymous visitors and
// renders the org-audience chat with the member's own client once signed
// in. These tests pin that routing; the chat organism itself is covered
// by the SDK's VisitorChat tests. The link (`/chat/<channel id>`) names
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
    return name === "channel" ? route.channelId : null;
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

const visitorChatProps: Record<string, unknown>[] = [];
vi.mock("@stigmer/react", () => ({
  StigmerProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="provider">{children}</div>
  ),
  VisitorChat: (props: Record<string, unknown>) => {
    visitorChatProps.push(props);
    return <div data-testid="chat-probe" />;
  },
}));

import { StigmerError } from "@stigmer/sdk";
import ChatLinkPage from "../ChatLinkPage";

// A real StigmerError so the page's (unmocked) isNotFound helper matches it,
// exactly as the transport would produce for a NOT_FOUND status.
function notFoundError(): StigmerError {
  return new StigmerError("not-found", "agent not found", 5);
}

function setAuth(overrides: Partial<(typeof authState)["current"]>) {
  authState.current = { ...authState.current, ...overrides };
}

beforeEach(() => {
  visitorChatProps.length = 0;
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

describe("ChatLinkPage audience routing", () => {
  it("renders nothing and asks nothing while the route has no channel id (the static-export placeholder pass)", () => {
    route.channelId = null;

    const { container } = render(<ChatLinkPage />);

    expect(container.innerHTML).toBe("");
    expect(getAgentProfileMock).not.toHaveBeenCalled();
    expect(guestAuthConfigs).toEqual([]);
    expect(visitorChatProps).toEqual([]);
  });

  it("public chat link: probe resolves -> guest chat with the default (public) audience", async () => {
    getAgentProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<ChatLinkPage />);

    await waitFor(() => expect(visitorChatProps.length).toBeGreaterThan(0));
    expect(visitorChatProps[0].linkAudience).toBeUndefined();
    expect(screen.getByTestId("chat-probe")).toBeTruthy();
  });

  it("names the chat link by the link's one segment, its id, everywhere", async () => {
    getAgentProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<ChatLinkPage />);

    await waitFor(() => expect(visitorChatProps.length).toBeGreaterThan(0));
    // The route has one dynamic segment: `/chat/[channel]`.
    expect(route.reads).toContainEqual(["channel", 1]);
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
    expect(visitorChatProps[0].channelId).toBe(route.channelId);
    expect(visitorChatProps[0]).not.toHaveProperty("org");
    expect(visitorChatProps[0]).not.toHaveProperty("slug");
  });

  it("org chat link, anonymous visitor: NOT_FOUND -> sign-in-if-you-have-access surface", async () => {
    getAgentProfileMock.mockRejectedValue(notFoundError());
    const login = vi.fn();
    setAuth({ isAuthenticated: false, login });

    render(<ChatLinkPage />);

    const signIn = await screen.findByRole("button", {
      name: /Sign in if you have access/,
    });
    // The surface must stay generic — it must not reveal that the agent
    // exists or that it is members-only specifically.
    expect(screen.getByText(/isn't available/)).toBeTruthy();
    expect(visitorChatProps).toHaveLength(0);

    fireEvent.click(signIn);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("org chat link, signed-in member: NOT_FOUND -> org-audience chat with the member's token", async () => {
    getAgentProfileMock.mockRejectedValue(notFoundError());
    setAuth({ isAuthenticated: true, accessToken: "member-token" });

    render(<ChatLinkPage />);

    await waitFor(() => expect(visitorChatProps.length).toBeGreaterThan(0));
    expect(visitorChatProps[0].linkAudience).toBe("org");
    expect(visitorChatProps[0].channelId).toBe(route.channelId);
  });

  it("transient probe failure falls back to the guest path (retry surface lives there)", async () => {
    getAgentProfileMock.mockRejectedValue(new Error("network down"));

    render(<ChatLinkPage />);

    await waitFor(() => expect(visitorChatProps.length).toBeGreaterThan(0));
    expect(visitorChatProps[0].linkAudience).toBeUndefined();
  });

  it("waits for auth resolution before choosing sign-in vs member", async () => {
    getAgentProfileMock.mockRejectedValue(notFoundError());
    setAuth({ isAuthenticated: false, isLoading: true });

    const { container } = render(<ChatLinkPage />);

    // While the OIDC session restore is in flight the page must not
    // flash the sign-in card at a member who is about to be recognized.
    await waitFor(() => expect(getAgentProfileMock).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("ChatLinkPage locked links (?k= token)", () => {
  it("threads the ?k= token through the probe, the guest mint, and the chat", async () => {
    window.history.replaceState(null, "", `/chat/${route.channelId}?k=tok123`);
    getAgentProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<ChatLinkPage />);

    await waitFor(() => expect(visitorChatProps.length).toBeGreaterThan(0));
    // Probe: the request message carries the token so a locked link
    // resolves as public instead of falling to the member path.
    expect(getAgentProfileMock.mock.calls[0][0]).toMatchObject({
      channelId: route.channelId,
      linkToken: "tok123",
    });
    // Guest mint: the same token rides mintGuestToken, where the server
    // validates it against the web channel's live link token.
    expect(guestAuthConfigs[0]).toMatchObject({ linkToken: "tok123" });
    // Chat: the profile fetch inside VisitorChat needs it too.
    expect(visitorChatProps[0].linkToken).toBe("tok123");
  });

  it("plain links carry no token anywhere", async () => {
    getAgentProfileMock.mockResolvedValue({ org: "acme", slug: "support-bot" });

    render(<ChatLinkPage />);

    await waitFor(() => expect(visitorChatProps.length).toBeGreaterThan(0));
    expect(getAgentProfileMock.mock.calls[0][0]).toMatchObject({ linkToken: "" });
    expect(guestAuthConfigs[0]).not.toHaveProperty("linkToken");
    expect(visitorChatProps[0].linkToken).toBe("");
  });
});
