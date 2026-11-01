/**
 * AgentDetailView's YAML actions (`yamlActions`): Edit YAML, Export YAML,
 * Export JSON and Download YAML read the one agent the view holds, so the
 * page never shows one agent while the editor holds another
 * (stigmer/stigmer#2813). Pinned over a client whose reads answer the agent
 * as last stored:
 * - off by default, so an embedding host's menu is unchanged; on, the four
 *   sit after the host's actions and before its first destructive one, with
 *   Manage access last, as the agent pages' menu has always read;
 * - Edit YAML only while the agent is editable: not for a read-only host,
 *   nor for an agent a plugin installed, whose exports stay;
 * - after an inline save, Edit YAML opens on the saved text, and the
 *   exports carry it;
 * - an apply shows on the view without a reload, and an apply that renamed
 *   the agent reaches the host as the new slug on `onResourceLoad`, never
 *   through `onRenamed` (the slug field's callback).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { clone, create } from "@bufbuild/protobuf";
import { AgentSchema, type Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { ManifestDocument } from "@stigmer/client";
import { samples } from "@stigmer/react-core/test";
import { AgentDetailView, type AgentDetailViewProps } from "../AgentDetailView";
import { PLUGIN_LABEL } from "../../plugin/useManagingPlugin";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

const downloads = vi.hoisted(() => [] as Array<{ name: string; content: string }>);

// CodeMirror stays out of the test environment; a textarea shows the text the editor holds.
vi.mock("../../manifest/YamlEditor", () => ({
  YamlEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="YAML" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("../../feedback/toast", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../internal/download", () => ({
  downloadTextFile: (content: string, name: string) => downloads.push({ name, content }),
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

const clipboard = vi.fn(async (text: string) => {
  void text;
});

beforeEach(() => {
  localStorage.clear();
  downloads.length = 0;
  clipboard.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: clipboard }, configurable: true });
});
afterEach(cleanup);

const YAML_ITEMS = ["Edit YAML", "Export YAML", "Export JSON", "Download YAML"];

/** The host's own menu, as the agent pages pass it. */
const HOST_ACTIONS: AgentDetailViewProps["actions"] = [
  { id: "copy-id", label: "Copy ID", group: "clipboard", onAction: () => undefined },
  { id: "copy-slug", label: "Copy slug", group: "clipboard", onAction: () => undefined },
  { id: "delete", label: "Delete", variant: "destructive", group: "danger", onAction: () => undefined },
];

function storedAgent(): Agent {
  const agent = samples.agent({ name: "Analyst", org: ACME_ID });
  agent.metadata!.slug = "analyst";
  agent.spec!.instructions = "Answer tickets.";
  return agent;
}

/**
 * Renders the view over a client that keeps one stored agent: an inline
 * save and an apply both replace it, and every read answers it, as the
 * server answers an old slug with the renamed agent.
 */
function renderView(
  props: Partial<AgentDetailViewProps> = {},
  opts: { agent?: Agent; canViewAccess?: boolean; plugin?: boolean; renameTo?: string } = {},
) {
  const store = { agent: opts.agent ?? storedAgent() };
  const update = vi.fn(async (resource: Agent) => {
    store.agent = clone(AgentSchema, resource);
    return clone(AgentSchema, store.agent);
  });
  const apply = vi.fn(async (document: ManifestDocument) => {
    const applied = clone(AgentSchema, document.message as Agent);
    if (opts.renameTo) applied.metadata!.slug = opts.renameTo;
    store.agent = applied;
    return {
      yamlKind: "Agent",
      displayName: "Agent",
      name: applied.metadata!.name,
      slug: applied.metadata!.slug,
      org: applied.metadata!.org,
      id: applied.metadata!.id,
      message: applied,
      ...(opts.renameTo && { renamedFrom: "analyst" }),
    };
  });
  const onResourceLoad = vi.fn();
  const onRenamed = vi.fn();
  render(
    <AgentDetailView
      org="acme"
      slug="analyst"
      editable
      actions={HOST_ACTIONS}
      onResourceLoad={onResourceLoad}
      onRenamed={onRenamed}
      {...props}
    />,
    {
      wrapper: orgWrapper(
        {
          agent: { getByReference: vi.fn(async () => clone(AgentSchema, store.agent)), update },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          environment: { list: vi.fn(async () => ({ entries: [], nextPageToken: "" })) },
          // The person may edit the agent (Edit YAML and the inline edits are offered only on that yes);
          // every other relation answers as `canViewAccess` says.
          grant: {
            checkMyPermission: vi.fn(async (input: { relation: string }) => ({
              isAuthorized: input.relation === "can_edit" || (opts.canViewAccess ?? false),
            })),
          },
          plugin: {
            get: vi.fn(async () =>
              opts.plugin ? create(PluginSchema, { metadata: { id: "plg_1", org: ACME_ID, slug: "toolkit", name: "Toolkit" } }) : null,
            ),
          },
          manifest: {
            resolveTarget: vi.fn(async () => ({ action: "update", slug: "analyst", slugKept: false, visibilityKept: false })),
            apply,
          },
        },
        undefined,
        true,
      ),
    },
  );
  return { store, update, apply, onResourceLoad, onRenamed };
}

