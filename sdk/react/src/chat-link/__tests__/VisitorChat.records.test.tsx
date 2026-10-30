import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { UseChannelAgentProfileReturn } from "../useChannelAgentProfile";
import type { SessionComposerProps } from "../../composer";

// ---------------------------------------------------------------------------
// What the hosted chat link page writes, end to end through the real launcher and
// new-session flow down to the client call.
//
// A visitor's first message is one Run create whose target is a
// new session spec. It must name the chat link's organization explicitly
// (`metadata.org = profile.org`) and start the session on the chat link's agent
// reference exactly as the profile gives it, version included. The server's
// reference rule runs before the hosted edition's guest gate fills an
// organization in, and reads an empty one as "another organization", which
// would refuse every org-visible agent; the guest gate admits a
// session only on the chat link's own reference. Only the composer (its UI) and
// the profile read are replaced; everything between them and the client is
// the code the page runs, up to the conversation view.
// ---------------------------------------------------------------------------

let composerSubmit: SessionComposerProps["onSubmit"] | undefined;
vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: (props: SessionComposerProps) => {
      composerSubmit = props.onSubmit;
      return <div data-testid="composer-probe" />;
    },
  };
});

// The conversation view after the handoff reads its own session; its
// follow-ups' organization is pinned by useSessionConversation's tests.
vi.mock("../../session/SessionViewer", () => ({
  SessionViewer: () => <div data-testid="session-probe" />,
}));

const LINK_AGENT_REF = { org: "org_acme", slug: "support-bot", version: "v2", kind: 40 };
const PROFILE = {
  org: "org_acme",
  slug: "support-agent",
  name: "Support Agent",
  description: "",
  iconUrl: "",
  agentRef: LINK_AGENT_REF,
};

vi.mock("../useChannelAgentProfile", () => ({
  useChannelAgentProfile: (): UseChannelAgentProfileReturn => ({
    profile: PROFILE as never,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { VisitorChat } from "../VisitorChat";

const createExecution = vi.fn(async (_input: Record<string, unknown>) => ({
  metadata: { id: "run_1" },
  spec: { target: { case: "sessionId", value: "ses_1" } },
}));

// Server info answers the composer's Environment entry, never offered to a
// visitor: a server that predates the field.
const client = { run: { create: createExecution }, platform: { getServerInfo: async () => ({}) } };

function Providers({ children }: { children: ReactNode }) {
  return (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  composerSubmit = undefined;
});

describe("VisitorChat — the records a visitor's first message writes", () => {
  it("names the chat link's organization and starts the session on the chat link's agent reference exactly", async () => {
    const onSessionCreated = vi.fn();
    render(
      <Providers>
        <VisitorChat channelId="chn_1" onSessionCreated={onSessionCreated} />
      </Providers>,
    );

    // The launcher's mount-time pin lands before the visitor can send.
    await waitFor(() => expect(composerSubmit).toBeDefined());
    await act(async () => {
      composerSubmit!("Hello");
    });
    await waitFor(() => expect(createExecution).toHaveBeenCalledTimes(1));

    const input = createExecution.mock.calls[0][0];
    // metadata.org of the run, and of the session the server creates
    // from its spec, is the chat link's organization, set explicitly.
    expect(input.org).toBe(PROFILE.org);
    // A new conversation: the target is the session spec, never an id.
    expect(input.sessionId).toBeUndefined();
    const sessionSpec = input.sessionSpec as { agentRef?: unknown };
    expect(sessionSpec.agentRef).toEqual(LINK_AGENT_REF);
    await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith("ses_1"));
  });
});
