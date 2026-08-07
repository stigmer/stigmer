import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  ChannelConversationSchema,
  ConversationControl,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useConversationParticipation } from "../useConversationParticipation";

const IDENTITY = { agentChannelId: "ach_1", conversationKey: "15550001111" };

function row(control: ConversationControl, controlledBy = "") {
  return create(ChannelConversationSchema, {
    ...IDENTITY,
    org: "acme",
    control,
    controlledBy,
  });
}

function createMockStigmer(overrides: Record<string, unknown> = {}) {
  return {
    agentChannel: {
      reply: vi.fn().mockResolvedValue({ outcome: 1, outboundMessageId: "obm_1" }),
      takeOver: vi.fn().mockResolvedValue(row(ConversationControl.control_human, "idt_me")),
      handBack: vi.fn().mockResolvedValue(row(ConversationControl.control_agent)),
      clearAttention: vi.fn().mockResolvedValue(row(ConversationControl.control_agent)),
      getConversation: vi
        .fn()
        .mockResolvedValue(row(ConversationControl.control_human, "idt_me")),
      ...overrides,
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useConversationParticipation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("takeOver feeds the fresh row to onConversation", async () => {
    const client = createMockStigmer();
    const onConversation = vi.fn();
    const { result } = renderHook(
      () => useConversationParticipation({ ...IDENTITY, onConversation }),
      { wrapper: wrapper(client) },
    );

    await act(() => result.current.takeOver());

    expect(onConversation).toHaveBeenCalledWith(
      expect.objectContaining({ control: ConversationControl.control_human }),
    );
  });

  it("feeds the CAS loser's answer too — the winner's state IS the server truth", async () => {
    // A lost concurrent takeover is success-with-the-winner's-state,
    // never an error. The hook must pass it through unfiltered so the
    // UI shows WHO holds the conversation instead of pretending the
    // caller's transition won.
    const client = createMockStigmer({
      takeOver: vi
        .fn()
        .mockResolvedValue(row(ConversationControl.control_human, "idt_someone_else")),
    });
    const onConversation = vi.fn();
    const { result } = renderHook(
      () => useConversationParticipation({ ...IDENTITY, onConversation }),
      { wrapper: wrapper(client) },
    );

    const answer = await act(() => result.current.takeOver());

    expect(answer.controlledBy).toBe("idt_someone_else");
    expect(onConversation).toHaveBeenCalledWith(
      expect.objectContaining({ controlledBy: "idt_someone_else" }),
    );
  });

  it("reply sends a text payload and follows up with the fresh row — the implicit takeover already happened", async () => {
    const client = createMockStigmer();
    const onConversation = vi.fn();
    const { result } = renderHook(
      () => useConversationParticipation({ ...IDENTITY, onConversation }),
      { wrapper: wrapper(client) },
    );

    const output = await act(() => result.current.reply("on my way"));

    expect(output.outboundMessageId).toBe("obm_1");
    const agentChannel = (client as { agentChannel: Record<string, ReturnType<typeof vi.fn>> })
      .agentChannel;
    expect(agentChannel.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ...IDENTITY,
        payload: expect.objectContaining({
          kind: expect.objectContaining({ case: "text" }),
        }),
      }),
    );
    expect(agentChannel.getConversation).toHaveBeenCalledWith(
      expect.objectContaining(IDENTITY),
    );
    expect(onConversation).toHaveBeenCalledWith(
      expect.objectContaining({ control: ConversationControl.control_human }),
    );
  });

  it("still resolves the reply when the follow-up row read fails — the send outcome is the answer", async () => {
    const client = createMockStigmer({
      getConversation: vi.fn().mockRejectedValue(new Error("blip")),
    });
    const onConversation = vi.fn();
    const { result } = renderHook(
      () => useConversationParticipation({ ...IDENTITY, onConversation }),
      { wrapper: wrapper(client) },
    );

    const output = await act(() => result.current.reply("on my way"));

    expect(output.outboundMessageId).toBe("obm_1");
    expect(onConversation).not.toHaveBeenCalled();
    expect(result.current.commandErrors.size).toBe(0);
  });

  it("skips the follow-up read entirely when nobody listens for the row", async () => {
    const client = createMockStigmer();
    const { result } = renderHook(() => useConversationParticipation(IDENTITY), {
      wrapper: wrapper(client),
    });

    await act(() => result.current.reply("on my way"));

    const agentChannel = (client as { agentChannel: Record<string, ReturnType<typeof vi.fn>> })
      .agentChannel;
    expect(agentChannel.getConversation).not.toHaveBeenCalled();
  });

  it("attributes in-flight state and failures to the one command they belong to", async () => {
    let releaseTakeOver: (value: unknown) => void = () => {};
    const client = createMockStigmer({
      takeOver: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          releaseTakeOver = resolve;
        }),
      ),
      handBack: vi.fn().mockRejectedValue(new Error("no send lane")),
    });
    const { result } = renderHook(() => useConversationParticipation(IDENTITY), {
      wrapper: wrapper(client),
    });

    let takeOverPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      takeOverPromise = result.current.takeOver();
    });
    await waitFor(() => expect(result.current.pendingCommands.has("takeOver")).toBe(true));

    await act(async () => {
      await expect(result.current.handBack()).rejects.toThrow("no send lane");
    });

    // The failure belongs to handBack; takeOver is still cleanly in flight.
    expect(result.current.commandErrors.get("handBack")?.message).toBe("no send lane");
    expect(result.current.commandErrors.has("takeOver")).toBe(false);
    expect(result.current.pendingCommands.has("takeOver")).toBe(true);
    expect(result.current.pendingCommands.has("handBack")).toBe(false);

    await act(async () => {
      releaseTakeOver(row(ConversationControl.control_human, "idt_me"));
      await takeOverPromise;
    });
    expect(result.current.pendingCommands.size).toBe(0);
  });
});