async function menuLabels(): Promise<string[]> {
  await openMenu(await screen.findByRole("button", { name: "More actions" }));
  return screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
}

async function chooseFromMenu(label: string): Promise<void> {
  await openMenu(await screen.findByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

async function saveInstructions(from: string, to: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: from }));
  fireEvent.change(screen.getByPlaceholderText("Add instructions for the agent"), { target: { value: to } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: to });
}

async function openEditor(): Promise<HTMLTextAreaElement> {
  await chooseFromMenu("Edit YAML");
  return (await screen.findByRole("textbox", { name: "YAML" })) as HTMLTextAreaElement;
}

/** Opens Edit YAML, edits the text it opened on, and applies it. */
async function applyYaml(edit: (opened: string) => string): Promise<void> {
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: edit(editor.value) } });
  const applyButton = within(screen.getByRole("dialog", { name: "Edit YAML" })).getByRole("button", {
    name: "Apply changes",
  }) as HTMLButtonElement;
  await waitFor(() => expect(applyButton.disabled).toBe(false));
  fireEvent.click(applyButton);
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "YAML" })).toBeNull());
}

describe("AgentDetailView YAML actions", () => {
  it("offers none of them unless the host opts in", async () => {
    renderView();

    expect(await menuLabels()).toEqual(["Copy ID", "Copy slug", "Delete"]);
  });

  it("places them after the host's actions and before its destructive one, with Manage access last", async () => {
    renderView({ yamlActions: true }, { canViewAccess: true });
    // Manage access joins the menu once the permission check answers, as the badge does.
    await screen.findByRole("button", { name: /visibility — manage access/ });

    expect(await menuLabels()).toEqual(["Copy ID", "Copy slug", ...YAML_ITEMS, "Delete", "Manage access"]);
  });

  it("follows the host's own order when it passes no destructive action", async () => {
    renderView({ yamlActions: true, actions: [HOST_ACTIONS![0]!] });

    expect(await menuLabels()).toEqual(["Copy ID", ...YAML_ITEMS]);
  });

  it("offers no Edit YAML to a host that does not edit, only the exports", async () => {
    renderView({ yamlActions: true, editable: false });

    expect(await menuLabels()).toEqual(["Copy ID", "Copy slug", "Export YAML", "Export JSON", "Download YAML", "Delete"]);
  });

  it("offers no Edit YAML for an agent a plugin installed, only the exports", async () => {
    const agent = storedAgent();
    agent.metadata!.labels = { [PLUGIN_LABEL]: "plg_1" };
    renderView({ yamlActions: true }, { agent, plugin: true });

    await screen.findByText(/Toolkit/);
    expect(await menuLabels()).toEqual(["Copy ID", "Copy slug", "Export YAML", "Export JSON", "Download YAML", "Delete"]);
  });

  it("opens Edit YAML on the instructions an inline save just stored", async () => {
    renderView({ yamlActions: true });

    await saveInstructions("Answer tickets.", "Answer refunds.");
    const editor = await openEditor();

    expect(editor.value).toContain("instructions: Answer refunds.");
    expect(editor.value).not.toContain("Answer tickets.");
  });

  it("exports the agent as stored after an inline save", async () => {
    renderView({ yamlActions: true });
    await saveInstructions("Answer tickets.", "Answer refunds.");

    await chooseFromMenu("Export YAML");
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    expect(clipboard.mock.calls[0]![0]).toContain("instructions: Answer refunds.");

    await chooseFromMenu("Export JSON");
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(2));
    expect(JSON.parse(clipboard.mock.calls[1]![0]).spec.instructions).toBe("Answer refunds.");

    await chooseFromMenu("Download YAML");
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.content).toContain("instructions: Answer refunds.");
  });

  it("shows what an apply changed without a reload", async () => {
    const { apply } = renderView({ yamlActions: true });

    await applyYaml((opened) => opened.replace("Answer tickets.", "Answer billing questions."));

    expect(apply).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Answer billing questions." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Answer tickets." })).toBeNull();
  });

  it("reports the slug an apply renamed the agent to on onResourceLoad, not onRenamed", async () => {
    const { onResourceLoad, onRenamed } = renderView({ yamlActions: true }, { renameTo: "analyst-2" });

    await waitFor(() =>
      expect(onResourceLoad).toHaveBeenLastCalledWith({ name: "Analyst", id: expect.any(String), slug: "analyst" }),
    );
    await applyYaml((opened) => opened.replace("slug: analyst", "slug: analyst-2"));

    await waitFor(() =>
      expect(onResourceLoad).toHaveBeenLastCalledWith({ name: "Analyst", id: expect.any(String), slug: "analyst-2" }),
    );
    expect(onRenamed).not.toHaveBeenCalled();
  });
});
