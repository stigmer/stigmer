/**
 * Pins the desktop Environment pages, wired identically to the web ones:
 * the list lists the active organization by its id with no server text
 * search, opens a row under its organization's slug, and offers "New
 * environment" and Apply YAML only to someone the server lets create one;
 * the new page creates in the active organization, opens the new
 * Environment on completion and the list on cancel, and meets someone who
 * may not create one with the denied notice; the detail page shows the
 * Environment the route names, names the breadcrumb, moves the route to
 * the slug it answers to, follows a rename, lands on the list after a
 * delete, and renders nothing for a route that names no Environment. Apply
 * YAML opens the manifest dialog and refreshes the list once a manifest is
 * applied; the new page waits, rendering nothing, while the server's
 * answer is in flight. The SDK views are pinned in @stigmer/react-sdk and
 * stubbed here.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

type Props = Record<string, unknown>;

const page = vi.hoisted(() => ({
  canCreate: { allowed: true, isLoading: false },
  props: new Map<string, Props>(),
  labels: [] as Array<string | null>,
}));

vi.mock("@stigmer/react-sdk", () => {
  const capture = (name: string) => (props: Props) => {
    page.props.set(name, props);
    return null;
  };
  return {
    ResourceWorkbench: (props: Props) => {
      page.props.set("ResourceWorkbench", props);
      return <div>{props.headerAction as ReactNode}</div>;
    },
    ApplyManifestDialog: capture("ApplyManifestDialog"),
    EnvironmentsNotOnServerNotice: () => null,
    EnvironmentForm: capture("EnvironmentForm"),
    EnvironmentDetailView: capture("EnvironmentDetailView"),
    EnvironmentCreationDenied: () => <p>only admins create environments</p>,
    createEnvironmentColumns: () => [],
    createEnvironmentListFn: () => async () => ({ entries: [], nextPageToken: "" }),
    useStigmer: () => ({}),
    useActiveOrgId: () => "org_acme",
    useCanCreateEnvironment: () => page.canCreate,
    useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
    useBreadcrumbOverride: () => ({ setLabel: (label: string | null) => page.labels.push(label) }),
  };
});

import EnvironmentListPage from "../library/EnvironmentListPage";
import EnvironmentNewPage from "../library/EnvironmentNewPage";
import EnvironmentDetailPage from "../library/EnvironmentDetailPage";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderAt(path: string, routePath: string, element: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function propsOf(name: string): Props {
  const props = page.props.get(name);
  if (!props) throw new Error(`${name} was not rendered`);
  return props;
}

function call(name: string, prop: string, arg?: unknown): void {
  const fn = propsOf(name)[prop] as (value?: unknown) => void;
  act(() => fn(arg));
}

function location(): string {
  return screen.getByTestId("location").textContent ?? "";
}

const CREATED = { metadata: { org: "org_acme", slug: "data-science", name: "Data science" } };

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.props.clear();
  page.labels.length = 0;
});

describe("desktop EnvironmentListPage", () => {
  it("lists the active org with no text search and opens a row under its org's slug", () => {
    renderAt("/library/environments", "/library/environments", <EnvironmentListPage />);
    expect(propsOf("ResourceWorkbench")).toMatchObject({ org: "org_acme", searchable: false });
    call("ResourceWorkbench", "onItemClick", CREATED);
    expect(location()).toBe("/library/environments/acme/data-science");
  });

  it("offers New environment and Apply YAML only to someone the server lets create one", () => {
    const { unmount } = renderAt("/library/environments", "/library/environments", <EnvironmentListPage />);
    expect(screen.getByRole("link", { name: "New environment" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply YAML" })).toBeTruthy();
    unmount();

    page.canCreate = { allowed: false, isLoading: false };
    renderAt("/library/environments", "/library/environments", <EnvironmentListPage />);
    expect(screen.queryByRole("link", { name: "New environment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply YAML" })).toBeNull();
  });

  it("opens Apply YAML and refreshes the list once a manifest is applied", () => {
    renderAt("/library/environments", "/library/environments", <EnvironmentListPage />);
    expect(propsOf("ApplyManifestDialog").open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(propsOf("ApplyManifestDialog")).toMatchObject({ open: true, org: "org_acme" });
    const before = propsOf("ResourceWorkbench").refetchToken as number;
    call("ApplyManifestDialog", "onApplied");
    expect(propsOf("ResourceWorkbench").refetchToken).toBe(before + 1);
  });

  it("keys each row by its Environment's id", () => {
    renderAt("/library/environments", "/library/environments", <EnvironmentListPage />);
    const getItemId = propsOf("ResourceWorkbench").getItemId as (item: unknown) => string;
    expect(getItemId({ metadata: { id: "env_ds" } })).toBe("env_ds");
    expect(getItemId({})).toBe("");
  });
});

describe("desktop EnvironmentNewPage", () => {
  it("creates in the active org, opens the new Environment, and goes back to the list on cancel", () => {
    renderAt("/library/environments/new", "/library/environments/new", <EnvironmentNewPage />);
    expect(propsOf("EnvironmentForm").org).toBe("org_acme");
    call("EnvironmentForm", "onCreated", CREATED);
    expect(location()).toBe("/library/environments/acme/data-science");
  });

  it("meets someone who may not create one with the denied notice", () => {
    page.canCreate = { allowed: false, isLoading: false };
    renderAt("/library/environments/new", "/library/environments/new", <EnvironmentNewPage />);
    expect(screen.getByText("only admins create environments")).toBeTruthy();
    expect(page.props.has("EnvironmentForm")).toBe(false);
  });

  it("goes back to the list on cancel", () => {
    renderAt("/library/environments/new", "/library/environments/new", <EnvironmentNewPage />);
    call("EnvironmentForm", "onCancel");
    expect(location()).toBe("/library/environments");
  });

  it("renders nothing while the server's answer is in flight", () => {
    page.canCreate = { allowed: false, isLoading: true };
    renderAt("/library/environments/new", "/library/environments/new", <EnvironmentNewPage />);
    expect(page.props.has("EnvironmentForm")).toBe(false);
    expect(screen.queryByText("only admins create environments")).toBeNull();
  });
});

describe("desktop EnvironmentDetailPage", () => {
  it("shows the routed Environment, names the breadcrumb and moves to the slug it answers to", () => {
    renderAt("/library/environments/acme/ds", "/library/environments/:org/:slug", <EnvironmentDetailPage />);
    expect(propsOf("EnvironmentDetailView")).toMatchObject({ org: "acme", slug: "ds" });
    call("EnvironmentDetailView", "onResourceLoad", CREATED);
    expect(page.labels).toContain("Data science");
    expect(location()).toBe("/library/environments/acme/data-science");
  });

  it("lands on the list after a delete", () => {
    renderAt("/library/environments/acme/ds", "/library/environments/:org/:slug", <EnvironmentDetailPage />);
    call("EnvironmentDetailView", "onDeleted");
    expect(location()).toBe("/library/environments");
  });

  it("moves the route to the slug a rename gave it", () => {
    renderAt("/library/environments/acme/ds", "/library/environments/:org/:slug", <EnvironmentDetailPage />);
    call("EnvironmentDetailView", "onRenamed", { metadata: { slug: "renamed" } });
    expect(location()).toBe("/library/environments/acme/renamed");
  });

  it("renders nothing for a route that names no Environment", () => {
    renderAt("/library/environments/acme", "/library/environments/:org", <EnvironmentDetailPage />);
    expect(page.props.has("EnvironmentDetailView")).toBe(false);
  });
});
