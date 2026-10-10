/**
 * The plugin page's Hooks section, against an in-memory Connect backend.
 * Pins: the hooks a plugin recorded are listed with every command; the
 * install warnings that name hooks Stigmer does not run are listed under
 * "Not run on Stigmer" and leave "Install warnings", so no sentence prints
 * twice; a plugin whose every hook was left out (a `hooks/` folder no vendor
 * manifest reads, for one) says none of its hooks run; a plugin with
 * neither hooks nor hook warnings shows no Hooks section.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { HookConfigSchema, HookFormat, type HookConfig } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { PluginStatusSchema, PluginWarningSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context.js";
import { PluginDetailView } from "../PluginDetailView.js";

afterEach(cleanup);

const ORG = "acme";

const HOOKIFY = create(HookConfigSchema, {
  format: HookFormat.CLAUDE_CODE,
  groups: [
    { event: "PreToolUse", handlers: [{ command: "python3", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py"], timeoutSeconds: 10 }] },
    { event: "PostToolUse", handlers: [{ command: "python3", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse.py"] }] },
  ],
});

const STOP_NOT_RUN = create(PluginWarningSchema, {
  kind: "hook-event-not-run",
  message: "hooks in 'hooks/hooks.json' on 'Stop' are not run on Stigmer, which reads hooks on tool calls only",
  path: "hooks/hooks.json",
});
const FOLDER_NOT_READ = create(PluginWarningSchema, {
  kind: "hooks-not-read",
  message: "hooks/ is not read: Stigmer reads hooks in the Claude Code, Codex and Cursor layouts",
  path: "hooks/",
});
const OTHER = create(PluginWarningSchema, {
  kind: "skill-description-missing",
  message: "skill 'notes' has no description",
  path: "skills/notes/SKILL.md",
});

function renderView(options: {
  readonly hooks?: HookConfig;
  readonly warnings?: readonly (typeof OTHER)[];
}) {
  const transport = createRouterTransport(({ service }) => {
    service(PluginQueryController, {
      getByReference: () =>
        create(PluginSchema, {
          metadata: create(ApiResourceMetadataSchema, { id: "plg_1", org: ORG, slug: "hookify", name: "hookify" }),
          status: create(PluginStatusSchema, { hooks: options.hooks, warnings: [...(options.warnings ?? [])] }),
        }),
    });
  });
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  return render(<PluginDetailView org={ORG} slug="hookify" />, { wrapper });
}

describe("PluginDetailView: a plugin's hooks", () => {
  it("lists every command its hooks run, and the hooks Stigmer does not run apart from the other warnings", async () => {
    renderView({ hooks: HOOKIFY, warnings: [STOP_NOT_RUN, OTHER] });

    const hooks = await screen.findByRole("list", { name: "Hooks (Claude Code format)" });
    expect(within(hooks).getByText("python3 ${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py")).toBeTruthy();
    expect(within(hooks).getByText("python3 ${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse.py")).toBeTruthy();

    const notRun = screen.getByRole("list", { name: "Hooks not run on Stigmer" });
    expect(within(notRun).getByText(/on 'Stop' are not run on Stigmer/)).toBeTruthy();
    expect(screen.getAllByText(/on 'Stop' are not run on Stigmer/)).toHaveLength(1);
    expect(screen.getByText("Install warnings")).toBeTruthy();
    expect(screen.getByText("skill 'notes' has no description")).toBeTruthy();
  });

  it("says none of the hooks run when every one was left out, a hooks/ folder no manifest reads included", async () => {
    renderView({ warnings: [FOLDER_NOT_READ] });

    expect(await screen.findByText("None of this plugin's hooks run on Stigmer.")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Hooks not run on Stigmer" })).getByText(/hooks\/ is not read/)).toBeTruthy();
    expect(screen.queryByText("Install warnings")).toBeNull();
  });

  it("shows no Hooks section for a plugin with no hooks and no hook warnings", async () => {
    renderView({ warnings: [OTHER] });

    expect(await screen.findByText("Install warnings")).toBeTruthy();
    expect(screen.queryByText("Hooks")).toBeNull();
  });
});
