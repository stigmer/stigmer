/**
 * Pins the desktop workflow page's header actions: a workflow's YAML is
 * edited in its dedicated Editor tab (one YAML surface per workflow), so
 * "Edit YAML" switches to that tab, and only once the workflow's YAML has
 * loaded; the clipboard actions copy the id and the qualified slug; the
 * delete confirmation names the workflow alone and keeps its past runs;
 * the run dialog names the workflow alone. The detail view and the editor
 * are pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

interface Action {
  id: string;
  label: string;
  group?: string;
  disabled?: boolean;
  onAction: () => void;
}

interface DetailProps {
  actions: Action[];
  activeTab: string;
  additionalTabs: Array<{ id: string }>;
  onResourceLoad: (resource: { name: string; id: string }) => void;
}

const page = vi.hoisted(() => ({
  yaml: undefined as string | undefined,
  detail: [] as DetailProps[],
  copiedIds: [] as string[],
  copiedSlugs: [] as Array<[string, string]>,
  confirms: [] as Array<{ description: string }>,
  runDialog: [] as Array<Record<string, unknown>>,
}));

const noop = () => undefined;

vi.mock("@stigmer/react", () => ({
  WorkflowDetailView: (props: DetailProps) => {
    page.detail.push(props);
    return null;
  },
  WorkflowEditorView: () => null,
  WorkflowRunDialog: (props: Record<string, unknown>) => {
    page.runDialog.push(props);
    return null;
  },
  ConfirmDialog: () => null,
  useWorkflow: () => ({ workflow: { metadata: { id: "wfl_1" } } }),
  useWorkflowYaml: () => ({ yaml: page.yaml }),
  useCopyResource: () => ({
    copyId: (id: string) => page.copiedIds.push(id),
    copyQualifiedSlug: (org: string, slug: string) => page.copiedSlugs.push([org, slug]),
  }),
  useConfirmAction: () => ({
    confirmState: null,
    confirm: async (options: { description: string }) => {
      page.confirms.push(options);
      return false;
    },
    handleConfirm: noop,
    handleCancel: noop,
  }),
  useDeleteResource: () => ({ deleteResource: noop, isDeleting: false }),
  useElkLayoutEngine: () => undefined,
  useBreadcrumbOverride: () => ({ setLabel: noop }),
  toast: { success: () => undefined, error: () => undefined },
}));

import WorkflowDetailPage from "../workflow/WorkflowDetailPage";

function renderWorkflow() {
  return render(
    <MemoryRouter initialEntries={["/library/workflows/acme/digest"]}>
      <Routes>
        <Route path="/library/workflows/:org/:slug" element={<WorkflowDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function action(id: string): Action | undefined {
  return page.detail.at(-1)?.actions.find((a) => a.id === id);
}

beforeEach(() => {
  page.yaml = undefined;
  page.detail.length = 0;
  page.copiedIds.length = 0;
  page.copiedSlugs.length = 0;
  page.confirms.length = 0;
  page.runDialog.length = 0;
});

describe("desktop WorkflowDetailPage — header actions", () => {
  it("offers copy, Edit YAML and delete, in their groups", () => {
    renderWorkflow();

    expect(page.detail.at(-1)?.actions.map((a) => [a.id, a.group])).toEqual([
      ["copy-id", "clipboard"],
      ["copy-slug", "clipboard"],
      ["edit-yaml", "export"],
      ["delete", "danger"],
    ]);
  });

  it("disables Edit YAML until the workflow's YAML has loaded", () => {
    renderWorkflow();

    expect(action("edit-yaml")?.disabled).toBe(true);
    expect(page.detail.at(-1)?.additionalTabs).toEqual([]);
  });

  it("opens the Editor tab from Edit YAML once the YAML is loaded", () => {
    page.yaml = "document:\n  name: digest\n";
    renderWorkflow();
    expect(action("edit-yaml")?.disabled).toBe(false);
    expect(page.detail.at(-1)?.additionalTabs.map((t) => t.id)).toEqual(["editor"]);

    act(() => action("edit-yaml")?.onAction());

    expect(page.detail.at(-1)?.activeTab).toBe("editor");
  });

  it("copies the qualified slug, and the id only once the resource has loaded", () => {
    renderWorkflow();
    expect(action("copy-id")?.disabled).toBe(true);
    act(() => action("copy-id")?.onAction());
    expect(page.copiedIds).toEqual([]);

    act(() => page.detail.at(-1)?.onResourceLoad({ name: "Digest", id: "wfl_1" }));
    act(() => action("copy-id")?.onAction());
    act(() => action("copy-slug")?.onAction());

    expect(page.copiedIds).toEqual(["wfl_1"]);
    expect(page.copiedSlugs).toEqual([["acme", "digest"]]);
  });

  it("confirms a delete that removes the workflow and keeps its past runs", () => {
    renderWorkflow();

    // The confirmation is asked synchronously; the delete itself waits on it.
    act(() => {
      action("delete")?.onAction();
    });

    expect(page.confirms.at(-1)?.description).toBe(
      "This permanently removes the workflow. " +
        "Past executions are preserved in the execution history. " +
        "This action cannot be undone.",
    );
  });

  it("runs the workflow in its organization, naming the workflow alone", () => {
    renderWorkflow();

    const runDialog = page.runDialog.at(-1);
    expect(runDialog).toMatchObject({ org: "acme" });
    expect(Object.keys(runDialog ?? {}).sort()).toEqual(
      ["onError", "onOpenChange", "onSuccess", "open", "org", "workflow"],
    );
  });
});
