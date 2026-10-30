// Accessibility audit — an agent's Channels tab.
//
// Covers the empty tab (one add button per type, and on the open-source
// edition the note naming what Slack and WhatsApp need), a list holding a
// chat link beside a Slack and a WhatsApp card (each card a labelled
// group, with its switch and menu), and the Add channel menu open with
// its unavailable types disabled — each in light and dark against the
// shipped stylesheet. The menu portals into a themed container inside the
// audited box, so axe reads it on the same surface the panel paints.

import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import type { DeploymentMode, Stigmer } from "@stigmer/client";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { COLOR_MODES, auditA11y, renderAudited, resetAudit } from "../../__tests__/helpers/a11y-audit.js";
import { DeploymentModeContext } from "@stigmer/react-core";
import { PortalContainerContext } from "../../portal-container.js";
import { ChannelsPanel } from "../ChannelsPanel.js";

const CANVAS = { width: 720, height: 900 } as const;

const AGENT = {
  metadata: { id: "agt_1", org: "acme", slug: "support-agent", name: "Support Agent" },
  spec: {},
} as unknown as Agent;

const CHAT_LINK = {
  metadata: { id: "chn_1", org: "acme", slug: "website-chat", name: "Website chat" },
  spec: {
    agentRef: { org: "acme", slug: "support-agent" },
    enabled: true,
    type: { case: "web", value: { audience: ChannelAudience.public } },
  },
  status: { typeStatus: { case: "web", value: { linkToken: "tok" } } },
};

const SLACK = {
  metadata: { id: "chn_1", org: "acme", slug: "support-slack", name: "Support Slack" },
  spec: { agentRef: { org: "acme", slug: "support-agent" }, enabled: true, type: { case: "slack", value: {} } },
  status: {
    installState: 2,
    typeStatus: { case: "slack", value: { teamName: "Acme HQ", grantedScopes: [] } },
  },
};

const WHATSAPP = {
  metadata: { id: "chn_2", org: "acme", slug: "support-whatsapp", name: "Support WhatsApp" },
  spec: {
    agentRef: { org: "acme", slug: "support-agent" },
    enabled: false,
    type: { case: "whatsapp", value: { phoneNumberId: "106540352242922" } },
  },
  // Pending: the card offers its Connect button.
  status: { installState: 1, typeStatus: { case: undefined } },
};

function client(channels: readonly unknown[]): Stigmer {
  return {
    channel: { listByAgent: async () => ({ entries: channels, nextPageToken: "" }) },
    channelapp: { list: async () => ({ entries: [], nextPageToken: "" }) },
    grant: { checkMyPermission: async () => ({ isAuthorized: true }) },
  } as unknown as Stigmer;
}

/**
 * Supplies a portal container inside the audited box, as `StigmerProvider`
 * supplies its themed one: `null` until it mounts, so the menu waits for it.
 */
function Surface({ mode, children }: { mode: DeploymentMode; children: ReactNode }) {
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  return (
    <DeploymentModeContext.Provider value={mode}>
      <PortalContainerContext.Provider value={portal}>{children}</PortalContainerContext.Provider>
      <div ref={setPortal} />
    </DeploymentModeContext.Provider>
  );
}

afterEach(resetAudit);

describe("Channels tab a11y", () => {
  it.each(COLOR_MODES)("the empty tab on cloud (%s)", async (mode) => {
    const container = renderAudited(
      <Surface mode="cloud">
        <ChannelsPanel agent={AGENT} />
      </Surface>,
      mode,
      { ...CANVAS, client: client([]) },
    );
    await screen.findByRole("button", { name: /connect to whatsapp/i });
    await auditA11y(container, `channels empty cloud · ${mode}`);
  });

  it.each(COLOR_MODES)("the empty tab on open source, with its note (%s)", async (mode) => {
    const container = renderAudited(
      <Surface mode="local">
        <ChannelsPanel agent={AGENT} />
      </Surface>,
      mode,
      { ...CANVAS, client: client([]) },
    );
    await screen.findByText("Slack and WhatsApp need Stigmer Cloud.");
    await auditA11y(container, `channels empty local · ${mode}`);
  });

  it.each(COLOR_MODES)("a chat link beside a Slack and a WhatsApp card (%s)", async (mode) => {
    const container = renderAudited(
      <Surface mode="cloud">
        <ChannelsPanel agent={AGENT} />
      </Surface>,
      mode,
      { ...CANVAS, client: client([CHAT_LINK, SLACK, WHATSAPP]) },
    );
    await screen.findByRole("group", { name: "Chat link: Website chat" });
    await screen.findByRole("group", { name: "Slack: Support Slack" });
    await screen.findByRole("group", { name: "WhatsApp: Support WhatsApp" });
    await auditA11y(container, `channels list · ${mode}`);
  });

  it.each(COLOR_MODES)("the Add channel menu open, its vendor types disabled (%s)", async (mode) => {
    const container = renderAudited(
      <Surface mode="local">
        <ChannelsPanel agent={AGENT} />
      </Surface>,
      mode,
      { ...CANVAS, client: client([CHAT_LINK]) },
    );
    await userEvent.click(await screen.findByRole("button", { name: /add channel/i }));
    await screen.findByRole("menuitem", { name: /^Chat link/ });
    await screen.findByRole("menuitem", { name: /^WhatsApp/ });
    // The menu is inside the audited box, or axe would never read it.
    expect(container.contains(screen.getByRole("menu"))).toBe(true);
    await auditA11y(container, `channels add menu · ${mode}`);
  });
});
