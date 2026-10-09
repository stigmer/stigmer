/**
 * The console's vault surface, pinned:
 * - useMyVault answers `null` before the first save (the server's NOT_FOUND
 *   is a state, not an error), reads entry names and addresses only, and
 *   every write names `mine` so the server creates My vault on first save;
 * - VaultPicker never offers My vault as a listed vault unless the surface
 *   may name it (a schedule its owner sets up), and keeps the order the
 *   person chose; a conversation's picker shows My vault as a fixed first
 *   row with a tick, even before My vault exists, never in the list, and
 *   read-only when disabled;
 * - VaultEntriesEditor never shows a value: replacing asks for a new one
 *   from scratch and sends it with the entry's name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { VaultSchema, type Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultListSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useMyVault } from "../useMyVault";
import { VaultPicker } from "../VaultPicker";
import { VaultEntriesEditor } from "../VaultEntriesEditor";

afterEach(cleanup);

const ORG = "org_acme";

const MY_VAULT = create(VaultSchema, {
  metadata: { id: "vlt_mine", org: ORG, slug: "my-vault-ana", name: "My vault" },
  spec: {
    owner: { case: "person", value: "ida_ana" },
    secrets: { OPENAI_API_KEY: { value: "", description: "OpenAI" } },
    connections: {
      "https://mcp.linear.app/mcp": {
        token: "",
        source: VaultConnectionSource.sign_in,
        signIn: { expiresAt: 0n },
      },
    },
  },
});

const SHARED = create(VaultSchema, {
  metadata: { id: "vlt_team", org: ORG, slug: "support-tools", name: "Support tools" },
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

function clientWith(opts: { mine?: Vault | null; writes?: string[] }) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(VaultQueryController, {
        getMine: () => {
          if (!opts.mine) throw new ConnectError("no My vault yet", Code.NotFound);
          return opts.mine;
        },
        list: () =>
          create(VaultListSchema, {
            items: [...(opts.mine ? [opts.mine] : []), SHARED],
            totalCount: opts.mine ? 2 : 1,
          }),
      });
      service(VaultCommandController, {
        setSecrets: (req) => {
          opts.writes?.push(`setSecrets:${req.vault?.vault.case}:${Object.entries(req.secrets).map(([k, v]) => `${k}=${v.value}`).join(",")}`);
          return opts.mine ?? MY_VAULT;
        },
        setConnection: (req) => {
          opts.writes?.push(`setConnection:${req.vault?.vault.case}:${req.address}`);
          return opts.mine ?? MY_VAULT;
        },
      });
    }),
  });
}

describe("useMyVault", () => {
  it("answers null before the first save, without an error", async () => {
    const { result } = renderHook(() => useMyVault(ORG), { wrapper: providers(clientWith({ mine: null })) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.vault).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.secretNames.size).toBe(0);
  });

  it("reads names and addresses, and writes name My vault by `mine`", async () => {
    const writes: string[] = [];
    const { result } = renderHook(() => useMyVault(ORG), {
      wrapper: providers(clientWith({ mine: MY_VAULT, writes })),
    });
    await waitFor(() => expect(result.current.vault).not.toBeNull());
    expect([...result.current.secretNames]).toEqual(["OPENAI_API_KEY"]);
    expect([...result.current.connectionAddresses]).toEqual(["https://mcp.linear.app/mcp"]);

    await act(async () => {
      await result.current.setSecrets({ ZENDESK_API_KEY: "z" });
      await result.current.setConnection("github.com", "gho_x");
    });
    expect(writes).toEqual(["setSecrets:mine:ZENDESK_API_KEY=z", "setConnection:mine:github.com"]);
  });
});

describe("VaultPicker", () => {
  it("offers shared vaults only, unless the surface may name My vault", async () => {
    const onChange = vi.fn();
    const client = clientWith({ mine: MY_VAULT });
    const { rerender } = render(
      <VaultPicker org={ORG} value={[]} onChange={onChange} />,
      { wrapper: providers(client) },
    );
    expect(await screen.findByRole("option", { name: "Support tools" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "My vault" })).toBeNull();

    rerender(<VaultPicker org={ORG} value={[]} onChange={onChange} allowMyVault />);
    expect(await screen.findByRole("option", { name: "My vault" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Add vault"), { target: { value: "my-vault-ana" } });
    expect(onChange).toHaveBeenCalledWith([{ org: ORG, slug: "my-vault-ana" }]);
  });

  it("shows a conversation's My vault as a ticked first row, before it exists, never as a listed vault", async () => {
    const onChange = vi.fn();
    const onMyVaultChange = vi.fn();
    const { rerender } = render(
      <VaultPicker
        org={ORG}
        value={[]}
        onChange={onChange}
        myVault={{ checked: true, onChange: onMyVaultChange }}
      />,
      { wrapper: providers(clientWith({ mine: null })) },
    );
    expect(await screen.findByRole("option", { name: "Support tools" })).toBeTruthy();
    const tick = screen.getByRole("checkbox", { name: /My vault/ }) as HTMLInputElement;
    expect(tick.checked).toBe(true);
    expect(screen.queryByRole("option", { name: "My vault" })).toBeNull();

    fireEvent.click(tick);
    expect(onMyVaultChange).toHaveBeenCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <VaultPicker
        org={ORG}
        value={[]}
        onChange={onChange}
        myVault={{ checked: false, onChange: onMyVaultChange }}
        disabled
      />,
    );
    const readOnly = screen.getByRole("checkbox", { name: /My vault/ }) as HTMLInputElement;
    expect(readOnly.checked).toBe(false);
    expect(readOnly.disabled).toBe(true);
    expect((screen.getByLabelText("Add vault") as HTMLSelectElement).disabled).toBe(true);
  });
});

describe("VaultEntriesEditor", () => {
  it("shows names and addresses but never a value, and replaces from scratch", async () => {
    const onSetSecrets = vi.fn(async () => MY_VAULT);
    render(
      <VaultEntriesEditor
        vault={MY_VAULT}
        onSetSecrets={onSetSecrets}
        onRemoveSecrets={vi.fn(async () => MY_VAULT)}
        onSetConnection={vi.fn(async () => MY_VAULT)}
        onRemoveConnections={vi.fn(async () => MY_VAULT)}
      />,
    );

    expect(screen.getByText("OPENAI_API_KEY")).toBeTruthy();
    expect(screen.getByText("https://mcp.linear.app/mcp")).toBeTruthy();
    expect(screen.getByText(/Signed in/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Replace" })[0]!);
    const input = screen.getByLabelText("New value for OPENAI_API_KEY") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "sk-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSetSecrets).toHaveBeenCalledWith({
        OPENAI_API_KEY: { value: "sk-new", description: "OpenAI" },
      }),
    );
  });
});
