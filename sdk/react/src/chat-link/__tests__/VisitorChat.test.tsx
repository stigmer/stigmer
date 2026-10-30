import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { UseChannelAgentProfileReturn } from "../useChannelAgentProfile";

// ---------------------------------------------------------------------------
// VisitorChat state machine and wiring.
//
// The session organisms are replaced with prop-capturing probes — their
// behavior (including the guest-audience mapping) is covered by their own
// tests. These tests assert the organism's states (loading / error /
// unavailable / chat), the guest wiring it hands the viewers (a member of
// an organization-audience chat link keeps their own My vault, a public
// visitor never does), and the launcher→viewer handoff on session
// creation. The hosted link names only
// the web channel, by its id: the organization and slug the viewers receive come
// from the resolved profile, never from the link.
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const newSessionViewerProps: CapturedProps[] = [];
vi.mock("../../session/NewSessionViewer", () => ({
  NewSessionViewer: (props: CapturedProps) => {
    newSessionViewerProps.push(props);
    return <div data-testid="new-session-probe" />;
  },
}));

const sessionViewerProps: CapturedProps[] = [];
vi.mock("../../session/SessionViewer", () => ({
  SessionViewer: (props: CapturedProps) => {
    sessionViewerProps.push(props);
    return <div data-testid="session-probe" />;
  },
}));

// The chat frame names the agent through useAgent when no title is given;
// VisitorChat always gives the profile's, so the read is never needed.
vi.mock("../../agent/useAgent", () => ({
  useAgent: () => ({ agent: null, isLoading: false, isRefetching: false, error: null, refetch: () => {} }),
}));

const profileState: { current: UseChannelAgentProfileReturn } = {
  current: {
    profile: null,
    isLoading: true,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  },
};
const profileHookCalls: unknown[][] = [];
vi.mock("../useChannelAgentProfile", () => ({
  useChannelAgentProfile: (...args: unknown[]) => {
    profileHookCalls.push(args);
    return profileState.current;
  },
}));

import { VisitorChat } from "../VisitorChat";

const CHANNEL_ID = "chn_01j9z3k8f2q4m6n7p8r9s0t1v2";

/** The chat link's agent reference, version included, as the profile gives it. */
const LINK_AGENT_REF = { org: "org_acme", slug: "support-bot", version: "v2", kind: 40 };

const PROFILE = {
  org: "org_acme",
  slug: "support-agent",
  name: "Support Agent",
  description: "Answers support questions",
  iconUrl: "",
  agentRef: LINK_AGENT_REF,
} as never;

function setProfileState(state: Partial<UseChannelAgentProfileReturn>) {
  profileState.current = {
    profile: null,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
    ...state,
  };
}

