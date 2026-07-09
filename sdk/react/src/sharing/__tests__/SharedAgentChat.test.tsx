import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { UseSharedAgentProfileReturn } from "../useSharedAgentProfile";

// ---------------------------------------------------------------------------
// SharedAgentChat state machine and wiring.
//
// The session organisms are replaced with prop-capturing probes — their
// behavior (including the guest-audience mapping) is covered by their own
// tests. These tests assert the organism's states (loading / error /
// unavailable / chat), the guest wiring it hands the viewers, and the
// launcher→viewer handoff on session creation.
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

const profileState: { current: UseSharedAgentProfileReturn } = {
  current: {
    profile: null,
    isLoading: true,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  },
};
vi.mock("../useSharedAgentProfile", () => ({
  useSharedAgentProfile: () => profileState.current,
}));

import { SharedAgentChat } from "../SharedAgentChat";

const PROFILE = {
  org: "acme",
  slug: "support-agent",
  name: "Support Agent",
  description: "Answers support questions",
  iconUrl: "",
  defaultInstanceId: "inst_1",
} as never;

function setProfileState(state: Partial<UseSharedAgentProfileReturn>) {
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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SharedAgentChat", () => {
  it("renders a loading skeleton while the profile resolves", () => {
    setProfileState({ isLoading: true });
    render(<SharedAgentChat org="acme" slug="support-agent" />);

    expect(screen.getByLabelText("Loading agent")).toBeTruthy();
    expect(newSessionViewerProps).toHaveLength(0);
  });

  it("renders an error state with retry on transient failures", () => {
    const refetch = vi.fn();
    setProfileState({ error: new Error("network down"), refetch });
    render(<SharedAgentChat org="acme" slug="support-agent" />);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the unavailable state when the agent is not shared", () => {
    setProfileState({ profile: null });
    render(<SharedAgentChat org="acme" slug="support-agent" />);

    expect(screen.getByText("This agent isn't available")).toBeTruthy();
    expect(newSessionViewerProps).toHaveLength(0);
  });

  it("renders the unavailable state when the profile has no default instance", () => {
    setProfileState({
      profile: { ...(PROFILE as object), defaultInstanceId: "" } as never,
    });
    render(<SharedAgentChat org="acme" slug="support-agent" />);

    expect(screen.getByText("This agent isn't available")).toBeTruthy();
  });

  it("renders the agent header and a guest launcher pinned to the shared instance", () => {
    setProfileState({ profile: PROFILE });
    render(<SharedAgentChat org="acme" slug="support-agent" />);

    expect(screen.getByRole("heading", { name: "Support Agent" })).toBeTruthy();
    expect(screen.getByText("Answers support questions")).toBeTruthy();

    expect(newSessionViewerProps).toHaveLength(1);
    expect(newSessionViewerProps[0]).toMatchObject({
      org: "acme",
      audience: "guest",
      initialAgentRef: { org: "acme", slug: "support-agent" },
      initialInstanceId: "inst_1",
      enableGitHub: false,
    });
  });

  it("hands off to a guest SessionViewer once the session is created", () => {
    setProfileState({ profile: PROFILE });
    const onSessionCreated = vi.fn();
    render(
      <SharedAgentChat
        org="acme"
        slug="support-agent"
        onSessionCreated={onSessionCreated}
      />,
    );

    const created = newSessionViewerProps[0]
      .onSessionCreated as (id: string) => void;
    act(() => created("ses_1"));

    expect(onSessionCreated).toHaveBeenCalledWith("ses_1");
    expect(screen.getByTestId("session-probe")).toBeTruthy();
    expect(sessionViewerProps[0]).toMatchObject({
      sessionId: "ses_1",
      org: "acme",
      audience: "guest",
      enableGitHub: false,
    });
  });

  it("surfaces launcher errors through the composer footer", () => {
    setProfileState({ profile: PROFILE });
    const { rerender } = render(
      <SharedAgentChat org="acme" slug="support-agent" />,
    );

    const onError = newSessionViewerProps[0].onError as (msg: string) => void;
    act(() => onError("Rate limit reached"));
    rerender(<SharedAgentChat org="acme" slug="support-agent" />);

    const footer = newSessionViewerProps.at(-1)!.footerContent;
    expect(footer).toBeTruthy();
  });

  it("shows the Powered by Stigmer footer by default and hides it on request", () => {
    setProfileState({ profile: PROFILE });
    const { unmount } = render(<SharedAgentChat org="acme" slug="support-agent" />);
    expect(screen.getByText("Powered by Stigmer")).toBeTruthy();
    unmount();

    render(
      <SharedAgentChat org="acme" slug="support-agent" showPoweredBy={false} />,
    );
    expect(screen.queryByText("Powered by Stigmer")).toBeNull();
  });

  it("falls back to the slug when the profile has no display name", () => {
    setProfileState({
      profile: { ...(PROFILE as object), name: "" } as never,
    });
    render(<SharedAgentChat org="acme" slug="support-agent" />);

    expect(
      screen.getByRole("heading", { name: "support-agent" }),
    ).toBeTruthy();
  });
});
