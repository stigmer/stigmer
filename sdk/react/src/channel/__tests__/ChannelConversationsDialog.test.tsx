import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ChannelConversationsDialog } from "../ChannelConversationsDialog";

const CHANNEL = {
  metadata: { id: "ach_1", org: "acme", name: "Leftbin Slack", slug: "leftbin-slack" },
  spec: { enabled: true },
} as unknown as AgentChannel;

function makeChannelSession(id: string, subject: string, externalUser?: string) {
  return {
    metadata: {
      id,
      org: "acme",
      labels: {
        "stigmer.ai/channel-id": "ach_1",
        ...(externalUser
          ? { "stigmer.ai/channel-external-user-key": externalUser }
          : {}),
      },
    },
    spec: { subject },
  };
}

function renderDialog(
  listByChannel: (input: unknown) => Promise<unknown>,
  props?: { sessionHref?: (id: string) => string },
) {
  const client = { session: { listByChannel } } as never;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return render(
    <ChannelConversationsDialog
      open
      onOpenChange={vi.fn()}
      channel={CHANNEL}
      modal={false}
      {...props}
    />,
    { wrapper: Wrapper },
  );
}

describe("ChannelConversationsDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("lists conversations with subject, external user, and session links", async () => {
    const listByChannel = vi.fn().mockResolvedValue({
      entries: [
        makeChannelSession("ses_1", "What is a skill?", "U0AB12CD3"),
        makeChannelSession("ses_2", "Deploy help"),
      ],
    });

    renderDialog(listByChannel, { sessionHref: (id) => `/sessions/${id}` });

    await waitFor(() =>
      expect(screen.getByText("What is a skill?")).toBeDefined(),
    );
    expect(screen.getByText("U0AB12CD3")).toBeDefined();

    const link = screen.getByRole("link", { name: /What is a skill\?/ });
    expect(link.getAttribute("href")).toBe("/sessions/ses_1");
  });

  it("renders rows without links when the host provides no session route", async () => {
    const listByChannel = vi.fn().mockResolvedValue({
      entries: [makeChannelSession("ses_1", "What is a skill?", "U0AB12CD3")],
    });

    renderDialog(listByChannel);

    await waitFor(() =>
      expect(screen.getByText("What is a skill?")).toBeDefined(),
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("shows the empty state when nobody has messaged the channel", async () => {
    renderDialog(vi.fn().mockResolvedValue({ entries: [] }));

    await waitFor(() =>
      expect(screen.getByText("No conversations yet")).toBeDefined(),
    );
  });

  it("surfaces a denial verbatim (caller cannot view the channel)", async () => {
    renderDialog(
      vi.fn().mockRejectedValue(new Error("unauthorized to list channel conversations")),
    );

    await waitFor(() =>
      expect(
        screen.getByText(/unauthorized to list channel conversations/),
      ).toBeDefined(),
    );
  });
});
