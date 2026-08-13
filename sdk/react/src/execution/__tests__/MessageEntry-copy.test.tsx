import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { MessageEntry } from "../MessageEntry";

// ---------------------------------------------------------------------------
// Per-message copy affordance (stigmer/stigmer#278): every settled human and
// AI message carries a quiet copy control that writes the message's text to
// the clipboard, with transient "Copied" feedback. The affordance is
// hover-revealed but always in the DOM (keyboard/screen-reader reachable).
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function message(type: MessageType, content: string, isStreaming = false) {
  return create(AgentMessageSchema, { type, content, isStreaming });
}

function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
}

describe("MessageEntry copy affordance", () => {
  it("copies a human message's text on click and flips to Copied feedback", async () => {
    const writeText = stubClipboard();
    render(
      <MessageEntry
        message={message(MessageType.MESSAGE_HUMAN, "run the deploy again")}
      />,
    );

    fireEvent.click(screen.getByLabelText("Copy message"));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("run the deploy again");

    // The affordance answers with its transient feedback state.
    await waitFor(() => {
      expect(screen.getByLabelText("Copied")).toBeTruthy();
    });
  });

  it("copies an AI message's markdown — formatting characters included", () => {
    const writeText = stubClipboard();
    const md = "## Plan\n\n- step **one**\n- step `two`";
    render(<MessageEntry message={message(MessageType.MESSAGE_AI, md)} />);

    fireEvent.click(screen.getByLabelText("Copy message"));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(md);
  });

  it("copies the fence-unwrapped markdown the reader actually sees", () => {
    // A model that wraps its whole reply in a ```markdown fence renders
    // unwrapped (MessageEntry's render seam); the copy must match the render,
    // not re-wrap what the user is looking at.
    const writeText = stubClipboard();
    render(
      <MessageEntry
        message={message(MessageType.MESSAGE_AI, "```markdown\n# Title\nbody\n```")}
      />,
    );

    fireEvent.click(screen.getByLabelText("Copy message"));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("# Title\nbody");
  });

  it("offers no copy while an AI message is still streaming", () => {
    stubClipboard();
    render(
      <MessageEntry
        message={message(MessageType.MESSAGE_AI, "partial answer…", true)}
      />,
    );
    expect(screen.queryByLabelText("Copy message")).toBeNull();
  });

  it("offers no copy on system messages", () => {
    stubClipboard();
    render(
      <MessageEntry
        message={message(MessageType.MESSAGE_SYSTEM, "execution resumed")}
      />,
    );
    expect(screen.queryByLabelText("Copy message")).toBeNull();
  });

  it("keeps copy and edit as siblings on a human bubble when editing is wired", () => {
    stubClipboard();
    const onEdit = vi.fn();
    render(
      <MessageEntry
        message={message(MessageType.MESSAGE_HUMAN, "tweak this")}
        onEdit={onEdit}
      />,
    );

    // Both affordances present and independently operable.
    expect(screen.getByLabelText("Copy message")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Edit message"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("claims no copy when the clipboard write is rejected", async () => {
    // Insecure context / denied permission: the button must not flash
    // "Copied" for a copy that never happened.
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <MessageEntry message={message(MessageType.MESSAGE_HUMAN, "hello")} />,
    );

    fireEvent.click(screen.getByLabelText("Copy message"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByLabelText("Copied")).toBeNull();
    expect(screen.getByLabelText("Copy message")).toBeTruthy();
  });
});
