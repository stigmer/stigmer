import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { clone, create } from "@bufbuild/protobuf";
import {
  ChannelAppSchema,
  type ChannelApp,
} from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import type { CheckMyPermissionInput } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
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
    grant: { checkMyPermission },
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
    // can_delete gates both deletion and the slug field (rename).
    expect([...new Set(asked)].sort()).toEqual([
      "channel_app:chapp_1:can_delete",
      "channel_app:chapp_1:can_edit",
    ]);
    expect(await screen.findByRole("button", { name: "Rename" })).toBeTruthy();
  });

  it("a caller granted viewer reads the setup values with neither control", async () => {
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized: false,
    }));
    renderPanel(checkMyPermission);

    // can_delete gates both deletion and the slug field (rename).
    await waitFor(() =>
      expect(
        new Set(checkMyPermission.mock.calls.map(([input]) => input.relation)),
      ).toEqual(new Set(["can_edit", "can_delete"])),
    );
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
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

describe("ChannelAppDetailPanel rename", () => {
  it("renames through the kind's rename for whoever may delete it, and hands the renamed resource to onUpdated", async () => {
    const renamed = clone(ChannelAppSchema, SLACK_APP);
    if (renamed.metadata !== undefined) {
      renamed.metadata.slug = "renamed-slug";
    }
    const rename = vi.fn(async () => renamed);
    const onUpdated = vi.fn();
    const client = {
      channelapp: { rename },
      grant: { checkMyPermission: async () => ({ isAuthorized: true }) },
    } as never;
    render(
      <StigmerContext.Provider value={client}>
        <ChannelAppDetailPanel channelApp={SLACK_APP} onUpdated={onUpdated} />
      </StigmerContext.Provider>,
    );

    fireEvent.change(await screen.findByLabelText("Slug", undefined, { timeout: 5000 }), {
      target: { value: "renamed-slug" },
    });
    const button = screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement;
    // The field settles before it takes the rename, however slow the runner.
    await waitFor(() => expect(button.disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(button);

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(renamed), { timeout: 5000 });
    expect(rename.mock.calls[0]).toEqual([expect.objectContaining({ resourceId: SLACK_APP.metadata?.id, slug: "renamed-slug" })]);
  });
});
