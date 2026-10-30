/**
 * AgentDetailView's "MCP servers" section: the servers an agent writes
 * itself. Pointing an organization's runs at a new address is its admins'
 * act, so editing follows the server's own self-check for
 * `can_create_plugin` on the organization, failing closed. Pinned:
 *
 * - every reader sees each server's name, URL and headers, a header value
 *   that only names keys shown and any other read as "set", and the
 *   viewer's login at the server's address, a sign-in offered as optional;
 * - an admin adds, changes and removes a server, each one save naming
 *   `spec.mcp_servers` alone and sending the other servers as stored;
 * - the form says what the console can see is wrong before any save, and
 *   a refused save shows the server's words under the section; Cancel
 *   closes a form and saves nothing;
 * - a member who may edit the agent sees the servers with no pencil and is
 *   told only admins change them; a viewer is told nothing;
 * - another section's save never names `spec.mcp_servers`;
 * - the Dependencies tab draws each server, for an agent with only servers.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { samples } from "@stigmer/react-core/test";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";
import { AgentDetailView } from "../AgentDetailView";

const ZENDESK_URL = "https://acme-co.zendesk.com/mcp";
const LINEAR_URL = "https://mcp.linear.app/mcp";

const ZENDESK = { name: "zendesk", url: ZENDESK_URL, headers: { "X-Api-Key": "${ZENDESK_KEY}" } };
const LINEAR = { name: "linear", url: LINEAR_URL, headers: { Authorization: "Bearer lin_api_123" } };

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

function agentWith(spec: MessageInitShape<typeof AgentSpecSchema>): Agent {
  const agent = samples.agent({ name: "Support", slug: "support", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, { instructions: "Answer tickets.", ...spec });
  return agent;
}

interface Viewer {
  /** Whether the server's self-check grants `can_create_plugin` on the organization. */
  readonly admin: boolean;
  readonly editable?: boolean;
  readonly defaultTab?: string;
  /** A refusal the update answers with. */
  readonly refuse?: Error;
}

function renderView(agent: Agent, viewer: Viewer) {
  const update = vi.fn(async (resource: Agent, paths: string[]) => {
    void resource;
    void paths;
    if (viewer.refuse) throw viewer.refuse;
    return agent;
  });
  const checkMyPermission = vi.fn(async (input: { relation: string; resource?: { kind: string; id: string } }) => ({
    isAuthorized: input.relation === "can_create_plugin" && input.resource?.kind === "organization" && viewer.admin,
  }));
  render(<AgentDetailView org="acme" slug="support" editable={viewer.editable} defaultTab={viewer.defaultTab} />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), update },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        grant: { checkMyPermission },
        vault: { getMine: vi.fn(async () => ({ metadata: { org: ACME_ID, slug: "mine" }, spec: { connections: {} } })) },
      },
      undefined,
      true,
    ),
  });
  return { update, checkMyPermission };
}

/** The servers a captured save sent, as plain values. */
function sentServers(update: Parameters<typeof sentUpdate>[0]) {
  return (sentUpdate<Agent>(update).resource.spec?.mcpServers ?? []).map((server) => ({
    name: server.name,
    url: server.url,
    headers: { ...server.headers },
  }));
}

async function section() {
  const heading = await screen.findByRole("heading", { name: "MCP servers" });
  return heading.closest("section") as HTMLElement;
}

