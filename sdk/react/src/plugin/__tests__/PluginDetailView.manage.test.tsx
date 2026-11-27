/**
 * How the plugin page says a plugin is changed, keyed and removed, against
 * an in-memory Connect backend. Pins: a plugin of one HTTP server, read
 * from its own files at its installed digest, offers Change address to a
 * person who may push (`can_create_plugin`) and to nobody else; the form
 * starts from the files, saves nothing while unchanged, and pushes the new
 * address at the plugin's visibility, then reads the plugin again; a file
 * beside the two, or an eval suite (which a file listing never serves),
 * makes it a package, which offers no Change address and says to push its
 * folder, with "upload the new version" handed to the host. Each key says
 * how it is filled (a sign-in's login key, with "or paste one" unless the
 * server takes only a sign-in; any other key pasted into a vault), whether
 * My vault holds it, and Save to My vault writes it there. The closing
 * section gives the remove command and says why the name is fixed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { PluginCommandController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { type Plugin, PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  McpServerSignInSchema,
  PluginEvalSuiteSchema,
  type PluginStatus,
  PluginStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { VaultCommandController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { oneServerPluginDocuments } from "@stigmer/plugin-package";
import { digestArchive } from "@stigmer/plugin-package/client";
import { StigmerContext } from "@stigmer/react-core";
import { PluginDetailView } from "../PluginDetailView.js";
import { prepareMcpServerPlugin } from "../useAddMcpServer.js";

afterEach(cleanup);

const ORG = "acme";
const OLD_URL = "https://mcp.linear.app/mcp";
const NEW_URL = "https://mcp.linear.app/v2/mcp";
const DIGEST = "a".repeat(64);

const ONE_SERVER_STATUS = create(PluginStatusSchema, {
  digest: DIGEST,
  mcpServers: [
    {
      name: "linear",
      transport: { case: "http", value: { url: OLD_URL, headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } } },
      signIn: {},
    },
  ],
  env: { LINEAR_TOKEN: { isSecret: true }, TEAM_ID: { isSecret: true } },
});

interface World {
  readonly status: PluginStatus;
  /** The plugin's files at its digest, by path. */
  readonly files: Map<string, string>;
  /** Whether the viewer holds `can_create_plugin`. */
  readonly canPush: boolean;
  /** Names My vault holds secrets under. */
  readonly secrets: string[];
  readonly pushes: { artifact: Uint8Array; visibility: ApiResourceVisibility }[];
  readonly saved: Record<string, string>[];
  reads: number;
  listings: number;
}

function world(overrides: Partial<World> = {}): World {
  return {
    status: ONE_SERVER_STATUS,
    files: oneServerPluginDocuments({ name: "linear", url: OLD_URL, headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } }),
    canPush: true,
    secrets: [],
    pushes: [],
    saved: [],
    reads: 0,
    listings: 0,
    ...overrides,
  };
}

function pluginOf(w: World): Plugin {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      id: "plg_1",
      org: ORG,
      slug: "linear",
      name: "linear",
      visibility: ApiResourceVisibility.visibility_org,
    }),
    status: w.status,
  });
}

function renderView(w: World, onUploadNewVersion?: () => void) {
  const encoder = new TextEncoder();
  const myVault = () =>
    create(VaultSchema, {
      metadata: { org: ORG, slug: "mine" },
      spec: {
        owner: { case: "person", value: "ida_1" },
        secrets: Object.fromEntries(w.secrets.map((name) => [name, { value: "" }])),
      },
    });
  const transport = createRouterTransport(({ service }) => {
    service(PluginQueryController, {
      getByReference: () => {
        w.reads += 1;
        return pluginOf(w);
      },
      listFiles: (input) => {
        w.listings += 1;
        if (input.digest !== DIGEST) throw new ConnectError("no such version", Code.NotFound);
        return { files: [...w.files.keys()].sort().map((path) => ({ path })) };
      },
      readFile: (input) => ({ content: encoder.encode(w.files.get(input.path) ?? "") }),
      listVersions: () => {
        throw new ConnectError("no history here", Code.Unimplemented);
      },
    });
    service(PluginCommandController, {
      push: (input) => {
        w.pushes.push({ artifact: input.artifact, visibility: input.visibility });
        return pluginOf(w);
      },
    });
    service(GrantQueryController, {
      checkMyPermission: (input) => ({ isAuthorized: input.relation === "can_create_plugin" ? w.canPush : false }),
    });
    service(VaultQueryController, {
      getMine: () => {
        if (w.secrets.length === 0) throw new ConnectError("no My vault yet", Code.NotFound);
        return myVault();
      },
    });
    service(VaultCommandController, {
      setSecrets: (input) => {
        w.saved.push(Object.fromEntries(Object.entries(input.secrets).map(([name, secret]) => [name, secret.value])));
        w.secrets.push(...Object.keys(input.secrets));
        return myVault();
      },
    });
  });
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  render(<PluginDetailView org={ORG} slug="linear" onUploadNewVersion={onUploadNewVersion} />, { wrapper });
}

