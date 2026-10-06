/**
 * AgentDetailView's Hooks section: which hooks guard an agent's tool calls,
 * and every command they run. Pins: a plugin source names its plugin (a link
 * through `onPluginClick`) and lists the hooks the plugin recorded, read by
 * reference; the inline block reads "Written in this agent"; a plugin the
 * server cannot read says the next run will be refused. Editing: removing a
 * plugin saves the remaining sources with the inline block kept; adding one
 * reads the plugin once and declares the variables its hooks read as
 * required secrets, exactly as the plugin page's "Add to an agent" does; a
 * plugin with no hooks that run is refused before any save; a refused save
 * shows the server's sentence in the section.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { HookFormat, type HookConfig, HookConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { AgentInput } from "@stigmer/sdk";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const GUARD_HOOKS = create(HookConfigSchema, {
  format: HookFormat.CLAUDE_CODE,
  groups: [{ event: "PreToolUse", matcher: "", handlers: [{ command: "python3", args: ["guard.py", "${user_config.API_TOKEN}"] }] }],
});
const INLINE_HOOKS = create(HookConfigSchema, {
  format: HookFormat.CLAUDE_CODE,
  groups: [{ event: "PreToolUse", matcher: "Bash", handlers: [{ command: "./deny-push.sh" }] }],
});

function plugin(slug: string, hooks: HookConfig | undefined): Plugin {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `plg_${slug}`, org: ACME_ID, slug, name: slug === "guard" ? "Guard" : slug }),
    status: create(PluginStatusSchema, hooks === undefined ? {} : { hooks }),
  });
}

function agentWith(spec: MessageInitShape<typeof AgentSpecSchema>): Agent {
  const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, spec);
  return agent;
}

const pluginSource = (slug: string) => ({ source: { case: "plugin" as const, value: { org: ACME_ID, slug } } });
const inlineSource = { source: { case: "inline" as const, value: INLINE_HOOKS } };

function renderView(
  agent: Agent,
  plugins: Record<string, Plugin>,
  props: { editable?: boolean; refuseUpdate?: boolean } = {},
) {
  const update = vi.fn(async (input: AgentInput) => {
    if (props.refuseUpdate) throw new ConnectError("plugin 'acme/guard' is already listed in hooks", Code.InvalidArgument);
    void input;
    return agent;
  });
  const getPlugin = vi.fn(async (ref: { org: string; slug: string }) => {
    const found = plugins[ref.slug];
    if (found === undefined) throw new ConnectError("plugin not found", Code.NotFound);
    return found;
  });
  const onPluginClick = vi.fn();
  render(<AgentDetailView org="acme" slug="support-bot" editable={props.editable} onPluginClick={onPluginClick} />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), update },
        plugin: { getByReference: getPlugin },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
      },
      undefined,
      true,
    ),
  });
  return { update, getPlugin, onPluginClick };
}

describe("AgentDetailView hooks", () => {
  it("lists each source: the plugin by name with its commands, and the hooks written in the agent", async () => {
    const { onPluginClick } = renderView(agentWith({ instructions: "Answer tickets.", hooks: [pluginSource("guard"), inlineSource] }), {
      guard: plugin("guard", GUARD_HOOKS),
    });

    const sources = await screen.findByRole("list", { name: "Hook sources" });
    await waitFor(() => expect(within(sources).getByText("python3 guard.py ${user_config.API_TOKEN}")).toBeTruthy());
    expect(within(sources).getByText("Written in this agent")).toBeTruthy();
    expect(within(sources).getByText("./deny-push.sh")).toBeTruthy();
    expect(within(sources).getAllByText("Before a tool call")).toHaveLength(2);

    fireEvent.click(within(sources).getByRole("button", { name: "Guard" }));
    expect(onPluginClick).toHaveBeenCalledWith({ org: ACME_ID, slug: "guard" });
  });

  it("says a plugin it cannot read leaves the agent's next run refused", async () => {
    renderView(agentWith({ instructions: "Answer tickets.", hooks: [pluginSource("gone")] }), {});

    expect(await screen.findByText(/This plugin could not be read; the agent's next run will be refused/)).toBeTruthy();
  });

  it("shows no Hooks section for a read-only agent with none", async () => {
    renderView(agentWith({ instructions: "Answer tickets." }), {});

    expect(await screen.findByText("Answer tickets.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Hook sources" })).toBeNull();
    expect(screen.queryByText("Hooks")).toBeNull();
  });

  it("removes a plugin and keeps the hooks written in the agent", async () => {
    const { update } = renderView(
      agentWith({ instructions: "Answer tickets.", hooks: [inlineSource, pluginSource("guard")], env: { API_TOKEN: { isSecret: true } } }),
      { guard: plugin("guard", GUARD_HOOKS) },
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit hooks" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove guard" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];
    expect(input.hooks).toHaveLength(1);
    expect(input.hooks?.[0]?.inline?.groups?.[0]?.handlers?.[0]?.command).toBe("./deny-push.sh");
    expect(input.env?.["API_TOKEN"]).toMatchObject({ isSecret: true });
  });

  it("adds a plugin typed in, reading it once and declaring the variables its hooks read", async () => {
    const { update, getPlugin } = renderView(
      agentWith({ instructions: "Answer tickets.", hooks: [inlineSource] }),
      { guard: plugin("guard", GUARD_HOOKS) },
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit hooks" }));
    fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
    const slug = screen.getByPlaceholderText("slug");
    fireEvent.change(slug, { target: { value: "guard" } });
    fireEvent.keyDown(slug, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(getPlugin).toHaveBeenCalledWith({ org: ACME_ID, slug: "guard" });
    const input = update.mock.calls[0]![0];
    expect(input.hooks?.map((source) => source.plugin?.slug ?? "inline")).toEqual(["inline", "guard"]);
    expect(input.hooks?.[1]?.plugin).toEqual({ org: ACME_ID, slug: "guard" });
    expect(input.env?.["API_TOKEN"]).toEqual({ isSecret: true });
  });

  it("refuses a plugin with no hooks that run before any save", async () => {
    const { update } = renderView(agentWith({ instructions: "Answer tickets." }), { tools: plugin("tools", undefined) }, { editable: true });

    fireEvent.click(await screen.findByRole("button", { name: "Edit hooks" }));
    fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
    const slug = screen.getByPlaceholderText("slug");
    fireEvent.change(slug, { target: { value: "tools" } });
    fireEvent.keyDown(slug, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("plugin 'tools' has no hooks that run on Stigmer")).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it("shows the server's refusal in the section", async () => {
    renderView(
      agentWith({ instructions: "Answer tickets.", hooks: [pluginSource("guard")] }),
      { guard: plugin("guard", GUARD_HOOKS), extra: plugin("extra", GUARD_HOOKS) },
      { editable: true, refuseUpdate: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit hooks" }));
    fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
    const slug = screen.getByPlaceholderText("slug");
    fireEvent.change(slug, { target: { value: "extra" } });
    fireEvent.keyDown(slug, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/already listed in hooks/)).toBeTruthy();
  });
});
