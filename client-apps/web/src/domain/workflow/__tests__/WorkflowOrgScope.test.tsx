/**
 * Pins how the web workflow pages name organizations: the list, the
 * runs list and the new-workflow editor use the active
 * organization's id, the way the server names every org, and the detail
 * page shows and runs the workflow in the organization it lives in, its
 * Run action opens the run dialog, and a change saved on the page refreshes
 * the dialog's copy of the workflow;
 * a list row's Organization column shows the stored org id through
 * OrgSlugText; a row's "Copy reference" copies `<org slug>/<slug>`; and a
 * row's Delete confirms in the detail page's words, the same confirmation
 * for the same act; a started run is announced and opened, a run that fails
 * to start shows its error, and a run picked on the detail page or in the
 * runs list (by a click or Enter) opens through run navigation.
 * The views and the workbench are pinned in @stigmer/react.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

interface Row {
  id: string;
  org: string;
  slug: string;
  name: string;
}

interface WorkbenchProps {
  org: string | null;
  columns: Array<{ id: string; cell: (item: Row) => ReactNode }>;
  renderItemAction?: (item: Row) => ReactNode;
}

const ROW: Row = {
  id: "wfl_1",
  org: "org_acme",
  slug: "nightly",
  name: "Nightly",
};

const page = vi.hoisted(() => ({
  workbench: [] as WorkbenchProps[],
  props: new Map<string, Record<string, unknown>>(),
  architectOrg: [] as Array<string | null>,
  executionListOrg: [] as Array<string | null>,
  confirms: [] as Array<{ title: string; description: string }>,
  refetchWorkflow: () => undefined,
  runs: [] as Array<{ metadata?: { id?: string; name?: string } }>,
  openedRuns: [] as string[],
  toasts: [] as Array<[string, string]>,
}));

vi.mock("@stigmer/react", () => {
  const capture = (name: string) => (props: Record<string, unknown>) => {
    page.props.set(name, props);
    return null;
  };
  const Passthrough = ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  );
  const ActionMenu = Object.assign(Passthrough, {
    Trigger: () => null,
    Content: Passthrough,
    Separator: () => null,
    Item: ({
      children,
      onSelect,
    }: {
      children?: ReactNode;
      onSelect: () => void;
    }) => (
      <button type="button" onClick={onSelect}>
        {children}
      </button>
    ),
  });
  const workflow = {
    list: async () => ({ items: [] }),
    delete: async () => undefined,
  };
  return {
    ResourceWorkbench: (props: WorkbenchProps) => {
      page.workbench.push(props);
      return (
        <div>
          {props.columns.map((column) => (
            <div key={column.id} data-column={column.id}>
              {column.cell(ROW)}
            </div>
          ))}
          {props.renderItemAction?.(ROW)}
        </div>
      );
    },
    ActionMenu,
    ApplyManifestDialog: () => null,
    ConfirmDialog: () => null,
    Button: Passthrough,
    WorkflowRunPhaseBadge: () => null,
    // A stand-in that shows which org id the column handed it.
    OrgSlugText: ({ orgId }: { orgId: string }) => <span>slug of {orgId}</span>,
    WorkflowEditorView: capture("WorkflowEditorView"),
    WorkflowArchitectDialog: () => null,
    WorkflowTemplateGallery: () => null,
    WorkflowDetailView: capture("WorkflowDetailView"),
    WorkflowRunDialog: capture("WorkflowRunDialog"),
    STARTER_WORKFLOW_YAML: "document: {}",
    WORKFLOW_TEMPLATES: [],
    useStigmer: () => ({ workflow }),
    useActiveOrgId: () => "org_acme",
    // The person's organizations: org_acme reads "acme".
    useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async (options: { title: string; description: string }) => {
        page.confirms.push(options);
        return false;
      },
      handleConfirm: () => undefined,
      handleCancel: () => undefined,
    }),
    useBreadcrumbOverride: () => ({ setLabel: () => undefined }),
    useElkLayoutEngine: () => undefined,
    useWorkflowArchitect: (org: string | null) => {
      page.architectOrg.push(org);
      return { availability: "unavailable" };
    },
    useWorkflowRunList: ({ org }: { org: string | null }) => {
      page.executionListOrg.push(org);
      return {
        runs: page.runs,
        isLoading: false,
        error: null,
        hasMore: false,
        loadMore: () => undefined,
        isLoadingMore: false,
        loadMoreError: null,
      };
    },
    useWorkflow: () => ({
      workflow: { metadata: { id: "wfl_1" } },
      refetch: page.refetchWorkflow,
    }),
    useWorkflowYaml: () => ({ yaml: null }),
    useCopyResource: () => ({
      copyId: () => undefined,
      copyQualifiedSlug: () => undefined,
    }),
    useDeleteResource: () => ({
      deleteResource: async () => undefined,
      isDeleting: false,
    }),
    useExportResource: () => ({
      copyYaml: () => undefined,
      copyJson: () => undefined,
      downloadYaml: () => undefined,
    }),
    toast: { success: () => undefined, error: () => undefined },
  };
});

vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({ navigateToDetail: () => undefined }),
  useRouteDetailYieldsToOverlay: () => false,
}));

vi.mock("@/domain/library/full-viewport-layout", () => ({
  useRequestFullViewport: () => undefined,
}));

vi.mock("@/domain/workflow/run-navigation", () => ({
  useRunNavigation: () => ({ navigateToRun: (id: string) => page.openedRuns.push(id) }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => page.toasts.push(["success", message]),
    error: (message: string) => page.toasts.push(["error", message]),
  },
}));

import { WorkflowListPage } from "../WorkflowListPage";
import { WorkflowNewPage } from "../WorkflowNewPage";
import { WorkflowDetailPageInner } from "../WorkflowDetailPage";
import { WorkflowRunListPage } from "../WorkflowRunListPage";
import { WORKFLOW_DELETE_DESCRIPTION } from "../workflow-delete-confirmation";

let copied: string[] = [];

beforeEach(() => {
  page.workbench.length = 0;
  page.props.clear();
  page.architectOrg.length = 0;
  page.executionListOrg.length = 0;
  page.confirms.length = 0;
  page.runs = [];
  page.openedRuns.length = 0;
  page.toasts.length = 0;
  copied = [];
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
    async (text: string) => {
      copied.push(text);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("web WorkflowListPage", () => {
  it("lists the active org by its id", () => {
    render(<WorkflowListPage />);

    expect(page.workbench.at(-1)?.org).toBe("org_acme");
  });

  it("shows a row's org through OrgSlugText, from the id the row names it by", () => {
    render(<WorkflowListPage />);

    expect(document.querySelector('[data-column="org"]')?.textContent).toBe(
      "slug of org_acme",
    );
  });

  it("copies the row's reference under its org's slug", () => {
    render(<WorkflowListPage />);

    fireEvent.click(screen.getByRole("button", { name: "Copy reference" }));

    expect(copied).toEqual(["acme/nightly"]);
  });

  it("confirms a row's delete in the detail page's words, naming the workflow alone", () => {
    render(<WorkflowListPage />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(page.confirms).toHaveLength(1);
    expect(page.confirms[0]!.description).toBe(WORKFLOW_DELETE_DESCRIPTION);
    expect(page.confirms[0]!.description).not.toMatch(/instance/);
  });
});

describe("web WorkflowNewPage", () => {
  it("asks for the architect and edits the new workflow in the active org id", () => {
    render(<WorkflowNewPage />);

    expect(page.architectOrg).toContain("org_acme");
    fireEvent.click(screen.getByRole("button", { name: /Visual Editor/ }));
    expect(page.props.get("WorkflowEditorView")?.org).toBe("org_acme");
  });
});

describe("web WorkflowDetailPageInner", () => {
  it("shows the workflow where it lives and runs it there, naming the workflow alone", () => {
    render(<WorkflowDetailPageInner org="other" slug="nightly" />);

    expect(page.props.get("WorkflowDetailView")).toMatchObject({
      org: "other",
      slug: "nightly",
    });
    const runDialog = page.props.get("WorkflowRunDialog");
    expect(runDialog).toMatchObject({ org: "other" });
    expect(Object.keys(runDialog ?? {}).sort()).toEqual(
      ["onError", "onOpenChange", "onSuccess", "open", "org", "workflow"],
    );
  });

  it("opens the run dialog from the Run action, and refreshes its copy when the page saves a change", () => {
    render(<WorkflowDetailPageInner org="other" slug="nightly" />);

    const detail = page.props.get("WorkflowDetailView");
    expect(detail?.onResourceUpdated).toBe(page.refetchWorkflow);
    expect(page.props.get("WorkflowRunDialog")?.open).toBe(false);

    const run = detail?.primaryAction as { id: string; onAction: () => void };
    expect(run.id).toBe("run");
    act(() => run.onAction());

    expect(page.props.get("WorkflowRunDialog")?.open).toBe(true);
  });

  it("confirms a delete that removes the workflow and keeps its past runs", () => {
    render(<WorkflowDetailPageInner org="other" slug="nightly" />);

    const actions = page.props.get("WorkflowDetailView")?.actions as Array<{
      id: string;
      onAction: () => void;
    }>;
    actions.find((a) => a.id === "delete")?.onAction();

    expect(page.confirms.at(-1)?.description).toBe(
      "This permanently removes the workflow. " +
        "Past runs are preserved in the run history. " +
        "This action cannot be undone.",
    );
    expect(page.confirms.at(-1)?.description).toBe(WORKFLOW_DELETE_DESCRIPTION);
  });

  it("announces a started run and opens it", () => {
    render(<WorkflowDetailPageInner org="other" slug="nightly" />);

    act(() => (page.props.get("WorkflowRunDialog")?.onSuccess as (id: string) => void)("wfr_started"));

    expect(page.toasts).toEqual([["success", "Workflow run started"]]);
    expect(page.openedRuns).toEqual(["wfr_started"]);
  });

  it("shows a run that fails to start as an error and opens nothing", () => {
    render(<WorkflowDetailPageInner org="other" slug="nightly" />);

    act(() => (page.props.get("WorkflowRunDialog")?.onError as (message: string) => void)("quota exhausted"));

    expect(page.toasts).toEqual([["error", "quota exhausted"]]);
    expect(page.openedRuns).toEqual([]);
  });

  it("opens a run picked from the workflow's run list, and the latest run from its link", () => {
    render(<WorkflowDetailPageInner org="other" slug="nightly" />);
    const detail = page.props.get("WorkflowDetailView");

    act(() => (detail?.onRunClick as (id: string) => void)("wfr_listed"));
    act(() => (detail?.onViewLatestRun as (id: string) => void)("wfr_latest"));

    expect(page.openedRuns).toEqual(["wfr_listed", "wfr_latest"]);
  });
});

describe("web WorkflowRunListPage", () => {
  it("lists the active org's executions by its id", () => {
    render(<WorkflowRunListPage />);

    expect(page.executionListOrg.at(-1)).toBe("org_acme");
  });

  it("opens a run when its row is clicked", () => {
    page.runs = [{ metadata: { id: "wfr_1", name: "nightly digest" } }];
    render(<WorkflowRunListPage />);

    fireEvent.click(screen.getByRole("link", { name: /nightly digest/ }));

    expect(page.openedRuns).toEqual(["wfr_1"]);
  });

  it("opens a run on Enter and ignores other keys", () => {
    page.runs = [{ metadata: { id: "wfr_2", name: "weekly report" } }];
    render(<WorkflowRunListPage />);
    const row = screen.getByRole("link", { name: /weekly report/ });

    fireEvent.keyDown(row, { key: " " });
    expect(page.openedRuns).toEqual([]);

    fireEvent.keyDown(row, { key: "Enter" });
    expect(page.openedRuns).toEqual(["wfr_2"]);
  });

  it("opens nothing from a row whose run has no id", () => {
    page.runs = [{ metadata: { name: "unsaved" } }];
    render(<WorkflowRunListPage />);
    const row = screen.getByRole("link", { name: /unsaved/ });

    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(page.openedRuns).toEqual([]);
  });
});
