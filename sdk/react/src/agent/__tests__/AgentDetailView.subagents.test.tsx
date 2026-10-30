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
 * Closing the picker with Cancel saves nothing, and a section given no save
 * handler adds nothing when an agent is picked.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { samples } from "@stigmer/react-core/test";
import { sentRefs, sentUpdate } from "../../internal/__tests__/sent-update";
import { ACME_ID, GLOBEX_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

const SEARCH_RESULTS = [
  { id: "agt_self", org: ACME_ID, slug: "pr-bot", name: "PR Bot", description: "" },
  { id: "agt_notes", org: ACME_ID, slug: "release-notes", name: "Release Notes", description: "" },
  { id: "agt_triage", org: ACME_ID, slug: "triager", name: "Triager", description: "" },
];

vi.mock("@stigmer/react-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-core")>()),
  useAgentSearch: () => ({
    results: SEARCH_RESULTS,
    isLoading: false,
    error: null,
    query: "",
    setQuery: () => {},
  }),
}));

import { AgentDetailView } from "../AgentDetailView";
import { AgentSubagentsSection } from "../AgentSubagentsSection";

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
  const update = vi.fn(async (resource: Agent, paths: string[]) => {
    void resource;
    void paths;
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
          grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
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
    expect(sentRefs(sentUpdate<Agent>(update).resource.spec?.subagents)).toEqual([
      { org: ACME_ID, slug: "changelog", version: PIN_CHANGELOG },
      { org: ACME_ID, slug: "release-notes" },
    ]);
    // The save names the subagents alone: the rest of the spec keeps its
    // stored value without being sent back.
    expect(sentUpdate<Agent>(update).paths).toEqual(["spec.subagents"]);
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
    expect(sentRefs(sentUpdate<Agent>(update).resource.spec?.subagents)).toEqual([
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
    expect(sentRefs(sentUpdate<Agent>(update).resource.spec?.subagents)).toEqual([
      { org: ACME_ID, slug: "changelog", version: PIN_CHANGELOG },
    ]);
  });

  it("names only the field it saves, so every pin stays as stored", async () => {
    const { update } = renderView(
      parentWith({ subagents: [{ org: ACME_ID, slug: "release-notes", version: PIN_NOTES }] }),
      [listed("release-notes", HEAD_NOTES)],
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentUpdate<Agent>(update).paths).toEqual(["spec.skill_refs"]);
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

  it("closes the picker on Cancel and saves nothing", async () => {
    const { update } = renderView(
      parentWith({ subagents: [{ org: ACME_ID, slug: "release-notes", version: PIN_NOTES }] }),
      [listed("release-notes", PIN_NOTES)],
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit subagents" }));
    fireEvent.click(screen.getByRole("button", { name: "Add subagent" }));
    expect(screen.getByRole("listbox", { name: "Agents" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("listbox", { name: "Agents" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add subagent" })).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it("adds nothing when an agent is picked and the section has no save handler", async () => {
    render(
      <AgentSubagentsSection refs={[]} agentOrg={ACME_ID} self={null} editable />,
      { wrapper: orgWrapper({}, undefined, true) },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit subagents" }));
    fireEvent.click(screen.getByRole("button", { name: "Add subagent" }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Agents" })).getByRole("option", { name: /Triager/ }));

    // With nothing to save to, the pick changes nothing: the picker stays open
    // and the list stays empty.
    expect(screen.getByRole("listbox", { name: "Agents" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Subagents" })).toBeNull();
  });
});

describe("AgentDetailView sends stored references back by id (stigmer#2172)", () => {
  it("a removal sends the subagents it keeps by their ids, pins kept", async () => {
    const { update } = renderView(
      parentWith({
        subagents: [
          { org: ACME_ID, slug: "changelog", id: "agt_changelog", version: PIN_CHANGELOG },
          { org: ACME_ID, slug: "release-notes", id: "agt_notes", version: PIN_NOTES },
        ],
      }),
      [listed("changelog", PIN_CHANGELOG), listed("release-notes", PIN_NOTES)],
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit subagents" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove release-notes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentRefs(sentUpdate<Agent>(update).resource.spec?.subagents)).toEqual([
      { org: ACME_ID, slug: "", id: "agt_changelog", version: PIN_CHANGELOG },
    ]);
  });

  it("a skills save sends the skills it read by their ids", async () => {
    const { update } = renderView(
      parentWith({ skillRefs: [{ org: ACME_ID, slug: "triage-guide", id: "skl_1" }] }),
      [],
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentRefs(sentUpdate<Agent>(update).resource.spec?.skillRefs)).toEqual([{ org: ACME_ID, slug: "", id: "skl_1" }]);
  });
});

describe("AgentDetailView rename", () => {
  function renderRenamable(allowed: boolean, editable: boolean) {
    const parent = parentWith({});
    const onRenamed = vi.fn();
    const rename = vi.fn(async ({ slug }: { slug: string }) => {
      const renamed = parentWith({});
      renamed.metadata!.slug = slug;
      return renamed;
    });
    render(<AgentDetailView org="acme" slug="pr-bot" editable={editable} onRenamed={onRenamed} />, {
      wrapper: orgWrapper(
        {
          agent: { getByReference: vi.fn(async () => parent), update: vi.fn(), rename },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          grant: {
            checkMyPermission: vi.fn(async (input: { relation: string }) => ({
              isAuthorized: allowed && input.relation === "can_delete",
            })),
          },
        },
        undefined,
        true,
      ),
    });
    return { rename, onRenamed };
  }

  it("offers the slug field on the Overview to whoever may delete the agent, and reports the rename", async () => {
    const { rename, onRenamed } = renderRenamable(true, true);
    const field = await screen.findByLabelText("Slug");
    fireEvent.change(field, { target: { value: "pr-reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(onRenamed).toHaveBeenCalledOnce());
    expect(rename.mock.calls[0]![0]).toMatchObject({ slug: "pr-reviewer" });
    expect(onRenamed.mock.calls[0]![0].metadata.slug).toBe("pr-reviewer");
  });

  it("offers no slug field to a caller who may not delete the agent, nor on a read-only view", async () => {
    renderRenamable(false, true);
    await screen.findByText("Review pull requests.");
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    cleanup();

    renderRenamable(true, false);
    await screen.findByText("Review pull requests.");
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });
});
