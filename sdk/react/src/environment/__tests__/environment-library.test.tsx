/**
 * The Environment kind's Library surface, pinned against an in-process
 * server:
 * - useUpdateEnvironment saves by mask: each edited field is its own spec
 *   path, the etag the Environment was read at rides the save, and a
 *   refusal is the server's sentence;
 * - useCanCreateEnvironment stays false while the server's answer is in
 *   flight, so a member never sees a create affordance flash, and follows
 *   the answer once it arrives;
 * - the fields say what the server's sandboxes cannot do before anyone
 *   tries: Limited disabled with its sentence where they cannot limit
 *   networking, the package boxes where they cannot install, and both
 *   offered where the server has not said;
 * - the form starts limited, with the registries and code hosts allowed
 *   and no host, where the server can limit networking, and unrestricted
 *   where it cannot or has not said; it creates what was typed;
 * - the detail view shows its pencils only to an editor, saves a section
 *   by mask, and shows a refused save under the section;
 * - a refused delete's toast carries the server's sentence naming what
 *   still uses the Environment;
 * - the columns read the network and packages in a few words.
 * Permission checks, Manage access and toasts are stood in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { EnvironmentSchema, type Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";

const permission = vi.hoisted(() => ({
  answers: new Map<string, { allowed: boolean; isLoading: boolean }>(),
}));
vi.mock("../../grant/useCheckPermission", () => ({
  useCheckPermission: (resource: { kind: string } | null, relation: string) =>
    resource === null
      ? { allowed: false, isLoading: false, error: null }
      : { ...(permission.answers.get(relation) ?? { allowed: true, isLoading: false }), error: null },
}));
vi.mock("../../access/useManageAccess", () => ({
  useManageAccess: () => ({ action: null, dialog: null, open: () => undefined, isOpen: false }),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("../../feedback/toast.js", () => ({ toast: toastMock }));

import { useCanCreateEnvironment } from "../useCanCreateEnvironment";
import { useUpdateEnvironment } from "../useUpdateEnvironment";
import { NetworkingFields, PackagesFields, EMPTY_PACKAGES_DRAFT, type NetworkingDraft } from "../EnvironmentFields";
import { EnvironmentForm, startingNetworkOf } from "../EnvironmentForm";
import { EnvironmentDetailView } from "../EnvironmentDetailView";
import { describeNetworkShort, describePackagesShort } from "../environmentColumns";
import { useDeleteResource } from "../../resource-detail/useDeleteResource";

const ORG = "org_acme";

const STORED = create(EnvironmentSchema, {
  metadata: { id: "env_ds", org: ORG, slug: "data-science", name: "data-science", etag: "etag-1" },
  spec: {
    description: "Pandas and the GitHub API",
    networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"], allowPackageManagers: true },
    packages: { pip: ["pandas"] },
  },
});

interface Captured {
  readonly updates: Array<{ paths: string[]; etag: string; resource: Environment | undefined }>;
  readonly creates: Environment[];
}

function clientWith(
  captured: Captured,
  opts: {
    environments?: { applies: boolean; limitedNetworking: boolean; packages: boolean };
    refuseUpdate?: string;
  } = {},
) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(PlatformQueryController, {
        getServerInfo: () =>
          create(GetServerInfoOutputSchema, {
            edition: ServerEdition.oss,
            version: "test",
            ...(opts.environments ? { environments: opts.environments } : {}),
          }),
      });
      service(EnvironmentQueryController, {
        getByReference: () => STORED,
      });
      service(EnvironmentCommandController, {
        update: (req) => {
          captured.updates.push({
            paths: [...(req.updateMask?.paths ?? [])],
            etag: req.resource?.metadata?.etag ?? "",
            resource: req.resource,
          });
          if (opts.refuseUpdate) throw new ConnectError(opts.refuseUpdate, Code.FailedPrecondition);
          return STORED;
        },
        create: (req) => {
          captured.creates.push(req);
          return create(EnvironmentSchema, {
            spec: req.spec,
            metadata: { org: req.metadata?.org ?? "", name: req.metadata?.name ?? "", id: "env_new", slug: "made" },
          });
        },
      });
    }),
  });
}

function providers(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function fresh(): Captured {
  return { updates: [], creates: [] };
}

beforeEach(() => {
  permission.answers.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useUpdateEnvironment", () => {
  it("saves each edited field as its own spec path, with the etag it was read at", async () => {
    const captured = fresh();
    const { result } = renderHook(() => useUpdateEnvironment(), { wrapper: providers(clientWith(captured)) });
    await act(async () => {
      await result.current.update(STORED, { description: "new words" });
    });
    await act(async () => {
      await result.current.update(STORED, { networking: { type: NetworkingType.unrestricted } });
    });
    await act(async () => {
      await result.current.update(STORED, { packages: { pip: [] } });
    });
    expect(captured.updates.map((u) => u.paths)).toEqual([["spec.description"], ["spec.networking"], ["spec.packages"]]);
    expect(captured.updates.every((u) => u.etag === "etag-1")).toBe(true);
    expect(captured.updates[0]?.resource?.metadata?.id).toBe("env_ds");
  });

  it("holds the server's refusal as its words", async () => {
    const captured = fresh();
    const refusal = "environment 'data-science' limits networking to listed hosts, which this server's sandboxes cannot enforce";
    const { result } = renderHook(() => useUpdateEnvironment(), {
      wrapper: providers(clientWith(captured, { refuseUpdate: refusal })),
    });
    await act(async () => {
      await expect(result.current.update(STORED, { description: "x" })).rejects.toThrow();
    });
    expect(result.current.error).toContain("cannot enforce");
  });
});

describe("useCanCreateEnvironment", () => {
  it("stays false while the server's answer is in flight, then follows it", () => {
    permission.answers.set("can_create_environment", { allowed: true, isLoading: true });
    const { result, rerender } = renderHook(() => useCanCreateEnvironment(ORG));
    expect(result.current).toEqual({ allowed: false, isLoading: true });
    permission.answers.set("can_create_environment", { allowed: true, isLoading: false });
    rerender();
    expect(result.current).toEqual({ allowed: true, isLoading: false });
    permission.answers.set("can_create_environment", { allowed: false, isLoading: false });
    rerender();
    expect(result.current.allowed).toBe(false);
  });

  it("is false with no organization yet", () => {
    const { result } = renderHook(() => useCanCreateEnvironment(null));
    expect(result.current.allowed).toBe(false);
  });
});

describe("the fields", () => {
  const LIMITED: NetworkingDraft = { type: "limited", hosts: "", allowPackageManagers: true, allowMcpServers: false };

  function renderFields(availability: { applies: boolean; limitedNetworking: boolean; packages: boolean } | undefined) {
    render(
      <>
        <NetworkingFields value={startingNetworkOf(undefined)} onChange={() => undefined} availability={availability} />
        <PackagesFields value={EMPTY_PACKAGES_DRAFT} onChange={() => undefined} availability={availability} />
      </>,
      { wrapper: providers(clientWith(fresh())) },
    );
  }

  it("disables Limited, saying why, where the sandboxes cannot limit networking", () => {
    renderFields({ applies: true, limitedNetworking: false, packages: true });
    expect((screen.getByRole("radio", { name: /Limited to listed websites/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("This server's sandboxes can't limit networking to listed websites.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "pip (Python packages)" }) as HTMLTextAreaElement).closest("fieldset")?.disabled).toBe(false);
  });

  it("disables the package boxes, saying why, where the sandboxes cannot install", () => {
    renderFields({ applies: true, limitedNetworking: true, packages: false });
    expect(screen.getByText("This server's sandboxes can't install packages.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "pip (Python packages)" }).closest("fieldset")?.disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /Limited to listed websites/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it("offers both where the server has not said", () => {
    renderFields(undefined);
    expect((screen.getByRole("radio", { name: /Limited to listed websites/ }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole("textbox", { name: "pip (Python packages)" }).closest("fieldset")?.disabled).toBe(false);
  });

  it("shows the hosts and both allowances under Limited, with the one-label wildcard explained", () => {
    render(<NetworkingFields value={LIMITED} onChange={() => undefined} availability={undefined} />, {
      wrapper: providers(clientWith(fresh())),
    });
    expect(screen.getByRole("textbox", { name: "Websites" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /package registries and code hosts/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("checkbox", { name: /MCP servers/ })).toBeTruthy();
    expect(screen.getByText(/matches/).textContent).toContain("*.example.com matches api.example.com, not example.com");
  });
});

describe("EnvironmentForm", () => {
  async function renderForm(environments?: { applies: boolean; limitedNetworking: boolean; packages: boolean }) {
    const captured = fresh();
    const onCreated = vi.fn();
    render(<EnvironmentForm org={ORG} onCreated={onCreated} />, {
      wrapper: providers(clientWith(captured, environments ? { environments } : {})),
    });
    await screen.findByRole("form", { name: "New environment" });
    return { captured, onCreated };
  }

  it("starts limited with registries and code hosts allowed and no host where the server can limit", async () => {
    await renderForm({ applies: true, limitedNetworking: true, packages: true });
    expect((screen.getByRole("radio", { name: /Limited to listed websites/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /package registries and code hosts/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("textbox", { name: "Websites" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("starts unrestricted, Limited disabled, where the server cannot limit", async () => {
    await renderForm({ applies: true, limitedNetworking: false, packages: true });
    expect((screen.getByRole("radio", { name: /Unrestricted/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /Limited to listed websites/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it("starts unrestricted on a server that has not said, and shows the note where Environments do not apply", async () => {
    await renderForm();
    expect((screen.getByRole("radio", { name: /Unrestricted/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    await renderForm({ applies: false, limitedNetworking: false, packages: false });
    expect((await screen.findByRole("note")).textContent).toContain("Environments don't apply on this server");
  });

  it("creates what was typed: trimmed lines, blanks dropped", async () => {
    const { captured, onCreated } = await renderForm({ applies: true, limitedNetworking: true, packages: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "data-science" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Websites" }), { target: { value: " api.github.com \n\n" } });
    fireEvent.change(screen.getByRole("textbox", { name: "pip (Python packages)" }), { target: { value: "pandas\n sqlalchemy==2.0.30\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Create environment" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const sent = captured.creates[0];
    expect(sent?.metadata?.name).toBe("data-science");
    expect(sent?.metadata?.org).toBe(ORG);
    expect(sent?.spec?.networking?.type).toBe(NetworkingType.limited);
    expect(sent?.spec?.networking?.allowedHosts).toEqual(["api.github.com"]);
    expect(sent?.spec?.networking?.allowPackageManagers).toBe(true);
    expect(sent?.spec?.packages?.pip).toEqual(["pandas", "sqlalchemy==2.0.30"]);
  });
});

describe("EnvironmentDetailView", () => {
  it("shows its pencils only to an editor", async () => {
    permission.answers.set("can_edit", { allowed: false, isLoading: false });
    const { unmount } = render(<EnvironmentDetailView org={ORG} slug="data-science" />, {
      wrapper: providers(clientWith(fresh())),
    });
    await screen.findByText("Pandas and the GitHub API");
    expect(screen.queryByRole("button", { name: "Edit network" })).toBeNull();
    unmount();

    permission.answers.set("can_edit", { allowed: true, isLoading: false });
    render(<EnvironmentDetailView org={ORG} slug="data-science" />, { wrapper: providers(clientWith(fresh())) });
    await screen.findByText("Pandas and the GitHub API");
    expect(screen.getByRole("button", { name: "Edit description" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit network" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit packages" })).toBeTruthy();
  });

  it("saves the network by mask, and shows a refused save under the section", async () => {
    const captured = fresh();
    const refusal = "allowed host 'localhost' is refused: a single label";
    render(<EnvironmentDetailView org={ORG} slug="data-science" />, {
      wrapper: providers(clientWith(captured, { refuseUpdate: refusal })),
    });
    await screen.findByText("Pandas and the GitHub API");
    fireEvent.click(screen.getByRole("button", { name: "Edit network" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Websites" }), { target: { value: "api.github.com\nlocalhost" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("a single label");
    expect(captured.updates[0]?.paths).toEqual(["spec.networking"]);
    expect(captured.updates[0]?.resource?.spec?.networking?.allowedHosts).toEqual(["api.github.com", "localhost"]);
  });
});

describe("delete", () => {
  it("shows the server's sentence naming what still uses the Environment", async () => {
    const refusal =
      "environment 'data-science' is still named by agent 'reviewer' and the organization's default; remove it from them first";
    const client = {
      environment: {
        delete: vi.fn(async () => {
          throw new ConnectError(refusal, Code.FailedPrecondition);
        }),
      },
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
    );
    const hook = renderHook(() => useDeleteResource("environment", "env_ds", "data-science"), { wrapper });
    await act(async () => {
      await expect(hook.result.current.deleteResource()).rejects.toThrow();
    });
    expect(client.environment.delete).toHaveBeenCalledWith("env_ds");
    expect(toastMock.error).toHaveBeenCalledWith("Failed to delete environment", { description: refusal });
  });
});

describe("the columns", () => {
  it("read the network and packages in a few words", () => {
    expect(describeNetworkShort(STORED)).toBe("Limited · 1 host");
    expect(describePackagesShort(STORED)).toBe("1 package");
    const open = create(EnvironmentSchema, { spec: {} });
    expect(describeNetworkShort(open)).toBe("Unrestricted");
    expect(describePackagesShort(open)).toBe("None");
  });
});