beforeEach(() => {
  newSessionViewerProps.length = 0;
  sessionViewerProps.length = 0;
  profileHookCalls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VisitorChat", () => {
  it("renders a loading skeleton while the profile resolves", () => {
    setProfileState({ isLoading: true });
    render(<VisitorChat channelId={CHANNEL_ID} />);

    expect(screen.getByText("Loading agent")).toBeTruthy();
    expect(newSessionViewerProps).toHaveLength(0);
  });

  it("resolves via the public path by default and the member path for linkAudience=org", () => {
    setProfileState({ profile: PROFILE });
    render(<VisitorChat channelId={CHANNEL_ID} />);
    expect(profileHookCalls[0]).toEqual([CHANNEL_ID, { audience: "public" }]);

    cleanup();
    profileHookCalls.length = 0;

    render(<VisitorChat channelId={CHANNEL_ID} linkAudience="org" />);
    expect(profileHookCalls[0]).toEqual([CHANNEL_ID, { audience: "org" }]);
    // Presentation is identical either way: the session organisms still
    // render with the pure-chat guest audience.
    expect(newSessionViewerProps[0]?.audience).toBe("guest");
  });

  it("includes My vault for a member of an organization-audience chat link, never for a public visitor", () => {
    setProfileState({ profile: PROFILE });
    render(<VisitorChat channelId={CHANNEL_ID} />);
    expect(newSessionViewerProps.at(-1)?.includeMyVault).toBe(false);

    cleanup();
    render(<VisitorChat channelId={CHANNEL_ID} linkAudience="org" />);
    expect(newSessionViewerProps.at(-1)?.includeMyVault).toBe(true);
  });

  it("renders an error state with retry on transient failures", () => {
    const refetch = vi.fn();
    setProfileState({ error: new Error("network down"), refetch });
    render(<VisitorChat channelId={CHANNEL_ID} />);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the unavailable state when the chat link does not answer", () => {
    setProfileState({ profile: null });
    render(<VisitorChat channelId={CHANNEL_ID} />);

    expect(screen.getByText("This agent isn't available")).toBeTruthy();
    expect(newSessionViewerProps).toHaveLength(0);
  });

  it("renders the unavailable state when the profile names no agent", () => {
    setProfileState({
      profile: { ...(PROFILE as object), agentRef: undefined } as never,
    });
    render(<VisitorChat channelId={CHANNEL_ID} />);

    expect(screen.getByText("This agent isn't available")).toBeTruthy();
  });

  it("threads the link token into the profile lookup", () => {
    setProfileState({ profile: PROFILE });
    render(<VisitorChat channelId={CHANNEL_ID} linkToken="tok123" />);
    expect(profileHookCalls[0]).toEqual([
      CHANNEL_ID,
      { audience: "public", linkToken: "tok123" },
    ]);
  });

  it("renders the agent header and a guest launcher pinned to the chat link's agent reference", () => {
    setProfileState({ profile: PROFILE });
    render(<VisitorChat channelId={CHANNEL_ID} />);

    expect(screen.getByRole("heading", { name: "Support Agent" })).toBeTruthy();
    expect(screen.getByText("Answers support questions")).toBeTruthy();

    expect(newSessionViewerProps).toHaveLength(1);
    // The organization and agent come from the profile the channel id
    // resolved to: the chat link's agent reference exactly, version included —
    // never the chat link's own slug.
    expect(newSessionViewerProps[0]).toMatchObject({
      org: "org_acme",
      audience: "guest",
      enableGitHub: false,
    });
    expect(newSessionViewerProps[0].initialAgentRef).toEqual(LINK_AGENT_REF);
    expect(newSessionViewerProps[0]).not.toHaveProperty("initialInstanceId");
  });

  it("hands off to a guest SessionViewer once the session is created", async () => {
    setProfileState({ profile: PROFILE });
    const onSessionCreated = vi.fn();
    render(
      <VisitorChat channelId={CHANNEL_ID} onSessionCreated={onSessionCreated} />,
    );

    const created = newSessionViewerProps[0]
      .onSessionCreated as (id: string) => void;
    act(() => created("ses_1"));

    expect(onSessionCreated).toHaveBeenCalledWith("ses_1");
    expect(await screen.findByTestId("session-probe")).toBeTruthy();
    expect(sessionViewerProps[0]).toMatchObject({
      sessionId: "ses_1",
      org: "org_acme",
      audience: "guest",
      enableGitHub: false,
    });
  });

  it("surfaces launcher errors through the composer footer", () => {
    setProfileState({ profile: PROFILE });
    const { rerender } = render(<VisitorChat channelId={CHANNEL_ID} />);

    const onError = newSessionViewerProps[0].onError as (msg: string) => void;
    act(() => onError("Rate limit reached"));
    rerender(<VisitorChat channelId={CHANNEL_ID} />);

    const footer = newSessionViewerProps.at(-1)!.footerContent;
    expect(footer).toBeTruthy();
  });

  it("shows the Powered by Stigmer footer by default and hides it on request", () => {
    setProfileState({ profile: PROFILE });
    const { unmount } = render(<VisitorChat channelId={CHANNEL_ID} />);
    expect(screen.getByText("Powered by Stigmer")).toBeTruthy();
    unmount();

    render(<VisitorChat channelId={CHANNEL_ID} showPoweredBy={false} />);
    expect(screen.queryByText("Powered by Stigmer")).toBeNull();
  });

  it("falls back to the slug when the profile has no display name", () => {
    setProfileState({
      profile: { ...(PROFILE as object), name: "" } as never,
    });
    render(<VisitorChat channelId={CHANNEL_ID} />);

    expect(
      screen.getByRole("heading", { name: "support-agent" }),
    ).toBeTruthy();
  });
});
