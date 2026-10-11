/**
 * AgentDetailView lists the saved agents an agent hands work to, each at the
 * version the server pinned when the agent was saved, and tells the reader
 * when a listed agent has moved on since. Every edit sends the whole list
 * back, so the tests pin what each save carries: an added agent goes without
 * a version (the server pins its latest), an update sends only that one
 * reference without its version and every other reference with its pin, and
 * a removal keeps the others' pins. Dropping a pin on any of these saves would
 * silently move a subagent to whatever its latest version is. The picker
 * never offers the agent itself or an agent already listed, both of which the
 * server refuses. The search hook is stubbed; each listed agent is read by
 * its slug from the stubbed client.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInput } from "@stigmer/sdk";
import { samples } from "../../test/samples";
import { ACME_ID, GLOBEX_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

const SEARCH_RESULTS = [
  { id: "agt_self", org: ACME_ID, slug: "pr-bot", name: "PR Bot", description: "" },
  { id: "agt_notes", org: ACME_ID, slug: "release-notes", name: "Release Notes", description: "" },
  { id: "agt_triage", org: ACME_ID, slug: "triager", name: "Triager", description: "" },
];

vi.mock("../useAgentSearch.js", () => ({
  useAgentSearch: () => ({
    results: SEARCH_RESULTS,
    isLoading: false,
    error: null,
    query: "",
    setQuery: () => {},
  }),
}));

import { AgentDetailView } from "../AgentDetailView";

const PIN_NOTES = "a".repeat(64);
const HEAD_NOTES = "b".repeat(64);
const PIN_CHANGELOG = "c".repeat(64);

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
afterEach(cleanup);
beforeEach(() => localStorage.clear());

function listed(slug: string, head: string, org = ACME_ID): Agent {
  const agent = samples.agent({ name: slug, slug, org });
  agent.status = create(AgentStatusSchema, { versionHash: head });
  return agent;
}

function parentWith(spec: MessageInitShape<typeof AgentSpecSchema>): Agent {
  const agent = samples.agent({ name: "PR Bot", slug: "pr-bot", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, { instructions: "Review pull requests.", ...spec });
  return agent;
}

function renderView(
  parent: Agent,
  others: readonly Agent[],
  props: { editable?: boolean; defaultTab?: string } = {},
) {
  const update = vi.fn(async (input: AgentInput) => {
    void input;
    return parent;
  });
  const onAgentClick = vi.fn();
  const getByReference = vi.fn(async (ref: { org: string; slug: string }) => {
    if (ref.slug === parent.metadata?.slug) return parent;
    // An agent the reader cannot see reads as not found.
    return others.find((a) => a.metadata?.slug === ref.slug) ?? null;
  });
  render(
    <AgentDetailView
      org="acme"
      slug="pr-bot"
      editable={props.editable}
      defaultTab={props.defaultTab}
      onAgentClick={onAgentClick}
    />,
    {
      wrapper: orgWrapper(
        {
          agent: { getByReference, update },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
        },
        undefined,
        true,
      ),
    },
  );
  return { update, onAgentClick };
}

describe("AgentDetailView subagents", () => {
  it("shows each listed agent with its pinned version, and no notice when the pin is the latest", async () => {
    renderView(
      parentWith({ subagents: [{ org: ACME_ID, slug: "release-notes", version: PIN_NOTES }] }),
      [listed("release-notes", PIN_NOTES)],
    );

    const list = await screen.findByRole("list", { name: "Subagents" });
    expect(within(list).getByText("release-notes")).toBeTruthy();
    expect(within(list).getByText(PIN_NOTES.slice(0, 8))).toBeTruthy();
    // The listed agent is read, and its head is the pin: nothing to update.
    await waitFor(() => expect(within(list).queryByText("This agent was not found, or you cannot see it.")).toBeNull());
    expect(within(list).queryByText("A newer version exists")).toBeNull();
  });

  it("says a newer version exists when the listed agent's head differs from the pin", async () => {
    renderView(
      parentWith({ subagents: [{ org: ACME_ID, slug: "release-notes", version: PIN_NOTES }] }),
      [listed("release-notes", HEAD_NOTES)],
    );

    expect(await screen.findByText("A newer version exists")).toBeTruthy();
    // A read-only page says so but offers no update.
    expect(screen.queryByRole("button", { name: /^Update/ })).toBeNull();
  });

  it("updates one pin: that reference goes without a version, every other keeps its own", async () => {
    const { update } = renderView(
      parentWith({
        subagents: [
          { org: ACME_ID, slug: "changelog", version: PIN_CHANGELOG },
          { org: ACME_ID, slug: "release-notes", version: PIN_NOTES },
        ],
      }),
      [listed("changelog", "d".repeat(64)), listed("release-notes", HEAD_NOTES)],
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Update release-notes to its latest version" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0].subagents).toEqual([
      { org: ACME_ID, slug: "changelog", version: PIN_CHANGELOG },
      { org: ACME_ID, slug: "release-notes", version: "" },
    ]);
    // The save is the whole agent: the rest of the spec rides along.
    expect(update.mock.calls[0][0].instructions).toBe("Review pull requests.");
  });

  it("adds a picked agent without a version, keeps the listed pins, and never offers itself or a listed agent", async () => {
    const { update } = renderView(
      parentWith({ subagents: [{ org: ACME_ID, slug: "release-notes", version: PIN_NOTES }] }),
      [listed("release-notes", PIN_NOTES), listed("triager", "e".repeat(64))],
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit subagents" }));
    fireEvent.click(screen.getByRole("button", { name: "Add subagent" }));

    const picker = screen.getByRole("listbox", { name: "Agents" });
    expect(within(picker).queryByRole("option", { name: /PR Bot/ })).toBeNull();
    expect(within(picker).queryByRole("option", { name: /Release Notes/ })).toBeNull();
    fireEvent.click(within(picker).getByRole("option", { name: /Triager/ }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0].subagents).toEqual([
      { org: ACME_ID, slug: "release-notes", version: PIN_NOTES },
      { org: ACME_ID, slug: "triager" },
    ]);
  });

  it("removes one subagent and keeps the others' pins", async () => {
    const { update } = renderView(
      parentWith({
        subagents: [
          { org: ACME_ID, slug: "changelog", version: PIN_CHANGELOG },
          { org: ACME_ID, slug: "release-notes", version: PIN_NOTES },
        ],
      }),
      [listed("changelog", PIN_CHANGELOG), listed("release-notes", PIN_NOTES)],
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit subagents" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove release-notes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0].subagents).toEqual([
      { org: ACME_ID, slug: "changelog", version: PIN_CHANGELOG },
    ]);
  });

  it("keeps every pin when another field is saved", async () => {
    const { update } = renderView(
      parentWith({ subagents: [{ org: ACME_ID, slug: "release-notes", version: PIN_NOTES }] }),
      [listed("release-notes", HEAD_NOTES)],
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0].subagents).toEqual([
      { org: ACME_ID, slug: "release-notes", version: PIN_NOTES },
    ]);
  });

  it("says when a listed agent cannot be read", async () => {
    renderView(
      parentWith({ subagents: [{ org: ACME_ID, slug: "gone", version: PIN_NOTES }] }),
      [],
    );

    expect(await screen.findByText("This agent was not found, or you cannot see it.")).toBeTruthy();
  });

  it("labels another org's subagent by its slug and hands navigation the stored org id", async () => {
    const { onAgentClick } = renderView(
      parentWith({ subagents: [{ org: GLOBEX_ID, slug: "release-notes", version: PIN_NOTES }] }),
      [listed("release-notes", PIN_NOTES, GLOBEX_ID)],
    );

    fireEvent.click(await screen.findByText("globex/release-notes"));
    expect(onAgentClick).toHaveBeenCalledWith({ org: GLOBEX_ID, slug: "release-notes" });
  });

  it("links a subagent from the dependency tree", async () => {
    const { onAgentClick } = renderView(
      parentWith({ subagents: [{ org: ACME_ID, slug: "release-notes", version: PIN_NOTES }] }),
      [listed("release-notes", PIN_NOTES)],
      { defaultTab: "dependencies" },
    );

    const tree = await screen.findByRole("tree");
    fireEvent.click(within(tree).getByRole("button", { name: /Subagent.*release-notes/ }));
    expect(onAgentClick).toHaveBeenCalledWith({ org: ACME_ID, slug: "release-notes" });
  });
});
