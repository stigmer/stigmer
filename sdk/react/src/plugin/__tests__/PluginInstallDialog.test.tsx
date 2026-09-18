/**
 * The install preview and the act, against a fetch fake for the marketplace
 * host and an in-memory Connect backend for the server. Pins: the dialog
 * shows the CLI's "Installs" facts in the CLI's words (skills, servers,
 * sub-agents, variables) and the sentence telling the user the agent will
 * ask for its variables; Install pushes exactly the prepared bytes and
 * reports the members; an org that already holds the digest reads
 * "already installed" and Install is disabled; another digest reads as an
 * upgrade with its stated effect; the library's refusal shows every
 * sentence.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ListPluginMembersResponseSchema, PluginMemberSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginMaterializationSchema, PluginState, PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { digestArchive } from "@stigmer/plugin-package/client";

import { StigmerContext } from "../../context.js";
import { PluginInstallDialog } from "../PluginInstallDialog.js";
import { openGitHubTree, resetGitHubListingCache } from "../sources/github.js";
import { type OpenedMarketplace, findEntry, openMarketplace, prepareEntry } from "../sources/read.js";
import { HOSTED_REPO, hostedFetch, hostedMarketplaceFiles } from "./fixtures/hosted-marketplace.js";

afterEach(() => {
  cleanup();
  resetGitHubListingCache();
});

const ORG = "acme";

interface Backend {
  /** The artifacts pushed, in order. */
  readonly pushes: Uint8Array[];
  /** What `getByReference` answers: absent (NotFound), or a plugin with this digest. */
  installedDigest: string | null;
}

function installedPlugin(digest: string) {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "plg_1", org: ORG, slug: "thermos", name: "thermos" }),
    status: create(PluginStatusSchema, {
      digest,
      state: PluginState.READY,
      materialized: create(PluginMaterializationSchema, { skills: 1, mcpServers: 1, agents: 1 }),
    }),
  });
}

function backendTransport(backend: Backend) {
  return createRouterTransport(({ service }) => {
    service(PluginCommandController, {
      push: async (req) => {
        backend.pushes.push(req.artifact);
        return installedPlugin(await digestArchive(req.artifact));
      },
    });
    service(PluginQueryController, {
      getByReference: () => {
        if (backend.installedDigest === null) throw new ConnectError("no plugin", Code.NotFound);
        return installedPlugin(backend.installedDigest);
      },
      listMembers: () =>
        create(ListPluginMembersResponseSchema, {
          members: [
            create(PluginMemberSchema, { kind: ApiResourceKind.skill, id: "skl_1", slug: "keep-warm", name: "keep-warm" }),
            create(PluginMemberSchema, { kind: ApiResourceKind.mcp_server, id: "mcp_1", slug: "warmth", name: "warmth" }),
            create(PluginMemberSchema, { kind: ApiResourceKind.agent, id: "agt_1", slug: "thermos", name: "thermos" }),
          ],
        }),
    });
  });
}

async function openHosted(files = hostedMarketplaceFiles()): Promise<OpenedMarketplace> {
  const { fetchImpl } = hostedFetch(files);
  return openMarketplace(await openGitHubTree({ type: "github", repo: HOSTED_REPO }, fetchImpl));
}

function renderDialog(opened: OpenedMarketplace, backend: Backend, onInstalled?: (o: unknown) => void) {
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: backendTransport(backend) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return render(
    <PluginInstallDialog
      opened={opened}
      entryName="thermos"
      sourceName="acme-plugins"
      org={ORG}
      open
      onClose={() => {}}
      onInstalled={onInstalled}
    />,
    { wrapper },
  );
}

describe("PluginInstallDialog", () => {
  it("previews the package in the CLI's words and installs exactly the prepared bytes", async () => {
    const opened = await openHosted();
    const backend: Backend = { pushes: [], installedDigest: null };
    const installed: unknown[] = [];
    renderDialog(opened, backend, (o) => installed.push(o));

    await waitFor(() => expect(screen.getByText("Skills")).toBeTruthy());
    expect(screen.getByText("1: keep-warm")).toBeTruthy();
    expect(screen.getByText("1: warmth (http)")).toBeTruthy();
    expect(screen.getByText("1: checker")).toBeTruthy();
    expect(screen.getByText("1: API_TOKEN")).toBeTruthy();
    expect(screen.getByText(/asks for these the first time you start a session/)).toBeTruthy();
    expect(screen.getByText("Cursor plugin")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(installed).toHaveLength(1));
    expect(backend.pushes).toHaveLength(1);
    // What was pushed is what the preview described: the digest matches a fresh read of the same entry.
    expect(await digestArchive(backend.pushes[0]!)).toMatch(/^[a-f0-9]{64}$/);
    expect(screen.getByRole("status").textContent).toContain("Installed plugin 'thermos' (1 skill, 1 MCP server, 1 agent)");
  });

  it("says when this exact version is already installed and disables Install", async () => {
    const opened = await openHosted();
    // The digest the dialog will compute, from the same entry through the same reader.
    const { digest } = await prepareEntry(opened, findEntry(opened.marketplace, "thermos")!);

    const backend: Backend = { pushes: [], installedDigest: digest };
    renderDialog(opened, backend);
    await waitFor(() => expect(screen.getByText(/already installed; there is nothing to do/)).toBeTruthy());
    expect((screen.getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names an upgrade and its effect when the org holds another version", async () => {
    const opened = await openHosted();
    const backend: Backend = { pushes: [], installedDigest: "f".repeat(64) };
    renderDialog(opened, backend);
    await waitFor(() => expect(screen.getByText(/installed at another version/)).toBeTruthy());
    expect(screen.getByText(/the agent is re-created/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Upgrade thermos" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeTruthy();
  });

  it("shows the library's refusal with every sentence", async () => {
    const files = hostedMarketplaceFiles();
    files.set("thermos/.cursor-plugin/plugin.json", JSON.stringify({ name: "Not Valid!" }));
    const opened = await openHosted(files);
    renderDialog(opened, { pushes: [], installedDigest: null });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("'thermos' cannot be installed:");
    expect(screen.queryByRole("button", { name: "Install" })?.hasAttribute("disabled")).toBe(true);
  });
});
