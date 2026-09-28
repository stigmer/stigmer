import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  ChannelAppSchema,
  type ChannelApp,
} from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import type { CheckMyPermissionInput } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { StigmerContext } from "../../context";
import { ChannelAppDetailPanel } from "../ChannelAppDetailPanel";

/**
 * Pins the detail panel's change affordances against the server's
 * verdicts: the credentials form is offered only with `can_edit` and the
 * deletion section only with `can_delete` on the app, so a caller granted
 * viewer on a channel app is never handed a control the server would
 * refuse (stigmer/stigmer#1384). The setup values stay readable to every
 * caller who may open the app. The save payload is pinned beside it
 * (channelAppWipeSafety.test.tsx, channelAppWhatsApp.test.tsx).
 */

const SLACK_APP: ChannelApp = create(ChannelAppSchema, {
  metadata: {
    id: "chapp_1",
    name: "Acme Slack",
    slug: "acme-slack",
    org: "acme",
  },
  spec: {
    providerConfig: {
      case: "slack",
      value: {
        clientId: "1234.5678",
        clientSecret: "***REDACTED***",
        signingSecret: "***REDACTED***",
      },
    },
  },
});

function renderPanel(checkMyPermission: ReturnType<typeof vi.fn>) {
  const client = {
    baseUrl: "https://api.stigmer.ai",
    channelapp: { update: vi.fn(), delete: vi.fn() },
    iamPolicy: { checkMyPermission },
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

describe("ChannelAppDetailPanel credentials and delete gates", () => {
  it("offers the credentials form only with can_edit and deletion only with can_delete on the app", async () => {
    const checkMyPermission = vi.fn(async (input: CheckMyPermissionInput) => ({
      isAuthorized: input.relation === "can_delete",
    }));
    renderPanel(checkMyPermission);

    await screen.findByRole("button", { name: "Delete channel app" });
    expect(
      screen.queryByRole("button", { name: "Save credentials" }),
    ).toBeNull();
    const asked = checkMyPermission.mock.calls.map(
      ([input]) =>
        `${input.resource?.kind}:${input.resource?.id}:${input.relation}`,
    );
    expect(asked.sort()).toEqual([
      "channel_app:chapp_1:can_delete",
      "channel_app:chapp_1:can_edit",
    ]);
  });

  it("a caller granted viewer reads the setup values with neither control", async () => {
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized: false,
    }));
    renderPanel(checkMyPermission);

    await waitFor(() => expect(checkMyPermission).toHaveBeenCalledTimes(2));
    // The setup guidance stays readable; only the change affordances are withheld.
    expect(screen.getByText("Events request URL")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Save credentials" }),
      ).toBeNull(),
    );
    expect(
      screen.queryByRole("button", { name: "Delete channel app" }),
    ).toBeNull();
  });

  it("the creator and the organization's admins get both", async () => {
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized: true,
    }));
    renderPanel(checkMyPermission);

    expect(
      await screen.findByRole("button", { name: "Save credentials" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Delete channel app" }),
    ).toBeTruthy();
  });
});
