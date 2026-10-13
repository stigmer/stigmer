import { describe, it, expect, vi, afterEach } from "vitest";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  ChannelAppSchema,
  type ChannelApp,
} from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { StigmerContext } from "../../context";
import { ChannelAppDetailPanel } from "../ChannelAppDetailPanel";

/**
 * The detail form's save names its provider arm alone (`spec.slack`), on
 * the app as loaded, so identity fields and any other spec field keep
 * their stored values without being sent back. Secrets follow the
 * redaction contract: the form is seeded with the
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
    // The credentials form is gated on can_edit; this is the creator's view.
    iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
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
  it("names the slack arm alone, sending the marker for the secrets it did not change", async () => {
    const update = vi.fn(async (_resource: ChannelApp, _paths: string[]) => SLACK_APP);
    renderPanel(update);

    const clientId = await screen.findByLabelText(/client id/i);
    fireEvent.change(clientId, { target: { value: "9999.0000" } });
    fireEvent.click(screen.getByRole("button", { name: /save credentials/i }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<ChannelApp>(update);

    // The arm alone, addressed by the app's id.
    expect(sent.paths).toEqual(["spec.slack"]);
    expect(sent.id).toBe("chapp_1");
    // The edited field, plus per-field keep-markers for untouched secrets.
    expect(sent.resource.spec?.providerConfig).toMatchObject({
      case: "slack",
      value: { clientId: "9999.0000", clientSecret: REDACTED, signingSecret: REDACTED },
    });
  });
});
