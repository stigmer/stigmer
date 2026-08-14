import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  ChannelSendOutcome,
  SendChannelMessageOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ConversationTemplatePickerDialog } from "../ConversationTemplatePickerDialog";

function makeTemplate(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "fee_reminder",
    language: "en_US",
    category: "UTILITY",
    status: "APPROVED",
    parameterFormat: "POSITIONAL",
    parameterNames: ["1", "2"],
    bodyText: "Hi {{1}}, your fee of {{2}} is due.",
    headerFormat: "",
    rejectionReason: "",
    unsupportedReason: "",
    ...overrides,
  };
}

function output(outcome: ChannelSendOutcome, detail = "") {
  return create(SendChannelMessageOutputSchema, {
    outcome,
    outboundMessageId: outcome === ChannelSendOutcome.refused ? "" : "obm_1",
    detail,
  });
}

function renderPicker(options?: {
  templates?: unknown[];
  onSend?: ReturnType<typeof vi.fn>;
  onOpenChange?: ReturnType<typeof vi.fn>;
  isSending?: boolean;
}) {
  const listTemplates = vi
    .fn()
    .mockResolvedValue({ entries: options?.templates ?? [makeTemplate()] });
  const onSend =
    options?.onSend ?? vi.fn().mockResolvedValue(output(ChannelSendOutcome.accepted));
  const client = { agentChannel: { listTemplates } } as never;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  const view = render(
    <ConversationTemplatePickerDialog
      open
      onOpenChange={options?.onOpenChange ?? vi.fn()}
      channelSlug="wa-main"
      org="acme"
      onSend={onSend}
      isSending={options?.isSending ?? false}
      modal={false}
    />,
    { wrapper: Wrapper },
  );
  return { view, listTemplates, onSend };
}

describe("ConversationTemplatePickerDialog", () => {
  afterEach(() => cleanup());

  it("lists approved templates and asks the wire for approved only", async () => {
    const { listTemplates } = renderPicker();

    await waitFor(() => expect(screen.getByText("fee_reminder")).toBeDefined());
    expect(listTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "wa-main", org: "acme", approvedOnly: true }),
    );
  });

  it("marks unsupported and image-header templates unsendable, with the reason", async () => {
    renderPicker({
      templates: [
        makeTemplate({
          name: "flow_template",
          unsupportedReason: "FLOW buttons are not supported",
        }),
        makeTemplate({ name: "hero_image", headerFormat: "IMAGE" }),
        makeTemplate(),
      ],
    });

    await waitFor(() => expect(screen.getByText("fee_reminder")).toBeDefined());
    const unsupported = screen
      .getByText("flow_template")
      .closest("button") as HTMLButtonElement;
    expect(unsupported.disabled).toBe(true);
    expect(screen.getByText(/FLOW buttons are not supported/)).toBeDefined();

    // The v1 scope cut (cloud#260): the send payload's image link has no
    // console-side source yet, so the template shows but cannot be picked.
    const imageHeader = screen
      .getByText("hero_image")
      .closest("button") as HTMLButtonElement;
    expect(imageHeader.disabled).toBe(true);
    expect(screen.getByText(/image header needs a hosted image/)).toBeDefined();

    const sendable = screen
      .getByText("fee_reminder")
      .closest("button") as HTMLButtonElement;
    expect(sendable.disabled).toBe(false);
  });

  it("phrases an empty registry answer as none FOUND, never none exist", async () => {
    renderPicker({ templates: [] });
    await waitFor(() =>
      expect(screen.getByText("No approved templates found")).toBeDefined(),
    );
  });

  it("fills variables with a live preview and only then enables Send", async () => {
    const user = userEvent.setup();
    renderPicker();

    await waitFor(() => expect(screen.getByText("fee_reminder")).toBeDefined());
    await user.click(screen.getByText("fee_reminder"));

    const send = screen.getByRole("button", { name: "Send template" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    await user.type(screen.getByLabelText("1"), "Noor");
    await user.type(screen.getByLabelText("2"), "$40");

    // The preview substitutes the filled values into the verbatim body —
    // the exact message the customer receives. Segments render as
    // separate spans, so assert on the whole paragraph.
    const preview = screen.getByText("Preview").nextElementSibling;
    expect(preview?.textContent).toBe("Hi Noor, your fee of $40 is due.");
    expect(send.disabled).toBe(false);
  });

  it("sends the chosen entry's name, language, and trimmed parameters, and closes on accepted", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { onSend } = renderPicker({ onOpenChange });

    await waitFor(() => expect(screen.getByText("fee_reminder")).toBeDefined());
    await user.click(screen.getByText("fee_reminder"));
    await user.type(screen.getByLabelText("1"), " Noor ");
    await user.type(screen.getByLabelText("2"), "$40");
    await user.click(screen.getByRole("button", { name: "Send template" }));

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith({
        kind: "template",
        name: "fee_reminder",
        language: "en_US",
        parameters: { "1": "Noor", "2": "$40" },
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the dialog open with every value intact and shows the detail verbatim on refusal", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSend = vi
      .fn()
      .mockResolvedValue(
        output(ChannelSendOutcome.refused, "template 'fee_reminder' is PAUSED on WhatsApp"),
      );
    renderPicker({ onSend, onOpenChange });

    await waitFor(() => expect(screen.getByText("fee_reminder")).toBeDefined());
    await user.click(screen.getByText("fee_reminder"));
    await user.type(screen.getByLabelText("1"), "Noor");
    await user.type(screen.getByLabelText("2"), "$40");
    await user.click(screen.getByRole("button", { name: "Send template" }));

    await waitFor(() =>
      expect(
        screen.getByText("template 'fee_reminder' is PAUSED on WhatsApp"),
      ).toBeDefined(),
    );
    // The words never left; the correction the detail asks for starts
    // from the values already filled (the composer's draft contract).
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect((screen.getByLabelText("1") as HTMLInputElement).value).toBe("Noor");
    expect((screen.getByLabelText("2") as HTMLInputElement).value).toBe("$40");
  });

  it("keeps the dialog open and renders a thrown failure", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockRejectedValue(new Error("transport exploded"));
    renderPicker({ onSend });

    await waitFor(() => expect(screen.getByText("fee_reminder")).toBeDefined());
    await user.click(screen.getByText("fee_reminder"));
    await user.type(screen.getByLabelText("1"), "Noor");
    await user.type(screen.getByLabelText("2"), "$40");
    await user.click(screen.getByRole("button", { name: "Send template" }));

    await waitFor(() => expect(screen.getByText(/transport exploded/)).toBeDefined());
    expect((screen.getByLabelText("1") as HTMLInputElement).value).toBe("Noor");
  });

  it("navigates back to the list, discarding the selection", async () => {
    const user = userEvent.setup();
    renderPicker({
      templates: [makeTemplate(), makeTemplate({ name: "order_update" })],
    });

    await waitFor(() => expect(screen.getByText("fee_reminder")).toBeDefined());
    await user.click(screen.getByText("fee_reminder"));
    expect(screen.getByRole("button", { name: "Send template" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Back to the template list" }));
    expect(screen.getByText("order_update")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Send template" })).toBeNull();
  });
});