describe("AgentDetailView MCP servers", () => {
  it("shows each server's name, URL and headers, and offers a sign-in only as optional", async () => {
    renderView(agentWith({ mcpServers: [ZENDESK, LINEAR] }), { admin: false });

    const list = await screen.findByRole("list", { name: "MCP servers" });
    expect(within(list).getByText("zendesk")).toBeTruthy();
    expect(within(list).getByText(ZENDESK_URL)).toBeTruthy();
    // A value that only names a key is shown; a pasted token reads "set".
    expect(within(list).getByText("${ZENDESK_KEY}")).toBeTruthy();
    expect(within(list).getByText("set")).toBeTruthy();
    expect(within(list).queryByText("Bearer lin_api_123")).toBeNull();
    // The bare server may sign in; the one that sends its own Authorization does not.
    expect(await within(list).findByRole("button", { name: "Sign in to zendesk" })).toBeTruthy();
    expect(within(list).queryByRole("button", { name: "Sign in to linear" })).toBeNull();
  });

  it("lets an admin add a server, saving the list with spec.mcp_servers alone", async () => {
    const { update } = renderView(agentWith({ mcpServers: [ZENDESK] }), { admin: true, editable: true });

    fireEvent.click(await screen.findByRole("button", { name: "Edit mcp servers" }));
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    const form = screen.getByRole("group", { name: "New MCP server" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "linear" } });
    fireEvent.change(within(form).getByLabelText("URL"), { target: { value: ` ${LINEAR_URL} ` } });
    fireEvent.click(within(form).getByRole("button", { name: "Add header" }));
    fireEvent.change(within(form).getByLabelText("Header name"), { target: { value: "Authorization" } });
    fireEvent.change(within(form).getByLabelText("Header value"), { target: { value: "Bearer ${LINEAR_TOKEN}" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentUpdate<Agent>(update).paths).toEqual(["spec.mcp_servers"]);
    expect(sentServers(update)).toEqual([ZENDESK, { name: "linear", url: LINEAR_URL, headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } }]);
    await waitFor(() => expect(screen.queryByRole("group", { name: "New MCP server" })).toBeNull());
  });

  it("lets an admin change one server, the others sent as stored", async () => {
    const { update } = renderView(agentWith({ mcpServers: [ZENDESK, LINEAR] }), { admin: true, editable: true });

    fireEvent.click(await screen.findByRole("button", { name: "Edit mcp servers" }));
    fireEvent.click(screen.getByRole("button", { name: "Change zendesk" }));
    const form = screen.getByRole("group", { name: "Change zendesk" });
    expect((within(form).getByLabelText("Header value") as HTMLInputElement).value).toBe("${ZENDESK_KEY}");
    fireEvent.change(within(form).getByLabelText("URL"), { target: { value: "https://acme-eu.zendesk.com/mcp" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentUpdate<Agent>(update).paths).toEqual(["spec.mcp_servers"]);
    expect(sentServers(update)).toEqual([{ ...ZENDESK, url: "https://acme-eu.zendesk.com/mcp" }, LINEAR]);
  });

  it("lets an admin remove one server, the others sent as stored", async () => {
    const { update } = renderView(agentWith({ mcpServers: [ZENDESK, LINEAR] }), { admin: true, editable: true });

    fireEvent.click(await screen.findByRole("button", { name: "Edit mcp servers" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove zendesk" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentUpdate<Agent>(update).paths).toEqual(["spec.mcp_servers"]);
    expect(sentServers(update)).toEqual([LINEAR]);
  });

  it("closes a form on Cancel and saves nothing", async () => {
    const { update } = renderView(agentWith({ mcpServers: [ZENDESK] }), { admin: true, editable: true });

    fireEvent.click(await screen.findByRole("button", { name: "Edit mcp servers" }));
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    fireEvent.click(within(screen.getByRole("group", { name: "New MCP server" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "New MCP server" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change zendesk" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Change zendesk" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Change zendesk" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add MCP server" })).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it("says what is wrong before saving, and saves nothing", async () => {
    const { update } = renderView(agentWith({ mcpServers: [ZENDESK] }), { admin: true, editable: true });

    fireEvent.click(await screen.findByRole("button", { name: "Edit mcp servers" }));
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    const form = screen.getByRole("group", { name: "New MCP server" });
    const add = within(form).getByRole("button", { name: "Add" });

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "zendesk" } });
    fireEvent.change(within(form).getByLabelText("URL"), { target: { value: LINEAR_URL } });
    fireEvent.click(add);
    expect(within(form).getByRole("alert").textContent).toMatch(/already has a server named zendesk/);

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "stigmer-tools" } });
    fireEvent.click(add);
    expect(within(form).getByRole("alert").textContent).toMatch(/starting with stigmer are the platform's/);

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "linear" } });
    fireEvent.change(within(form).getByLabelText("URL"), { target: { value: "http://linear.example/mcp" } });
    fireEvent.click(add);
    expect(within(form).getByRole("alert").textContent).toMatch(/must be https/);

    fireEvent.change(within(form).getByLabelText("URL"), { target: { value: LINEAR_URL } });
    fireEvent.click(within(form).getByRole("button", { name: "Add header" }));
    fireEvent.click(within(form).getByRole("button", { name: "Add header" }));
    const names = within(form).getAllByLabelText("Header name");
    fireEvent.change(names[0]!, { target: { value: "X-Key" } });
    fireEvent.change(names[1]!, { target: { value: "x-key" } });
    fireEvent.click(add);
    expect(within(form).getByRole("alert").textContent).toMatch(/x-key is named more than once/);

    expect(update).not.toHaveBeenCalled();
  });

  it("shows a refused save under the section and keeps the form open", async () => {
    const refusal = new ConnectError(
      "only an organization's admins may add or change an agent's MCP servers (linear); ask an admin, or use a plugin an admin installed",
      Code.PermissionDenied,
    );
    renderView(agentWith({ mcpServers: [] }), { admin: true, editable: true, refuse: refusal });

    fireEvent.click(await screen.findByRole("button", { name: "Edit mcp servers" }));
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    const form = screen.getByRole("group", { name: "New MCP server" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "linear" } });
    fireEvent.change(within(form).getByLabelText("URL"), { target: { value: LINEAR_URL } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));

    const owner = await section();
    await waitFor(() => expect(within(owner).getByRole("alert").textContent).toMatch(/only an organization's admins/));
    expect(screen.getByRole("group", { name: "New MCP server" })).toBeTruthy();
  });

  it("shows a member the servers with no pencil, and says only admins change them", async () => {
    const { checkMyPermission } = renderView(agentWith({ mcpServers: [ZENDESK] }), { admin: false, editable: true });

    const owner = await section();
    expect(await within(owner).findByText(/Only an organization's admins add or change an agent's MCP servers/)).toBeTruthy();
    expect(within(owner).queryByRole("button", { name: "Edit mcp servers" })).toBeNull();
    expect(within(owner).queryByRole("button", { name: "Change zendesk" })).toBeNull();
    expect(checkMyPermission).toHaveBeenCalledWith(
      expect.objectContaining({ relation: "can_create_plugin", resource: expect.objectContaining({ kind: "organization", id: ACME_ID }) }),
    );
    // The member still edits the rest of the agent.
    expect(screen.getByRole("button", { name: "Edit skills" })).toBeTruthy();
  });

  it("tells a viewer who may not edit the agent nothing about who may", async () => {
    renderView(agentWith({ mcpServers: [ZENDESK] }), { admin: false });

    const owner = await section();
    expect(within(owner).getByText("zendesk")).toBeTruthy();
    expect(within(owner).queryByText(/Only an organization's admins/)).toBeNull();
  });

  it("never names spec.mcp_servers in another section's save", async () => {
    const { update } = renderView(agentWith({ mcpServers: [ZENDESK] }), { admin: true, editable: true });

    fireEvent.click(await screen.findByRole("button", { name: "Edit skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentUpdate<Agent>(update).paths).toEqual(["spec.skill_refs"]);
  });

  it("draws each server in the Dependencies tab, for an agent with only servers", async () => {
    renderView(agentWith({ mcpServers: [ZENDESK] }), { admin: false, defaultTab: "dependencies" });

    const tree = await screen.findByRole("tree");
    expect(within(tree).getByText("MCP server")).toBeTruthy();
    expect(within(tree).getByText("zendesk")).toBeTruthy();
    expect(within(tree).getByText("acme-co.zendesk.com")).toBeTruthy();
  });
});
