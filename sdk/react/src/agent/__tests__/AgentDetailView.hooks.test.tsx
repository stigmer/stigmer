/**
 * AgentDetailView's Hooks and Plugins sections. A plugin's hooks come with
 * the plugin, so the Hooks section shows only the hooks written in the
 * agent ("Written in this agent", every command each runs) and nothing for
 * an agent with none; the Plugins section lists the plugins the agent uses,
 * each a link through `onPluginClick`. Editing the Plugins section saves
 * `spec.plugins` as listed: removing one keeps the rest and every other
 * field (the inline hooks and the env included), adding one appends it,
 * and a refused save shows the server's sentence in the section.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { HookFormat, HookConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { AgentInput } from "@stigmer/sdk";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const INLINE_HOOKS = create(HookConfigSchema, {
  format: HookFormat.CLAUDE_CODE,
  groups: [{ event: "PreToolUse", matcher: "Bash", handlers: [{ command: "./deny-push.sh" }] }],
});

function agentWith(spec: MessageInitShape<typeof AgentSpecSchema>): Agent {
  const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, spec);
  return agent;
}

const inlineSource = { source: { case: "inline" as const, value: INLINE_HOOKS } };

function renderView(agent: Agent, props: { editable?: boolean; refuseUpdate?: boolean } = {}) {
  const update = vi.fn(async (input: AgentInput) => {
    if (props.refuseUpdate) throw new ConnectError("plugin 'acme/extra' is not installed", Code.InvalidArgument);
    void input;
    return agent;
  });
  const onPluginClick = vi.fn();
  render(<AgentDetailView org="acme" slug="support-bot" editable={props.editable} onPluginClick={onPluginClick} />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), update },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
      },
      undefined,
      true,
    ),
  });
  return { update, onPluginClick };
}

describe("AgentDetailView hooks", () => {
  it("lists the hooks written in the agent with every command they run", async () => {
    renderView(agentWith({ instructions: "Answer tickets.", hooks: [inlineSource] }));

    const sources = await screen.findByRole("list", { name: "Hook sources" });
    expect(within(sources).getByText("Written in this agent")).toBeTruthy();
    expect(within(sources).getByText("./deny-push.sh")).toBeTruthy();
    expect(within(sources).getByText("Before a tool call")).toBeTruthy();
  });

  it("shows no Hooks section for an agent with none written in it", async () => {
    renderView(agentWith({ instructions: "Answer tickets." }), { editable: true });

    expect(await screen.findByText("Answer tickets.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Hook sources" })).toBeNull();
    expect(screen.queryByText("Hooks")).toBeNull();
  });
});

describe("AgentDetailView plugins", () => {
  it("lists the plugins the agent uses, each a link to its page", async () => {
    const { onPluginClick } = renderView(agentWith({ instructions: "Answer tickets.", plugins: [{ org: ACME_ID, slug: "linear" }] }));

    fireEvent.click(await screen.findByRole("button", { name: /linear/ }));
    expect(onPluginClick).toHaveBeenCalledWith({ org: ACME_ID, slug: "linear" });
  });

  it("removes a plugin and keeps the rest of the spec", async () => {
    const { update } = renderView(
      agentWith({
        instructions: "Answer tickets.",
        hooks: [inlineSource],
        env: { API_TOKEN: { isSecret: true } },
        plugins: [
          { org: ACME_ID, slug: "guard" },
          { org: ACME_ID, slug: "linear" },
        ],
      }),
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove guard" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];
    expect(input.plugins?.map((ref) => ref.slug)).toEqual(["linear"]);
    expect(input.hooks?.[0]?.inline?.groups?.[0]?.handlers?.[0]?.command).toBe("./deny-push.sh");
    expect(input.env?.["API_TOKEN"]).toMatchObject({ isSecret: true });
  });

  it("adds a plugin typed in, after the ones listed", async () => {
    const { update } = renderView(
      agentWith({ instructions: "Answer tickets.", plugins: [{ org: ACME_ID, slug: "guard" }] }),
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
    const slug = screen.getByPlaceholderText("slug");
    fireEvent.change(slug, { target: { value: "linear" } });
    fireEvent.keyDown(slug, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0].plugins).toEqual([
      { org: ACME_ID, slug: "guard" },
      { org: ACME_ID, slug: "linear" },
    ]);
  });

  it("shows the server's refusal in the section", async () => {
    renderView(agentWith({ instructions: "Answer tickets." }), { editable: true, refuseUpdate: true });

    fireEvent.click(await screen.findByRole("button", { name: "Edit plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
    const slug = screen.getByPlaceholderText("slug");
    fireEvent.change(slug, { target: { value: "extra" } });
    fireEvent.keyDown(slug, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/is not installed/)).toBeTruthy();
  });
});
