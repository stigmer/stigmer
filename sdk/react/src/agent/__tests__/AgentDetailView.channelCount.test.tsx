/**
 * The agent page's profile header and its Channels tab read one list of
 * the agent's channels: a chat link created on the tab, and one deleted
 * there, change the header's channel count as they change the tab's, so
 * the two never disagree. Pinned over a client whose channel reads answer
 * a store the creates and deletes change, as the server's would.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { ReactNode } from "react";
import { ChannelSchema, type Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import type { ChannelInput } from "@stigmer/client";
import { DeploymentModeContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { samples } from "@stigmer/react-core/test";
import { AgentDetailView } from "../AgentDetailView";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

vi.mock("../../feedback/toast", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeAll(() => {
  // happy-dom does not implement the native dialog show/close methods.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

function chatLink(id: string, name: string): Channel {
  return create(ChannelSchema, {
    metadata: { id, org: ACME_ID, slug: `chat-${id}`, name },
    spec: { agentRef: { org: ACME_ID, slug: "support-bot" }, enabled: true, type: { case: "web", value: {} } },
    status: { typeStatus: { case: "web", value: { linkToken: "tok" } } },
  });
}

function renderView() {
  const agent = samples.agent({ name: "Support Bot", slug: "support-bot", org: ACME_ID });
  const store: Channel[] = [chatLink("chn_1", "Website chat")];
  const client = {
    agent: { getByReference: vi.fn(async () => agent), update: vi.fn() },
    platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
    grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
    channelapp: { list: vi.fn(async () => ({ entries: [], nextPageToken: "" })) },
    billing: { getOrCreateBillingAccount: vi.fn(async () => null) },
    vault: { list: vi.fn(async () => ({ entries: [], nextPageToken: "" })), getByReference: vi.fn(async () => null) },
    channel: {
      listByAgent: vi.fn(async () => ({ entries: [...store], nextPageToken: "" })),
      create: vi.fn(async (input: ChannelInput) => {
        const made = chatLink(`chn_${store.length + 1}`, input.name ?? "");
        store.push(made);
        return made;
      }),
      delete: vi.fn(async (id: string) => {
        store.splice(
          store.findIndex((channel) => channel.metadata?.id === id),
          1,
        );
        return {};
      }),
    },
  };
  const Org = orgWrapper(client, undefined, true);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FetchCacheContext.Provider value={null}>
      <DeploymentModeContext.Provider value="cloud">
        <Org>{children}</Org>
      </DeploymentModeContext.Provider>
    </FetchCacheContext.Provider>
  );
  render(<AgentDetailView org="acme" slug="support-bot" defaultTab="channels" />, { wrapper });
}

/** The Channels tab's own count line. */
async function tabSays(text: string): Promise<void> {
  await within(await screen.findByRole("tabpanel")).findByText(text);
}

/** The channel fact in the profile header, or null when the agent has none. */
function headerChannels(): string | null {
  const facts = within(screen.getByRole("list", { name: "What the agent is made of" })).getAllByRole("listitem");
  return facts.map((fact) => fact.textContent ?? "").find((text) => /channel/.test(text)) ?? null;
}

describe("AgentDetailView: the header's channel count", () => {
  it("follows a chat link created on the Channels tab, and one deleted there", async () => {
    renderView();
    await tabSays("1 channel");
    await waitFor(() => expect(headerChannels()).toBe("1 channel"));

    // Create a second chat link from the tab's Add menu.
    await openMenu(await screen.findByRole("button", { name: /add channel/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Chat link/ }));
    fireEvent.change(await screen.findByLabelText("Name", { selector: "input" }), { target: { value: "Help desk" } });
    fireEvent.click(screen.getByRole("button", { name: "Create chat link", hidden: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Done", hidden: true }));

    await tabSays("2 channels");
    await waitFor(() => expect(headerChannels()).toBe("2 channels"));

    // Delete the first one from its card's menu.
    await openMenu(screen.getAllByRole("button", { name: /^Actions for/ })[0]!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const title = await screen.findByText("Delete chat link?");
    fireEvent.click(within(title.closest("dialog") as HTMLElement).getByRole("button", { name: "Delete", hidden: true }));

    await tabSays("1 channel");
    await waitFor(() => expect(headerChannels()).toBe("1 channel"));
  });
});
