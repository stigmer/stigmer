/**
 * The Environment page's actions and editors, and the kind's remaining
 * hooks, pinned against an in-process server:
 * - the kebab copies the id, the qualified slug and the YAML, and downloads
 *   the YAML;
 * - Delete asks first: cancelled, nothing is sent; refused, the page stays
 *   (the toast carries the server's sentence); done, the host is told;
 * - the slug field renames through the Environment's own rename and tells
 *   the host the new slug;
 * - each section's editor opens on the stored value, cancels without a
 *   save, and saves only its own spec path: the description trimmed, the
 *   packages one list per installer, and a network switched back to
 *   unrestricted carrying no hosts and no allowances whatever was ticked
 *   on the way;
 * - an Environment the server does not have reads as not found, and any
 *   other failure as an error with a retry;
 * - the form sends nothing while it has no name, and sends the
 *   description typed;
 * - useCreateEnvironment holds a refused create's error until cleared;
 * - useEnvironmentCount counts the first page and says when more follow;
 * - the list fn pages the direct query; the columns render each cell;
 * - useEnvironmentsNotApplying reads the provider's target and the
 *   server's answer;
 * - updateVisibility and delete reach the Environment's own RPCs;
 * - the denied notice says who may create one.
 * Permission checks, Manage access, toasts, copying and downloads are
 * stood in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { EnvironmentSchema, type Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentListSchema, type ListEnvironmentsRequest } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/io_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { StigmerContext } from "../../context";
import { ExecutionTargetContext } from "../../execution-target-context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { openMenu } from "../../__tests__/helpers/open-menu";

vi.mock("../../grant/useCheckPermission", () => ({
  useCheckPermission: () => ({ allowed: true, isLoading: false, error: null }),
}));
vi.mock("../../access/useManageAccess", () => ({
  useManageAccess: () => ({ action: null, dialog: null, open: () => undefined, isOpen: false }),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("../../feedback/toast.js", () => ({ toast: toastMock }));
const copied = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../../resource-detail/useCopyResource", () => ({
  useCopyResource: () => ({
    copy: async () => undefined,
    copyId: async (id: string) => void copied.calls.push(`id:${id}`),
    copySlug: async () => undefined,
    copyQualifiedSlug: async (org: string, slug: string) => void copied.calls.push(`slug:${org}/${slug}`),
  }),
}));
vi.mock("../../library/useExportResource", () => ({
  useExportResource: () => ({
    copyYaml: async () => void copied.calls.push("yaml"),
    copyJson: async () => undefined,
    downloadYaml: () => void copied.calls.push("download"),
    downloadJson: () => undefined,
  }),
}));

import { EnvironmentDetailView } from "../EnvironmentDetailView";
import { EnvironmentForm } from "../EnvironmentForm";
import { EnvironmentCreationDenied } from "../EnvironmentCreationDenied";
import { createEnvironmentColumns } from "../environmentColumns";
import { createEnvironmentListFn, listEnvironmentsPage } from "../environmentListFn";
import { useCreateEnvironment } from "../useCreateEnvironment";
import { useEnvironmentCount } from "../useEnvironmentCount";
import { useEnvironmentsNotApplying } from "../useEnvironmentsNotApplying";
import { useDeleteResource } from "../../resource-detail/useDeleteResource";
import { useUpdateVisibility } from "../../library/useUpdateVisibility";

const ORG = "org_acme";

function stored(): Environment {
  return create(EnvironmentSchema, {
    metadata: { id: "env_ds", org: ORG, slug: "data-science", name: "data-science", etag: "etag-1" },
    spec: {
      description: "Pandas and the GitHub API",
      networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"], allowPackageManagers: true },
      packages: { pip: ["pandas"], npm: ["typescript"] },
    },
  });
}

interface Server {
  readonly updates: Array<{ paths: string[]; resource: Environment | undefined }>;
  readonly renames: string[];
  readonly deletes: string[];
  readonly visibility: Array<[string, ApiResourceVisibility]>;
  readonly lists: ListEnvironmentsRequest[];
  read: "found" | "missing" | "failing";
  deleteRefusal: string | undefined;
  createRefusal: string | undefined;
  pages: Environment[][];
  environments: { applies: boolean; limitedNetworking: boolean; packages: boolean } | undefined;
}

function server(): Server {
  return {
    updates: [],
    renames: [],
    deletes: [],
    visibility: [],
    lists: [],
    read: "found",
    deleteRefusal: undefined,
    createRefusal: undefined,
    pages: [[stored()]],
    environments: undefined,
  };
}

function clientOf(s: Server): Stigmer {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(PlatformQueryController, {
        getServerInfo: () =>
          create(GetServerInfoOutputSchema, {
            edition: ServerEdition.oss,
            version: "test",
            ...(s.environments ? { environments: s.environments } : {}),
          }),
      });
      service(EnvironmentQueryController, {
        getByReference: () => {
          if (s.read === "missing") throw new ConnectError("environment not found", Code.NotFound);
          if (s.read === "failing") throw new ConnectError("the store is down", Code.Unavailable);
          return stored();
        },
        list: (req) => {
          s.lists.push(req);
          const at = Number(req.pageToken || "0");
          return create(EnvironmentListSchema, {
            entries: s.pages[at] ?? [],
            nextPageToken: at + 1 < s.pages.length ? String(at + 1) : "",
          });
        },
      });
      service(EnvironmentCommandController, {
        update: (req) => {
          s.updates.push({ paths: [...(req.updateMask?.paths ?? [])], resource: req.resource });
          return stored();
        },
        rename: (req) => {
          s.renames.push(req.slug);
          const renamed = stored();
          renamed.metadata!.slug = req.slug;
          return renamed;
        },
        delete: (req) => {
          s.deletes.push(req.value);
          if (s.deleteRefusal) throw new ConnectError(s.deleteRefusal, Code.FailedPrecondition);
          return stored();
        },
        updateVisibility: (req) => {
          s.visibility.push([req.resourceId, req.visibility]);
          return stored();
        },
        create: (req) => {
          if (s.createRefusal) throw new ConnectError(s.createRefusal, Code.FailedPrecondition);
          return create(EnvironmentSchema, {
            metadata: { org: req.metadata?.org ?? "", name: req.metadata?.name ?? "", id: "env_new", slug: "made" },
            spec: req.spec,
          });
        },
      });
    }),
  });
}

function providers(s: Server, target?: "local" | "cloud") {
  const client = clientOf(s);
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>
          <ExecutionTargetContext.Provider value={target}>{children}</ExecutionTargetContext.Provider>
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

async function renderPage(s: Server, props: { onDeleted?: () => void; onRenamed?: (e: Environment) => void } = {}) {
  render(<EnvironmentDetailView org={ORG} slug="data-science" {...props} />, { wrapper: providers(s) });
  await screen.findByText("Pandas and the GitHub API");
}

async function chooseFromMenu(item: string): Promise<void> {
  await openMenu(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

beforeEach(() => {
  copied.calls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the Environment page's kebab", () => {
  it("copies the id, the qualified slug and the YAML, and downloads the YAML", async () => {
    await renderPage(server());
    for (const item of ["Copy ID", "Copy slug", "Copy YAML", "Download YAML"]) {
      await chooseFromMenu(item);
    }
    await waitFor(() =>
      expect(copied.calls).toEqual(["id:env_ds", `slug:${ORG}/data-science`, "yaml", "download"]),
    );
  });
});

describe("deleting from the Environment page", () => {
  it("sends nothing when the person cancels", async () => {
    const s = server();
    const onDeleted = vi.fn();
    await renderPage(s, { onDeleted });
    await chooseFromMenu("Delete");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/cannot be deleted until they stop naming it/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(s.deletes).toEqual([]);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("stays on the page when the server refuses, its sentence in the toast", async () => {
    const s = server();
    s.deleteRefusal = "environment 'data-science' is still named by agent 'reviewer'; remove it from them first";
    const onDeleted = vi.fn();
    await renderPage(s, { onDeleted });
    await chooseFromMenu("Delete");
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error).toHaveBeenCalledWith("Failed to delete environment", { description: s.deleteRefusal });
    expect(s.deletes).toEqual(["env_ds"]);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("tells the host once the Environment is gone", async () => {
    const s = server();
    const onDeleted = vi.fn();
    await renderPage(s, { onDeleted });
    await chooseFromMenu("Delete");
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(s.deletes).toEqual(["env_ds"]);
  });
});

describe("renaming from the Environment page", () => {
  it("renames through the Environment's own rename and tells the host the new slug", async () => {
    const s = server();
    const onRenamed = vi.fn();
    await renderPage(s, { onRenamed });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "data-sci" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(onRenamed).toHaveBeenCalledOnce());
    expect(s.renames).toEqual(["data-sci"]);
    expect(onRenamed.mock.calls[0]![0].metadata.slug).toBe("data-sci");
  });
});

describe("the Environment page's editors", () => {
  it("cancels the description without a save, then saves it trimmed, by its own path", async () => {
    const s = server();
    await renderPage(s);
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    const field = screen.getByRole("textbox", { name: "Description" });
    expect((field as HTMLTextAreaElement).value).toBe("Pandas and the GitHub API");
    fireEvent.change(field, { target: { value: "dropped" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    expect(s.updates).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "  Data tools  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull());
    expect(s.updates.map((u) => u.paths)).toEqual([["spec.description"]]);
    expect(s.updates[0]?.resource?.spec?.description).toBe("Data tools");
  });

  it("opens the packages on the stored lists and saves one list per installer", async () => {
    const s = server();
    await renderPage(s);
    fireEvent.click(screen.getByRole("button", { name: "Edit packages" }));
    const pip = screen.getByRole("textbox", { name: "pip (Python packages)" });
    expect((pip as HTMLTextAreaElement).value).toBe("pandas");
    expect((screen.getByRole("textbox", { name: "npm (Node packages)" }) as HTMLTextAreaElement).value).toBe("typescript");
    fireEvent.change(pip, { target: { value: "pandas\n\n pyjokes \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.updates).toHaveLength(1));
    expect(s.updates[0]?.paths).toEqual(["spec.packages"]);
    expect(s.updates[0]?.resource?.spec?.packages?.pip).toEqual(["pandas", "pyjokes"]);
    expect(s.updates[0]?.resource?.spec?.packages?.npm).toEqual(["typescript"]);
    expect(s.updates[0]?.resource?.spec?.packages?.apt).toEqual([]);
  });

  it("saves a network switched back to unrestricted with no hosts and no allowances, whatever was ticked on the way", async () => {
    const s = server();
    await renderPage(s);
    fireEvent.click(screen.getByRole("button", { name: "Edit network" }));
    fireEvent.click(screen.getByRole("radio", { name: /Unrestricted/ }));
    expect(screen.queryByRole("textbox", { name: "Websites" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Limited to listed websites/ }));
    const registries = screen.getByRole("checkbox", { name: /package registries and code hosts/ });
    const mcp = screen.getByRole("checkbox", { name: /MCP servers/ });
    fireEvent.click(registries);
    fireEvent.click(mcp);
    expect((registries as HTMLInputElement).checked).toBe(false);
    expect((mcp as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Unrestricted/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.updates).toHaveLength(1));
    const networking = s.updates[0]?.resource?.spec?.networking;
    expect(s.updates[0]?.paths).toEqual(["spec.networking"]);
    expect(networking?.type).toBe(NetworkingType.unrestricted);
    expect(networking?.allowedHosts).toEqual([]);
    expect(networking?.allowPackageManagers).toBe(false);
    expect(networking?.allowMcpServers).toBe(false);
  });
});

describe("reading an Environment", () => {
  it("reads one the server does not have as not found", async () => {
    const s = server();
    s.read = "missing";
    render(<EnvironmentDetailView org={ORG} slug="gone" />, { wrapper: providers(s) });
    expect(await screen.findByText("Environment not found")).toBeTruthy();
  });

  it("shows any other failure as an error to retry", async () => {
    const s = server();
    s.read = "failing";
    render(<EnvironmentDetailView org={ORG} slug="data-science" />, { wrapper: providers(s) });
    expect(await screen.findByText(/the store is down/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeTruthy();
  });
});

describe("EnvironmentForm", () => {
  it("sends nothing while it has no name, and sends the description typed", async () => {
    const onCreated = vi.fn();
    render(<EnvironmentForm org={ORG} onCreated={onCreated} />, { wrapper: providers(server()) });
    const form = await screen.findByRole("form", { name: "New environment" });
    fireEvent.submit(form);
    await act(async () => undefined);
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "data-science" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Description/ }), { target: { value: "For the data team" } });
    fireEvent.click(screen.getByRole("button", { name: "Create environment" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onCreated.mock.calls[0]![0].spec.description).toBe("For the data team");
  });
});

describe("useCreateEnvironment", () => {
  it("holds a refused create's error until cleared", async () => {
    const s = server();
    s.createRefusal = "environment 'x' installs packages, which this server's sandboxes cannot do";
    const { result } = renderHook(() => useCreateEnvironment(), { wrapper: providers(s) });
    await act(async () => {
      await expect(result.current.create({ name: "x", org: ORG, packages: { pip: ["pandas"] } })).rejects.toThrow();
    });
    expect(result.current.error?.message).toContain("cannot do");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

describe("useEnvironmentCount", () => {
  it("counts the first page, and says when more follow", async () => {
    const s = server();
    s.pages = [[stored(), stored()], [stored()]];
    const { result } = renderHook(() => useEnvironmentCount(ORG), { wrapper: providers(s) });
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(result.current.isLowerBound).toBe(true);
    expect(s.lists[0]?.pageSize).toBe(100);
  });

  it("reads nothing with no organization", () => {
    const s = server();
    const { result } = renderHook(() => useEnvironmentCount(null), { wrapper: providers(s) });
    expect(result.current.count).toBeUndefined();
    expect(s.lists).toEqual([]);
  });
});

describe("the list fn and the columns", () => {
  it("pages the direct query: the organization, the page size and token, twenty by default", async () => {
    const s = server();
    s.pages = [[stored()], [stored()]];
    const client = clientOf(s);
    const listFn = createEnvironmentListFn(client);
    const first = await listFn({ org: ORG, pageSize: 5, pageToken: "", query: "ignored" } as Parameters<typeof listFn>[0]);
    expect(first.nextPageToken).toBe("1");
    const second = await listFn({ org: ORG, pageSize: 5, pageToken: "1", query: "" } as Parameters<typeof listFn>[0]);
    expect(second.nextPageToken).toBe("");
    await listEnvironmentsPage(client, ORG);
    expect(s.lists.map((r) => [r.org, r.pageSize, r.pageToken])).toEqual([
      [ORG, 5, ""],
      [ORG, 5, "1"],
      [ORG, 20, ""],
    ]);
  });

  it("renders each cell: the name, the network, the packages and the visibility", () => {
    const columns = createEnvironmentColumns();
    expect(columns.map((c) => c.header)).toEqual(["Name", "Network", "Packages", "Visibility"]);
    const item = stored();
    render(
      <div>
        {columns.map((column) => (
          <div key={column.id}>{column.cell(item)}</div>
        ))}
      </div>,
    );
    expect(screen.getByText("data-science")).toBeTruthy();
    expect(screen.getByText("Limited · 1 host")).toBeTruthy();
    expect(screen.getByText("2 packages")).toBeTruthy();
    cleanup();
    const unnamed = create(EnvironmentSchema, { metadata: { slug: "only-slug" } });
    render(<div>{columns[0]!.cell(unnamed)}</div>);
    expect(screen.getByText("only-slug")).toBeTruthy();
    expect(columns[3]!.cell(create(EnvironmentSchema, {}))).toBeNull();
  });
});

describe("useEnvironmentsNotApplying", () => {
  it("is the own machine under a local target", () => {
    const { result } = renderHook(() => useEnvironmentsNotApplying(), { wrapper: providers(server(), "local") });
    expect(result.current).toBe("own-machine");
  });

  it("is the server's answer for a conversation that names no target", async () => {
    const s = server();
    s.environments = { applies: false, limitedNetworking: false, packages: false };
    const { result } = renderHook(() => useEnvironmentsNotApplying(), { wrapper: providers(s) });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe("not-on-server"));
  });
});

describe("the cross-kind hooks reach the Environment's own RPCs", () => {
  it("updates its visibility", async () => {
    const s = server();
    const { result } = renderHook(() => useUpdateVisibility("environment", "env_ds"), { wrapper: providers(s) });
    await act(async () => {
      await result.current.updateVisibility(ApiResourceVisibility.visibility_private);
    });
    expect(s.visibility).toEqual([["env_ds", ApiResourceVisibility.visibility_private]]);
  });

  it("deletes it", async () => {
    const s = server();
    const { result } = renderHook(() => useDeleteResource("environment", "env_ds", "data-science"), {
      wrapper: providers(s),
    });
    await act(async () => {
      await result.current.deleteResource();
    });
    expect(s.deletes).toEqual(["env_ds"]);
  });
});

describe("EnvironmentCreationDenied", () => {
  it("says who may create one", () => {
    render(<EnvironmentCreationDenied />);
    expect(screen.getByText("Only admins can create environments here")).toBeTruthy();
    expect(screen.getByText("Ask an admin of this organization to create the environment you need.")).toBeTruthy();
  });
});
