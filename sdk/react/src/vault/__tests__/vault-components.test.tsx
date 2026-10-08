/**
 * The vault UI, pinned against an in-process server:
 * - CreateVaultForm creates a shared vault from what was typed (blank
 *   optional fields omitted), shows a refusal, and cancels;
 * - VaultEntriesEditor never shows a value: it lists entries sorted, says
 *   how each login was saved, adds and replaces values from scratch,
 *   refuses a malformed name or address before sending, removes by name or
 *   address only once the person confirms (Keep leaves the entry), and
 *   shows a refused write;
 * - VaultListPanel lists shared vaults only (never anyone's My vault), says
 *   who may use each, writes entries by vault id, and saves or deletes a
 *   vault's own fields for an editor, refusals shown;
 * - VaultsSection says which chats use My vault (those the person starts,
 *   unless the conversation lists vaults of its own or the agent is of
 *   another organization), shows My vault's entries with "Sign in again"
 *   for a login a sign-in saved, and creates a shared vault for an admin;
 * - AgentVaultsSection lists the agent's vaults (another organization's by
 *   its slug), starts an edit from them (a reference with no organization
 *   read as the agent's), and saves a new list through the picker.
 * The permission checks, the access dialog and the OAuth flow are stood in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { VaultSchema, type Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultListSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { AgentVaultsSection } from "../../agent/AgentVaultsSection";
import { VaultsSection } from "../../settings/VaultsSection";
import { CreateVaultForm } from "../CreateVaultForm";
import { VaultEntriesEditor } from "../VaultEntriesEditor";
import { VaultListPanel } from "../VaultListPanel";

const permission = vi.hoisted(() => ({ allowed: true }));
vi.mock("../../iam-policy/useCheckPermission", () => ({
  useCheckPermission: () => ({ allowed: permission.allowed, isLoading: false, error: null }),
}));
vi.mock("../../access/ManageAccessButton", () => ({
  ManageAccessButton: ({ label }: { label: string }) => <span>{label}</span>,
}));
const oauth = vi.hoisted(() => ({ started: [] as string[], error: null as Error | null }));
vi.mock("../../mcp-server/useMcpServerOAuthConnect", () => ({
  useMcpServerOAuthConnect: () => ({
    startOAuth: async (id: string) => {
      oauth.started.push(id);
      return {};
    },
    isInProgress: false,
    error: oauth.error,
  }),
}));
vi.mock("../../organization/OrgProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../organization/OrgProvider")>()),
  useActiveOrgId: () => ORG,
}));
vi.mock("../../organization/useOrgRefs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../organization/useOrgRefs")>()),
  useOrgSlugForId: () => (id: string) => (id === "org_parent" ? "parent" : id),
}));

const ORG = "org_acme";

beforeEach(() => {
  permission.allowed = true;
  oauth.started = [];
  oauth.error = null;
});
afterEach(cleanup);

const MINE = create(VaultSchema, {
  metadata: { id: "vlt_mine", org: ORG, slug: "my-vault-x", name: "My vault" },
  spec: {
    owner: { case: "person", value: "ida_ana" },
    connections: {
      "https://mcp.linear.app/mcp": {
        token: "",
        source: VaultConnectionSource.sign_in,
        signIn: { expiresAt: 0n, mcpServerId: "mcp_linear" },
      },
    },
  },
});

const SUPPORT = create(VaultSchema, {
  metadata: {
    id: "vlt_team",
    org: ORG,
    slug: "support-tools",
    name: "Support tools",
    visibility: ApiResourceVisibility.visibility_org,
  },
  spec: {
    owner: { case: "org", value: ORG },
    description: "team keys",
    secrets: { ZENDESK_API_KEY: { value: "" } },
  },
});

const HANDBOOK = create(VaultSchema, {
  metadata: { id: "vlt_book", org: ORG, slug: "handbook", name: "" },
  spec: { owner: { case: "org", value: ORG } },
});

function providers(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function clientWith(
  writes: string[],
  opts: { refuse?: boolean; listError?: boolean; mine?: Vault | null; onlyMine?: boolean } = {},
) {
  const refuse = () => {
    if (opts.refuse) throw new ConnectError("not allowed here", Code.PermissionDenied);
  };
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(VaultQueryController, {
        list: () => {
          if (opts.listError) throw new ConnectError("list failed", Code.Unavailable);
          return opts.onlyMine
            ? create(VaultListSchema, { items: [MINE], totalCount: 1 })
            : create(VaultListSchema, { items: [MINE, SUPPORT, HANDBOOK], totalCount: 3 });
        },
        getMine: () => {
          if (opts.mine === null) throw new ConnectError("none yet", Code.NotFound);
          return opts.mine ?? MINE;
        },
      });
      service(VaultCommandController, {
        create: (req) => {
          refuse();
          writes.push(`create:${req.metadata?.name}:${req.spec?.description}:${req.spec?.externalId}`);
          return SUPPORT;
        },
        update: (req) => {
          refuse();
          writes.push(`update:${req.metadata?.name}:${req.spec?.description}:${req.spec?.externalId}`);
          return SUPPORT;
        },
        delete: (req) => {
          refuse();
          writes.push(`delete:${req.resourceId}`);
          return SUPPORT;
        },
        setSecrets: (req) => {
          refuse();
          writes.push(`setSecrets:${req.vault?.vault.value}:${Object.keys(req.secrets).join(",")}`);
          return SUPPORT;
        },
        removeSecrets: (req) => {
          writes.push(`removeSecrets:${req.vault?.vault.value}:${req.names.join(",")}`);
          return SUPPORT;
        },
        setConnection: (req) => {
          writes.push(`setConnection:${req.vault?.vault.value}:${req.address}`);
          return SUPPORT;
        },
        removeConnections: (req) => {
          writes.push(`removeConnections:${req.vault?.vault.value}:${req.addresses.join(",")}`);
          return SUPPORT;
        },
      });
    }),
  });
}

describe("CreateVaultForm", () => {
  it("creates a shared vault from what was typed and cancels", async () => {
    const writes: string[] = [];
    const onCreated = vi.fn();
    const onCancel = vi.fn();
    render(<CreateVaultForm org={ORG} onCreated={onCreated} onCancel={onCancel} />, {
      wrapper: providers(clientWith(writes)),
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Support tools " } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: "team keys" } });
    fireEvent.change(screen.getByLabelText(/^External id/), { target: { value: "cust-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create vault" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(writes).toEqual(["create:Support tools:team keys:cust-1"]);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("ignores a submit with no name, and shows a refusal", async () => {
    const writes: string[] = [];
    render(<CreateVaultForm org={ORG} />, { wrapper: providers(clientWith(writes, { refuse: true })) });
    fireEvent.submit(screen.getByRole("button", { name: "Create vault" }).closest("form")!);
    expect(writes).toEqual([]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create vault" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("VaultEntriesEditor", () => {
  const vault = create(VaultSchema, {
    metadata: { id: "vlt_team" },
    spec: {
      secrets: {
        ZED: { value: "", savedAt: timestampFromDate(new Date("2026-10-01T00:00:00Z")) },
        ALPHA: { value: "", description: "first" },
      },
      connections: {
        "https://b.example/mcp": { token: "", source: VaultConnectionSource.pasted, description: "beta" },
        "https://a.example/mcp": {
          token: "",
          source: VaultConnectionSource.sign_in,
          signIn: { expiresAt: 1_900_000_000n },
        },
      },
    },
  });

  function renderEditor(onWrite: (what: string) => Promise<unknown> = async () => undefined) {
    const calls: string[] = [];
    const record = (what: string) => {
      calls.push(what);
      return onWrite(what);
    };
    render(
      <VaultEntriesEditor
        vault={vault}
        onSetSecrets={(s) => record(`set:${Object.entries(s).map(([k, v]) => `${k}=${v.value}/${v.description ?? ""}`).join(",")}`)}
        onRemoveSecrets={(n) => record(`removeSecrets:${n.join(",")}`)}
        onSetConnection={(a, t, d) => record(`setConnection:${a}=${t}/${d ?? ""}`)}
        onRemoveConnections={(a) => record(`removeConnections:${a.join(",")}`)}
      />,
    );
    return calls;
  }

  it("lists entries sorted, saying how each login was saved, and never a value", () => {
    renderEditor();
    const secrets = within(screen.getByRole("region", { name: "Secrets" })).getAllByRole("listitem");
    expect(secrets[0]?.textContent?.startsWith("ALPHA")).toBe(true);
    expect(secrets[1]?.textContent?.startsWith("ZED")).toBe(true);
    expect(secrets[1]?.textContent).toContain("Saved");
    const logins = within(screen.getByRole("region", { name: "Logins" })).getAllByRole("listitem");
    expect(logins[0]?.textContent).toContain("https://a.example/mcp");
    expect(logins[0]?.textContent).toContain("renewed automatically");
    expect(logins[1]?.textContent).toContain("Pasted token");
  });

  it("adds, replaces and removes entries, refusing a malformed name or address", async () => {
    const calls = renderEditor();
    const addSecret = screen.getByRole("form", { name: "Add a secret" });
    fireEvent.change(within(addSecret).getByLabelText("Secret name"), { target: { value: "1BAD" } });
    expect(within(addSecret).getByRole("alert").textContent).toMatch(/starts with a letter/);
    fireEvent.submit(addSecret);
    fireEvent.change(within(addSecret).getByLabelText("Secret name"), { target: { value: "NEW_KEY" } });
    fireEvent.change(within(addSecret).getByLabelText("Secret value"), { target: { value: "v1" } });
    fireEvent.change(within(addSecret).getByLabelText("Secret description"), { target: { value: " d " } });
    await act(async () => {
      fireEvent.submit(addSecret);
    });

    const addLogin = screen.getByRole("form", { name: "Add a login" });
    fireEvent.change(within(addLogin).getByLabelText("Login address"), { target: { value: "not an address" } });
    expect(within(addLogin).getByRole("alert")).toBeTruthy();
    fireEvent.submit(addLogin);
    fireEvent.change(within(addLogin).getByLabelText("Login address"), { target: { value: "https://MCP.example.com/mcp/" } });
    fireEvent.change(within(addLogin).getByLabelText("Login token"), { target: { value: "tok" } });
    fireEvent.change(within(addLogin).getByLabelText("Login description"), { target: { value: "work" } });
    await act(async () => {
      fireEvent.submit(addLogin);
    });

    fireEvent.click(within(screen.getByRole("region", { name: "Secrets" })).getAllByRole("button", { name: "Replace" })[0]!);
    const replaceInput = screen.getByLabelText("New value for ALPHA");
    fireEvent.submit(replaceInput.closest("form")!);
    fireEvent.change(replaceInput, { target: { value: "v2" } });
    await act(async () => {
      fireEvent.submit(replaceInput.closest("form")!);
    });
    expect(screen.queryByLabelText("New value for ALPHA")).toBeNull();

    fireEvent.click(within(screen.getByRole("region", { name: "Logins" })).getAllByRole("button", { name: "Replace" })[0]!);
    const tokenInput = screen.getByLabelText("New token for https://a.example/mcp");
    fireEvent.change(tokenInput, { target: { value: "t2" } });
    await act(async () => {
      fireEvent.submit(tokenInput.closest("form")!);
    });

    // A remove asks first: the value cannot be read back. Keep sends nothing.
    fireEvent.click(screen.getByRole("button", { name: "Remove ZED" }));
    const keep = screen.getByRole("group", { name: "Confirm removing ZED" });
    expect(keep.textContent).toMatch(/cannot be read back/);
    fireEvent.click(within(keep).getByRole("button", { name: "Keep" }));
    expect(screen.queryByRole("group", { name: "Confirm removing ZED" })).toBeNull();
    expect(calls.some((c) => c.startsWith("remove"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Remove ZED" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove https://b.example/mcp" }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("group", { name: "Confirm removing ZED" })).getByRole("button", { name: "Remove" }),
      );
      fireEvent.click(
        within(screen.getByRole("group", { name: "Confirm removing https://b.example/mcp" })).getByRole("button", {
          name: "Remove",
        }),
      );
    });

    expect(calls).toEqual([
      "set:NEW_KEY=v1/d",
      "setConnection:https://mcp.example.com/mcp=tok/work",
      "set:ALPHA=v2/first",
      "setConnection:https://a.example/mcp=t2/",
      "removeSecrets:ZED",
      "removeConnections:https://b.example/mcp",
    ]);
  });

  it("shows a refused write and keeps the replace field open", async () => {
    renderEditor(async () => {
      throw new ConnectError("vault is full", Code.FailedPrecondition);
    });
    fireEvent.click(within(screen.getByRole("region", { name: "Secrets" })).getAllByRole("button", { name: "Replace" })[0]!);
    const input = screen.getByLabelText("New value for ALPHA");
    fireEvent.change(input, { target: { value: "v" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/vault is full/);
    expect(screen.getByLabelText("New value for ALPHA")).toBeTruthy();
  });
});

describe("VaultListPanel", () => {
  it("lists shared vaults only, says who may use each, and writes entries by vault id", async () => {
    const writes: string[] = [];
    let refetch: (() => void) | undefined;
    render(<VaultListPanel org={ORG} onRefetchRef={(r) => (refetch = r)} />, {
      wrapper: providers(clientWith(writes)),
    });
    const list = await screen.findByRole("list", { name: "Shared vaults" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list.textContent).not.toContain("My vault");
    expect(list.textContent).toContain("Everyone can use");
    expect(list.textContent).toContain("Admins and granted");
    expect(list.textContent).toContain("1 entry");
    expect(list.textContent).toContain("0 entries");
    expect(list.textContent).toContain("handbook");
    expect(refetch).toBeTypeOf("function");

    fireEvent.click(screen.getByRole("button", { name: /Support tools/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove ZENDESK_API_KEY" }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("group", { name: "Confirm removing ZENDESK_API_KEY" })).getByRole("button", {
          name: "Remove",
        }),
      );
    });
    await waitFor(() => expect(writes).toContain("removeSecrets:vlt_team:ZENDESK_API_KEY"));

    // Collapses again.
    fireEvent.click(screen.getByRole("button", { name: /Support tools/ }));
    expect(screen.queryByLabelText("Vault details")).toBeNull();
  });

  it("saves and deletes a vault's own fields for an editor, refusals shown", async () => {
    const writes: string[] = [];
    render(<VaultListPanel org={ORG} />, { wrapper: providers(clientWith(writes)) });
    fireEvent.click(await screen.findByRole("button", { name: /Support tools/ }));
    fireEvent.change(screen.getByLabelText("Vault name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText("Vault description"), { target: { value: "new" } });
    fireEvent.change(screen.getByLabelText("External id"), { target: { value: "cust-9" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete vault" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete vault" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    await waitFor(() => expect(writes).toEqual(["update:Renamed:new:cust-9", "delete:vlt_team"]));
  });

  it("shows a refused save or delete", async () => {
    render(<VaultListPanel org={ORG} />, { wrapper: providers(clientWith([], { refuse: true })) });
    fireEvent.click(await screen.findByRole("button", { name: /Support tools/ }));
    fireEvent.change(screen.getByLabelText("Vault name"), { target: { value: "Renamed" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(/not allowed here/);
    fireEvent.click(screen.getByRole("button", { name: "Delete vault" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/not allowed here/);
  });

  it("shows entries without write controls when read-only or when the viewer may not edit", async () => {
    render(<VaultListPanel org={ORG} readOnly />, { wrapper: providers(clientWith([])) });
    fireEvent.click(await screen.findByRole("button", { name: /Support tools/ }));
    expect(screen.getByText("ZENDESK_API_KEY")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove ZENDESK_API_KEY" })).toBeNull();
    expect(screen.queryByText("Who can use")).toBeNull();
    cleanup();

    permission.allowed = false;
    render(<VaultListPanel org={ORG} />, { wrapper: providers(clientWith([])) });
    fireEvent.click(await screen.findByRole("button", { name: /Support tools/ }));
    expect(screen.getByText("ZENDESK_API_KEY")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove ZENDESK_API_KEY" })).toBeNull();
  });

  it("says when the list fails or holds no shared vault", async () => {
    render(<VaultListPanel org={ORG} />, { wrapper: providers(clientWith([], { listError: true })) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/list failed/);
    cleanup();
    render(<VaultListPanel org={ORG} />, { wrapper: providers(clientWith([], { onlyMine: true })) });
    expect(await screen.findByText("No shared vaults yet.")).toBeTruthy();
  });
});

describe("VaultsSection", () => {
  it("shows My vault with Sign in again for a signed-in login, and creates a shared vault", async () => {
    const writes: string[] = [];
    render(<VaultsSection />, { wrapper: providers(clientWith(writes)) });
    expect(
      screen.getByText(
        "Your own logins and secrets. Chats you start use them unless the conversation lists vaults of its own, " +
          "and a chat with an agent of another organization never does; nobody else's chats ever do. " +
          "Saved values can be replaced but are never shown again.",
      ),
    ).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in again" }));
    await waitFor(() => expect(oauth.started).toEqual(["mcp_linear"]));

    fireEvent.click(screen.getByRole("button", { name: "+ New shared vault" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Create vault" }));
    await waitFor(() => expect(writes).toEqual(["create:Ops::"]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Create vault" })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "+ New shared vault" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Create vault" })).toBeNull();
  });

  it("shows an OAuth failure", async () => {
    oauth.error = new Error("sign-in refused");
    render(<VaultsSection />, { wrapper: providers(clientWith([])) });
    expect((await screen.findByText("sign-in refused")).getAttribute("role")).toBe("alert");
  });
});

describe("AgentVaultsSection", () => {
  it("lists the agent's vaults, another organization's by its slug", () => {
    render(
      <AgentVaultsSection
        org={ORG}
        vaults={[
          { org: ORG, slug: "support-tools", kind: 59 } as never,
          { org: "org_parent", slug: "shared-keys", kind: 59 } as never,
        ]}
      />,
      { wrapper: providers(clientWith([])) },
    );
    expect(screen.getByText("support-tools")).toBeTruthy();
    expect(screen.getByText("parent/shared-keys")).toBeTruthy();
  });

  it("saves a new list through the picker, and stays open on a failed save", async () => {
    const saves: string[][] = [];
    let accept = false;
    const onSave = async (refs: { slug: string }[]) => {
      saves.push(refs.map((r) => r.slug));
      return accept;
    };
    render(
      <AgentVaultsSection org={ORG} vaults={[]} editable onSave={onSave} error="could not save" />,
      { wrapper: providers(clientWith([])) },
    );
    expect(screen.getByText("No vaults.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByRole("alert").textContent).toBe("could not save");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    accept = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(saves).toEqual([[], []]);
  });

  it("starts an edit from the agent's vaults, a reference with no organization read as the agent's", async () => {
    const saves: Array<Array<{ org: string; slug: string }>> = [];
    render(
      <AgentVaultsSection
        org={ORG}
        vaults={[
          { org: "", slug: "support-tools", kind: 59 } as never,
          { org: "org_parent", slug: "shared-keys", kind: 59 } as never,
        ]}
        editable
        onSave={async (refs) => {
          saves.push(refs.map((r) => ({ org: r.org, slug: r.slug })));
          return true;
        }}
      />,
      { wrapper: providers(clientWith([])) },
    );
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(saves).toEqual([
      [
        { org: ORG, slug: "support-tools" },
        { org: "org_parent", slug: "shared-keys" },
      ],
    ]);
  });
});