describe("PluginDetailView: changing a one-server plugin", () => {
  it("changes the address from the plugin's files, at its visibility, and reads the plugin again", async () => {
    const w = world();
    renderView(w);

    fireEvent.click(await screen.findByRole("button", { name: "Change the address of linear" }));
    const dialog = await screen.findByRole("dialog");
    const url = within(dialog).getByLabelText("URL") as HTMLInputElement;
    expect(url.value).toBe(OLD_URL);
    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).readOnly).toBe(true);
    expect(within(dialog).getByText(/A login is kept per address, so you sign in again at the new one\./)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(url, { target: { value: NEW_URL } });
    const readsBefore = w.reads;
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(w.pushes).toHaveLength(1));
    expect(w.pushes[0]!.visibility).toBe(ApiResourceVisibility.visibility_org);
    const expected = await prepareMcpServerPlugin({
      name: "linear",
      url: NEW_URL,
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    });
    expect(await digestArchive(w.pushes[0]!.artifact)).toBe(expected.digest);
    await waitFor(() => expect(w.reads).toBeGreaterThan(readsBefore + 1));
  });

  it("offers no Change address to a person who may not push, and says who can", async () => {
    renderView(world({ canPush: false }));

    expect(await screen.findByText(/An admin of the organization changes its address/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change the address of linear" })).toBeNull();
    expect(screen.getByText("stigmer mcp add linear <new-address>")).toBeTruthy();
  });

  it("reads a file beside the two as a package: push its folder, no Change address", async () => {
    const files = world().files;
    files.set("README.md", "# linear\n");
    const onUpload = vi.fn();
    renderView(world({ files }), onUpload);

    expect(await screen.findByText(/Change its folder and push it again/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change the address of linear" })).toBeNull();
    expect(screen.getByText("stigmer push plugin <folder>")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "upload the new version" }));
    expect(onUpload).toHaveBeenCalled();
  });

  it("never reads the files of a plugin with an eval suite, which a listing does not serve", async () => {
    const status = clone(PluginStatusSchema, ONE_SERVER_STATUS);
    status.evals = create(PluginEvalSuiteSchema, { dir: "evals" });
    const w = world({ status });
    renderView(w);

    expect(await screen.findByText(/Change its folder and push it again:/)).toBeTruthy();
    expect(w.listings).toBe(0);
    expect(screen.queryByRole("button", { name: "upload the new version" })).toBeNull();
  });
});

describe("PluginDetailView: the keys", () => {
  it("says how each key is filled and whether My vault holds it", async () => {
    renderView(world({ secrets: ["TEAM_ID"] }));

    const keys = await screen.findByRole("list", { name: "Keys this plugin reads" });
    const [login, team] = within(keys).getAllByRole("listitem");
    expect(within(login!).getByText("Filled when you sign in to linear, or paste one.")).toBeTruthy();
    expect(await within(login!).findByText("Not in My vault")).toBeTruthy();
    expect(within(team!).getByText("Paste it into My vault, or a vault the conversation lists.")).toBeTruthy();
    expect(within(team!).getByText("Saved in My vault")).toBeTruthy();
  });

  it("offers no paste for the login key of a server that takes only a sign-in", async () => {
    const status = clone(PluginStatusSchema, ONE_SERVER_STATUS);
    status.mcpServers[0]!.signIn = create(McpServerSignInSchema, { oauthOnly: true });
    renderView(world({ status }));

    expect(await screen.findByText("Filled when you sign in to linear.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save LINEAR_TOKEN to My vault" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save TEAM_ID to My vault" })).toBeTruthy();
  });

  it("saves a key to My vault, then reads it as saved", async () => {
    const w = world();
    renderView(w);

    fireEvent.click(await screen.findByRole("button", { name: "Save TEAM_ID to My vault" }));
    const field = screen.getByLabelText("Value of TEAM_ID") as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value: "team-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(w.saved).toEqual([{ TEAM_ID: "team-42" }]));
    const keys = screen.getByRole("list", { name: "Keys this plugin reads" });
    await waitFor(() => expect(within(within(keys).getAllByRole("listitem")[1]!).getByText("Saved in My vault")).toBeTruthy());
  });
});

describe("PluginDetailView: removing and the name", () => {
  it("gives the remove command and says why the name is fixed", async () => {
    renderView(world());

    expect(await screen.findByText("stigmer delete plugin linear")).toBeTruthy();
    expect(screen.getByText(/It is refused while an agent lists it\. Logins you saved for its\s+servers stay in My vault\./)).toBeTruthy();
    expect(screen.getByText("mcp__plugin_linear_…")).toBeTruthy();
    expect(screen.getByText(/To use another name, add it again under that name, move your agents to it, and remove this one\./)).toBeTruthy();
  });
});
