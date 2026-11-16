/**
 * The conversations workbench narrower than 640px of its own width shows
 * one pane at a time: the list until a conversation is chosen, then that
 * conversation with "Conversations", the way back, which clears the
 * selection. The width is measured by `useIsNarrowerThan`, stood in here.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import {
  ChannelConversationSchema,
  ConversationControl,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_io_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";

vi.mock("../../internal/useIsNarrowerThan.js", () => ({ useIsNarrowerThan: () => true }));

import { ConversationsWorkbench } from "../ConversationsWorkbench";

const SELECTED = { channelId: "chn_wa", conversationKey: "15550001111" };

function row() {
  return create(ChannelConversationSchema, {
    ...SELECTED,
    org: "acme",
    displayName: "Pat",
    control: ConversationControl.control_agent,
    lastActivityAt: timestampFromDate(new Date("2026-08-07T11:00:00Z")),
  });
}

function client() {
  return {
    channel: {
      list: vi.fn().mockResolvedValue({
        entries: [
          create(ChannelSchema, {
            metadata: { id: "chn_wa", org: "acme", name: "support-line", slug: "support-line" },
            spec: { agentRef: { org: "acme", slug: "support-agent" }, type: { case: "whatsapp", value: {} } },
          }),
        ],
        nextPageToken: "",
      }),
      listConversations: vi.fn().mockResolvedValue({ entries: [row()], nextPageToken: "" }),
      getConversation: vi.fn().mockResolvedValue(row()),
      listTimeline: vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }),
    },
  } as never;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={client()}>{children}</StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );
}

afterEach(cleanup);

describe("ConversationsWorkbench, narrow", () => {
  it("shows the list alone until a conversation is chosen", async () => {
    render(<ConversationsWorkbench org="acme" selected={null} onSelectionChange={vi.fn()} />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText("Pat")).toBeDefined());
    expect(screen.queryByText("Choose a conversation")).toBeNull();
  });

  it("shows the chosen conversation alone, and its way back clears the selection", async () => {
    const onSelectionChange = vi.fn();
    render(<ConversationsWorkbench org="acme" selected={SELECTED} onSelectionChange={onSelectionChange} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(screen.getByRole("heading", { level: 2 })).toBeDefined());
    expect(screen.queryByLabelText("Conversation list")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    expect(onSelectionChange).toHaveBeenCalledWith(null);
  });
});
