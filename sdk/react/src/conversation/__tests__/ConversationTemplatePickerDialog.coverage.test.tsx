/**
 * ConversationTemplatePickerDialog's failed fetch: when the channel's
 * templates cannot be listed, the dialog says "Couldn't load the
 * templates." with the server's words in place of a template list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { ConversationTemplatePickerDialog } from "../ConversationTemplatePickerDialog";

describe("ConversationTemplatePickerDialog", () => {
  afterEach(() => cleanup());

  it("shows the server's refusal when the templates cannot be listed", async () => {
    const listTemplates = vi.fn().mockRejectedValue(new Error("WhatsApp Business account is not connected"));
    const client = { channel: { listTemplates } } as never;
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <FetchCacheContext.Provider value={null}>
          <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
        </FetchCacheContext.Provider>
      );
    }

    render(
      <ConversationTemplatePickerDialog
        open
        onOpenChange={vi.fn()}
        channelSlug="wa-main"
        org="acme"
        onSend={vi.fn()}
        isSending={false}
        modal={false}
      />,
      { wrapper: Wrapper },
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the templates.");
    expect(alert.textContent).toContain("WhatsApp Business account is not connected");
    expect(listTemplates).toHaveBeenCalled();
  });
});
