import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { create } from "@bufbuild/protobuf";
import {
  ChannelConversationSchema,
  ConversationControl,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ConversationControlBanner } from "../ConversationControlBanner";
import type {
  ConversationCommand,
  UseConversationParticipationReturn,
} from "../useConversationParticipation";

function conversation(control: ConversationControl, controlledBy = "") {
  return create(ChannelConversationSchema, {
    agentChannelId: "ach_1",
    conversationKey: "15550001111",
    org: "acme",
    control,
    controlledBy,
  });
}

function participation(
  overrides: Partial<UseConversationParticipationReturn> = {},
): UseConversationParticipationReturn {
  return {
    reply: vi.fn(),
    takeOver: vi.fn().mockResolvedValue(
      conversation(ConversationControl.control_human, "idt_me"),
    ),
    handBack: vi.fn().mockResolvedValue(conversation(ConversationControl.control_agent)),
    clearAttention: vi.fn(),
    pendingCommands: new Set<ConversationCommand>(),
    commandErrors: new Map<ConversationCommand, Error>(),
    clearErrors: vi.fn(),
    ...overrides,
  };
}

function baseProps() {
  return {
    conversation: conversation(ConversationControl.control_agent),
    participation: participation(),
    unansweredCustomer: false,
    supportsStaffReplies: true,
  };
}

describe("ConversationControlBanner", () => {
  afterEach(() => cleanup());

  it("offers Take over while the agent serves, and calls it", async () => {
    const user = userEvent.setup();
    const p = participation();
    render(<ConversationControlBanner {...baseProps()} participation={p} />);

    expect(screen.getByText("The agent is serving this conversation.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Take over" }));
    expect(p.takeOver).toHaveBeenCalled();
  });

  it("says YOU hold it only when the host-provided identity matches", () => {
    const held = conversation(ConversationControl.control_human, "idt_me");
    const { rerender } = render(
      <ConversationControlBanner
        {...baseProps()}
        conversation={held}
        currentIdentityAccountId="idt_me"
      />,
    );
    expect(screen.getByText(/You have this conversation/)).toBeDefined();

    // The CAS loser's truth: the winner holds it, and the copy says a
    // teammate does — never "you".
    rerender(
      <ConversationControlBanner
        {...baseProps()}
        conversation={conversation(ConversationControl.control_human, "idt_someone_else")}
        currentIdentityAccountId="idt_me"
      />,
    );
    expect(screen.getByText(/A teammate has this conversation/)).toBeDefined();
  });

  it("hands back directly when the customer's last message is answered", async () => {
    const user = userEvent.setup();
    const p = participation();
    render(
      <ConversationControlBanner
        {...baseProps()}
        conversation={conversation(ConversationControl.control_human, "idt_me")}
        participation={p}
        unansweredCustomer={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Hand back to agent" }));
    expect(p.handBack).toHaveBeenCalled();
  });

  it("guards handback behind a confirm while the customer awaits an answer (DD-007 D-e)", async () => {
    const user = userEvent.setup();
    const p = participation();
    render(
      <ConversationControlBanner
        {...baseProps()}
        conversation={conversation(ConversationControl.control_human, "idt_me")}
        participation={p}
        unansweredCustomer
      />,
    );

    await user.click(screen.getByRole("button", { name: "Hand back to agent" }));
    // No turn runs on handback — the agent stays quiet until the
    // customer writes again. The state must be unmissable first.
    expect(p.handBack).not.toHaveBeenCalled();
    expect(screen.getByText(/last message has no reply/)).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Hand back anyway" }));
    expect(p.handBack).toHaveBeenCalled();
  });

  it("lets the user keep the conversation from the guard without handing back", async () => {
    const user = userEvent.setup();
    const p = participation();
    render(
      <ConversationControlBanner
        {...baseProps()}
        conversation={conversation(ConversationControl.control_human, "idt_me")}
        participation={p}
        unansweredCustomer
      />,
    );

    await user.click(screen.getByRole("button", { name: "Hand back to agent" }));
    await user.click(screen.getByRole("button", { name: "Keep the conversation" }));

    expect(p.handBack).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Hand back to agent" })).toBeDefined();
  });

  it("disables takeover on senderless providers with the reason", () => {
    render(<ConversationControlBanner {...baseProps()} supportsStaffReplies={false} />);

    const button = screen.getByRole("button", { name: "Take over" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toMatch(/no send lane for staff messages/);
  });

  it("renders a command failure verbatim beside the controls", () => {
    render(
      <ConversationControlBanner
        {...baseProps()}
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
