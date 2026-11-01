/**
 * Pins the web skill page's wiring around the SDK's SkillDetailView: the
 * page allows editing (the view narrows it to people the server lets
 * edit), and Delete declares `can_delete` (CON-01), so the view offers it
 * only on the server's yes, while the copies declare nothing; Delete asks
 * first and returns to the skills list once confirmed. The view is pinned
 * in @stigmer/react-sdk; here it is stubbed to capture its props.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { DetailAction } from "@stigmer/react-sdk";

interface ViewProps {
  org: string;
  slug: string;
  editable?: boolean;
  actions: DetailAction[];
}

const page = vi.hoisted(() => ({
  view: [] as ViewProps[],
  pushed: [] as string[],
  confirms: 0,
  deletes: 0,
}));

vi.mock("@stigmer/react-sdk", () => {
  const noop = () => undefined;
  return {
    SkillDetailView: (props: ViewProps) => {
      page.view.push(props);
      return null;
    },
    ConfirmDialog: () => null,
    useCopyResource: () => ({ copyId: noop, copyQualifiedSlug: noop }),
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async () => {
        page.confirms += 1;
        return true;
      },
      handleConfirm: noop,
      handleCancel: noop,
    }),
    useDeleteResource: () => ({
      deleteResource: async () => {
        page.deletes += 1;
      },
      isDeleting: false,
    }),
    useBreadcrumbOverride: () => ({ setLabel: noop }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => page.pushed.push(url) }),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({ navigateToDetail: () => undefined }),
  useRouteDetailYieldsToOverlay: () => false,
}));

import { SkillDetailPageInner } from "../SkillDetailPage";

function view(): ViewProps {
  const props = page.view.at(-1);
  expect(props, "SkillDetailView was never rendered").toBeDefined();
  return props!;
}

beforeEach(() => {
  page.view.length = 0;
  page.pushed.length = 0;
  page.confirms = 0;
  page.deletes = 0;
});

describe("web SkillDetailPageInner", () => {
  it("CON-01 allows editing and declares can_delete on Delete, and nothing on the copies", () => {
    render(<SkillDetailPageInner org="acme" slug="triage" />);

    expect(view().editable).toBe(true);
    const declared = Object.fromEntries(view().actions.map((action) => [action.id, action.requires ?? null]));
    expect(declared).toEqual({ "copy-id": null, "copy-slug": null, delete: "can_delete" });
  });

  it("asks before Delete and returns to the skills list once confirmed", async () => {
    render(<SkillDetailPageInner org="acme" slug="triage" />);

    const remove = view().actions.find((action) => action.id === "delete");
    await act(async () => {
      await Promise.resolve(remove?.onAction());
    });

    expect(page.confirms).toBe(1);
    expect(page.deletes).toBe(1);
    expect(page.pushed).toEqual(["/library/skills"]);
  });
});
