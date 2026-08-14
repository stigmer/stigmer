import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { create } from "@bufbuild/protobuf";
import {
  ChannelConversationSchema,
  ConversationControl,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
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
    takeOver: vi.fn().mockResolvedValue(conversation()),
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

  it("offers Take over beside Dismiss while the agent holds it — the escalation's answer lives where the escalation speaks (cloud#266, F-20)", async () => {
    const user = userEvent.setup();
    const p = participation();
    render(
      <ConversationAttentionBanner
        conversation={conversation({ needsAttention: true })}
        participation={p}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Take over" }));
    expect(p.takeOver).toHaveBeenCalled();
    // Dismiss stays — the false-alarm path never disappears.
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();
  });

  it("offers only Dismiss when a human already holds it — the human arriving IS the attention answered", () => {
    render(
      <ConversationAttentionBanner
        conversation={conversation({
          needsAttention: true,
          control: ConversationControl.control_human,
          controlledBy: "idt_staff",
        })}
        participation={participation()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Take over" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();
  });

  it("offers only Dismiss on senderless providers — the control banner already explains the missing lane", () => {
    render(
      <ConversationAttentionBanner
        conversation={conversation({ needsAttention: true })}
        participation={participation()}
        supportsStaffReplies={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Take over" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();
  });

  it("shows the takeover in flight and renders its failure verbatim", () => {
    const { rerender } = render(
      <ConversationAttentionBanner
        conversation={conversation({ needsAttention: true })}
        participation={participation({
          pendingCommands: new Set<ConversationCommand>(["takeOver"]),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Taking over…" })).toBeDefined();

    rerender(
      <ConversationAttentionBanner
        conversation={conversation({ needsAttention: true })}
        participation={participation({
          commandErrors: new Map([
            ["takeOver", new Error("this channel is disabled: set spec.enabled to resume messaging on it")],
          ]),
        })}
      />,
    );
    expect(
      screen.getByText("this channel is disabled: set spec.enabled to resume messaging on it"),
    ).toBeDefined();
  });
});
