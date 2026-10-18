/**
 * Pins the web Environment pages' seams around the SDK: the list lists the
 * active organization by its id, opens a row as a Library detail, and
 * offers "New environment" and Apply YAML only to someone the server lets
 * create one; the new page creates in the active organization, opens the
 * new Environment under its organization's slug, goes back to the list on
 * cancel, and meets a direct visit by someone who may not create one with
 * the denied notice; the detail page shows the Environment where it lives,
 * names the breadcrumb, keeps the canonical slug, and lands on the list
 * after a delete. /library/environments serves the list; Apply YAML opens
 * the manifest dialog and refreshes the list once a manifest is applied;
 * the routed detail page reads the Environment from the address the static
 * export serves. The views, form and workbench are pinned in
 * @stigmer/react-sdk and stubbed here to capture their props.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

type Props = Record<string, unknown>;

const page = vi.hoisted(() => ({
  // The server's answer to "may this person create an environment here?".
  canCreate: { allowed: true, isLoading: false },
  props: new Map<string, Props>(),
  pushed: [] as string[],
  labels: [] as Array<string | null>,
  canonical: [] as string[],
  detail: [] as Array<[string, string, string]>,
}));

vi.mock("@stigmer/react-sdk", () => {
  const capture = (name: string) => (props: Props) => {
    page.props.set(name, props);
    return null;
  };
  return {
    ResourceWorkbench: (props: Props) => {
      page.props.set("ResourceWorkbench", props);
      return (
        <div>
          {props.headerAction as ReactNode}
          {props.emptyAction as ReactNode}
        </div>
      );
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
    // The person's organizations: org_acme reads "acme" in a URL.
    useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
    useBreadcrumbOverride: () => ({ setLabel: (label: string | null) => page.labels.push(label) }),
  };
});

vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => page.pushed.push(url) }),
  useParams: () => ({ org: "__placeholder__", slug: "__placeholder__" }),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({
    navigateToDetail: (type: string, org: string, slug: string) => page.detail.push([type, org, slug]),
    canonicalSlug: (slug: string) => page.canonical.push(slug),
  }),
  useRouteDetailYieldsToOverlay: () => false,
}));

import { EnvironmentListPage } from "../EnvironmentListPage";
import { EnvironmentNewPage } from "../EnvironmentNewPage";
import { EnvironmentDetailPage, EnvironmentDetailPageInner } from "../EnvironmentDetailPage";
import EnvironmentsPage from "@/app/library/environments/page";

function propsOf(name: string): Props {
  const props = page.props.get(name);
  if (!props) throw new Error(`${name} was not rendered`);
  return props;
}

function call(name: string, prop: string, arg?: unknown): void {
  const fn = propsOf(name)[prop] as (value?: unknown) => void;
  act(() => fn(arg));
}

const CREATED = { metadata: { org: "org_acme", slug: "data-science", name: "Data science" } };

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.props.clear();
  page.pushed.length = 0;
  page.labels.length = 0;
  page.canonical.length = 0;
  page.detail.length = 0;
});

describe("web EnvironmentListPage", () => {
  it("lists the active org by its id and opens a row as a Library detail", () => {
    render(<EnvironmentListPage />);
    expect(propsOf("ResourceWorkbench").org).toBe("org_acme");
    expect(propsOf("ResourceWorkbench").searchable).toBe(false);
    call("ResourceWorkbench", "onItemClick", CREATED);
    expect(page.detail).toEqual([["environments", "org_acme", "data-science"]]);
  });

  it("offers New environment and Apply YAML to someone the server lets create one", () => {
    render(<EnvironmentListPage />);
    expect(screen.getAllByRole("link", { name: "New environment" })[0]?.getAttribute("href")).toBe(
      "/library/environments/new",
    );
    expect(screen.getByRole("button", { name: "Apply YAML" })).toBeTruthy();
  });

  it("offers neither to someone the server would refuse", () => {
    page.canCreate = { allowed: false, isLoading: false };
    render(<EnvironmentListPage />);
    expect(screen.queryByRole("link", { name: "New environment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply YAML" })).toBeNull();
  });

  it("is the page /library/environments serves", () => {
    render(<EnvironmentsPage />);
    expect(propsOf("ResourceWorkbench").org).toBe("org_acme");
  });

  it("opens Apply YAML and refreshes the list once a manifest is applied", () => {
    render(<EnvironmentListPage />);
    expect(propsOf("ApplyManifestDialog").open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(propsOf("ApplyManifestDialog")).toMatchObject({ open: true, org: "org_acme" });
    const before = propsOf("ResourceWorkbench").refetchToken as number;
    call("ApplyManifestDialog", "onApplied");
    expect(propsOf("ResourceWorkbench").refetchToken).toBe(before + 1);
  });

  it("keys each row by its Environment's id", () => {
    render(<EnvironmentListPage />);
    const getItemId = propsOf("ResourceWorkbench").getItemId as (item: unknown) => string;
    expect(getItemId({ metadata: { id: "env_ds" } })).toBe("env_ds");
    expect(getItemId({})).toBe("");
  });
});

describe("web EnvironmentNewPage", () => {
  it("creates in the active org id and opens the new Environment under the org slug", () => {
    render(<EnvironmentNewPage />);
    expect(propsOf("EnvironmentForm").org).toBe("org_acme");
    call("EnvironmentForm", "onCreated", CREATED);
    expect(page.pushed).toEqual(["/library/environments/acme/data-science"]);
  });

  it("goes back to the list on cancel", () => {
    render(<EnvironmentNewPage />);
    call("EnvironmentForm", "onCancel");
    expect(page.pushed).toEqual(["/library/environments"]);
  });

  it("meets a direct visit by someone who may not create one with the denied notice", () => {
    page.canCreate = { allowed: false, isLoading: false };
    render(<EnvironmentNewPage />);
    expect(screen.getByText("only admins create environments")).toBeTruthy();
    expect(page.props.has("EnvironmentForm")).toBe(false);
  });

  it("renders nothing while the server's answer is in flight", () => {
    page.canCreate = { allowed: false, isLoading: true };
    const { container } = render(<EnvironmentNewPage />);
    expect(container.textContent).toBe("");
  });
});

describe("web EnvironmentDetailPageInner", () => {
  it("shows the Environment where it lives, names the breadcrumb and keeps the canonical slug", () => {
    render(<EnvironmentDetailPageInner org="acme" slug="ds" />);
    expect(propsOf("EnvironmentDetailView")).toMatchObject({ org: "acme", slug: "ds" });
    call("EnvironmentDetailView", "onResourceLoad", CREATED);
    expect(page.labels.at(-1)).toBe("Data science");
    expect(page.canonical).toEqual(["data-science"]);
  });

  it("lands on the list after a delete, and follows a rename", () => {
    render(<EnvironmentDetailPageInner org="acme" slug="ds" />);
    call("EnvironmentDetailView", "onDeleted");
    expect(page.pushed).toEqual(["/library/environments"]);
    call("EnvironmentDetailView", "onRenamed", { metadata: { slug: "renamed" } });
    expect(page.canonical).toEqual(["renamed"]);
  });
});

describe("web EnvironmentDetailPage", () => {
  it("reads the Environment from the address the static export serves", () => {
    window.history.replaceState(null, "", "/library/environments/acme/data-science");
    render(<EnvironmentDetailPage />);
    expect(propsOf("EnvironmentDetailView")).toMatchObject({ org: "acme", slug: "data-science" });
  });

  it("renders nothing for an address that names no Environment", () => {
    // An address too short to name one: the placeholder page with no segments to read.
    window.history.replaceState(null, "", "/");
    render(<EnvironmentDetailPage />);
    expect(page.props.has("EnvironmentDetailView")).toBe(false);
  });
});
