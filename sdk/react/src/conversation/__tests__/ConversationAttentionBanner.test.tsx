import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { create } from "@bufbuild/protobuf";
import { ChannelConversationSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ConversationAttentionBanner } from "../ConversationAttentionBanner";
import type {
  ConversationCommand,
  UseConversationParticipationReturn,
} from "../useConversationParticipation";

function conversation(overrides: Record<string, unknown> = {}) {
  return create(ChannelConversationSchema, {
    agentChannelId: "ach_1",
    conversationKey: "15550001111",
    org: "acme",
    ...overrides,
  });
}

function participation(
  overrides: Partial<UseConversationParticipationReturn> = {},
): UseConversationParticipationReturn {
  return {
    reply: vi.fn(),
    takeOver: vi.fn(),
    handBack: vi.fn(),
    clearAttention: vi.fn().mockResolvedValue(conversation()),
    pendingCommands: new Set<ConversationCommand>(),
    commandErrors: new Map<ConversationCommand, Error>(),
    clearErrors: vi.fn(),
    ...overrides,
  };
}

describe("ConversationAttentionBanner", () => {
  afterEach(() => cleanup());

  it("renders nothing while the conversation is unflagged", () => {
    const { container } = render(
      <ConversationAttentionBanner
        conversation={conversation()}
        participation={participation()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows the escalating agent's reason verbatim and dismisses in place", async () => {
    const user = userEvent.setup();
    const p = participation();
    render(
      <ConversationAttentionBanner
        conversation={conversation({
          needsAttention: true,
          attentionReason: "the member is asking about a refund I cannot process",
        })}
        participation={p}
      />,
    );

    expect(
      screen.getByText(/the member is asking about a refund I cannot process/),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(p.clearAttention).toHaveBeenCalled();
  });

  it("renders a dismissal failure verbatim", () => {
    render(
      <ConversationAttentionBanner
        conversation={conversation({ needsAttention: true })}
        participation={participation({
          commandErrors: new Map([
            ["clearAttention", new Error("agent channel ach_1 not found")],
          ]),
        })}
      />,
    );
    expect(screen.getByText("agent channel ach_1 not found")).toBeDefined();
  });
});
