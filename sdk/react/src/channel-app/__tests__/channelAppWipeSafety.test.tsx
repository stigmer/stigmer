import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  ChannelAppSchema,
  type ChannelApp,
} from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import type { ChannelAppInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ChannelAppDetailPanel } from "../ChannelAppDetailPanel";

/**
 * Regression suite for the full-spec-replace wipe bug: both detail forms
 * must spread `toChannelAppUpdateInput` and override only their provider
 * arm, so identity fields and any future spec field survive the save.
 * Secrets follow the redaction contract: the form is seeded with the
 * server's redaction marker, and sending the marker back means "keep the
 * stored value" (per-field, verified by the backend's
 * TestRedactAndEncryptCoverEveryProviderArm).
 */

const REDACTED = "***REDACTED***";

const SLACK_APP: ChannelApp = create(ChannelAppSchema, {
  metadata: {
    id: "chapp_1",
    name: "Acme Slack",
    slug: "acme-slack",
    org: "acme",
    labels: { team: "support" },
  },
  spec: {
    providerConfig: {
      case: "slack",
      value: {
        clientId: "1234.5678",
        clientSecret: REDACTED,
        signingSecret: REDACTED,
      },
    },
  },
});

function renderPanel(update: ReturnType<typeof vi.fn>) {
  const client = {
    baseUrl: "https://api.stigmer.ai",
    channelapp: { update, delete: vi.fn(async () => ({})) },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <ChannelAppDetailPanel
        channelApp={SLACK_APP}
        consoleOrigin="https://console.acme.example"
      />
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("ChannelAppDetailPanel save payload (slack arm)", () => {
  it("spreads the complete mapped input and overrides only the slack config", async () => {
    const update = vi.fn(async (_input: ChannelAppInput) => SLACK_APP);
    renderPanel(update);

    const clientId = await screen.findByLabelText(/client id/i);
    fireEvent.change(clientId, { target: { value: "9999.0000" } });
    fireEvent.click(screen.getByRole("button", { name: /save credentials/i }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    // The edited field, plus per-field keep-markers for untouched secrets.
    expect(input.slack).toEqual({
      clientId: "9999.0000",
      clientSecret: REDACTED,
      signingSecret: REDACTED,
    });
    // Identity and unrendered metadata survive via the mapper spread.
    expect(input.name).toBe("Acme Slack");
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("acme-slack");
    expect(input.labels).toEqual({ team: "support" });
    // The other provider arm stays absent — the oneof is preserved.
    expect(input.whatsapp).toBeUndefined();
  });
});
