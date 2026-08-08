import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { create } from "@bufbuild/protobuf";
import {
  ChannelSendOutcome,
  SendChannelMessageOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { ConversationComposer } from "../ConversationComposer";

function output(outcome: ChannelSendOutcome, detail = "") {
  return create(SendChannelMessageOutputSchema, {
    outcome,
    outboundMessageId: outcome === ChannelSendOutcome.refused && !detail ? "" : "obm_1",
    detail,
  });
}

describe("ConversationComposer", () => {
  afterEach(() => cleanup());

  it("renders the reason instead of an input when replying is unavailable", () => {
    render(
      <ConversationComposer
        onSend={vi.fn()}
        isSending={false}
        disabledReason="Staff replies aren't available on Slack channels yet — the agent keeps serving this conversation."
      />,
    );

    expect(screen.queryByLabelText("Reply to the customer")).toBeNull();
    expect(screen.getByText(/aren't available on Slack channels yet/)).toBeDefined();
  });

  it("sends the trimmed draft and clears it when the provider accepts", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(output(ChannelSendOutcome.accepted));
    render(<ConversationComposer onSend={onSend} isSending={false} disabledReason={null} />);

    const input = screen.getByLabelText("Reply to the customer");
    await user.type(input, "on my way{Enter}");

    expect(onSend).toHaveBeenCalledWith("on my way");
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
  });

  it("keeps the draft and shows the refusal detail verbatim when the send is refused", async () => {
    const user = userEvent.setup();
    const onSend = vi
      .fn()
      .mockResolvedValue(
        output(ChannelSendOutcome.refused, "the 24-hour service window is closed"),
      );
    render(<ConversationComposer onSend={onSend} isSending={false} disabledReason={null} />);

    const input = screen.getByLabelText("Reply to the customer");
    await user.type(input, "did this arrive?{Enter}");

    await waitFor(() =>
      expect(screen.getByText("the 24-hour service window is closed")).toBeDefined(),
    );
    // The words never left the platform; the user should not retype them.
    expect((input as HTMLTextAreaElement).value).toBe("did this arrive?");
  });

  it("reports a queued send as retrying, with the draft cleared", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(output(ChannelSendOutcome.queued));
    render(<ConversationComposer onSend={onSend} isSending={false} disabledReason={null} />);

    const input = screen.getByLabelText("Reply to the customer");
    await user.type(input, "hello{Enter}");

    await waitFor(() =>
      expect(screen.getByText(/the platform is retrying in the background/)).toBeDefined(),
    );
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the spinner and blocks input while a reply is in flight (F-05)", () => {
    render(<ConversationComposer onSend={vi.fn()} isSending={true} disabledReason={null} />);

    const button = screen.getByRole("button", { name: "Send reply" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toContain("Sending…");
    // The house in-flight glyph (the session composer's pattern): the
    // static Send icon must not render while the reply is in flight.
    expect(button.querySelector("svg.animate-spin")).not.toBeNull();
    expect(
      (screen.getByLabelText("Reply to the customer") as HTMLTextAreaElement).disabled,
    ).toBe(true);
  });

  it("annotates an ENABLED input with the advisory, wired as the input's description (DD-014 D-e)", () => {
    render(
      <ConversationComposer
        onSend={vi.fn()}
        isSending={false}
        disabledReason={null}
        advisory="WhatsApp's 24-hour reply window has closed — a reply sent now will probably fail. It reopens when the customer writes again."
      />,
    );

    const input = screen.getByLabelText("Reply to the customer") as HTMLTextAreaElement;
    // A forecast, not a block: the input stays usable.
    expect(input.disabled).toBe(false);

    // R-2 (Sitting 2 gate ruling): the advisory is the input's
    // aria-describedby target — read at the moment of action — never a
    // live region (it is state a reader meets on open, not an event).
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const advisoryEl = document.getElementById(describedBy as string);
    expect(advisoryEl?.textContent).toContain("24-hour reply window has closed");
    expect(advisoryEl?.getAttribute("role")).toBeNull();

    // Zero new tab stops (the F-18 discipline).
    expect(advisoryEl?.querySelector("button, a, [tabindex]")).toBeNull();
  });

  it("renders no advisory and no dangling description when there is no claim", () => {
    render(
      <ConversationComposer onSend={vi.fn()} isSending={false} disabledReason={null} advisory={null} />,
    );
    const input = screen.getByLabelText("Reply to the customer");
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(/reply window/)).toBeNull();
  });

  it("never shows the advisory in the disabled branch — the two states are structurally exclusive", () => {
    render(
      <ConversationComposer
        onSend={vi.fn()}
        isSending={false}
        disabledReason="The customer hasn't written yet — staff replies unlock with their first message."
        advisory="WhatsApp's 24-hour reply window has closed."
      />,
    );
    expect(screen.getByText(/staff replies unlock/)).toBeDefined();
    expect(screen.queryByText(/reply window/)).toBeNull();
  });

  it("keeps the draft and renders a thrown failure", async () => {
    const user = userEvent.setup();
    const onSend = vi
      .fn()
      .mockRejectedValue(new Error("no conversation with this key exists on channel ach_1"));
    render(<ConversationComposer onSend={onSend} isSending={false} disabledReason={null} />);

    const input = screen.getByLabelText("Reply to the customer");
    await user.type(input, "hello?{Enter}");

    await waitFor(() =>
      expect(
        screen.getByText(/no conversation with this key exists on channel ach_1/),
      ).toBeDefined(),
    );
    expect((input as HTMLTextAreaElement).value).toBe("hello?");
  });
});
