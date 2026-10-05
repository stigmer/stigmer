/**
 * Pins the web agent page's own actions. Start session opens the launcher
 * on the agent itself, through the one URL builder the launcher reads, so
 * no instance is ever bound. Delete warns that conversations on the agent
 * cannot continue, in the same words as the agents list's row Delete, and
 * deletes and returns to the list only once the person confirms. The detail view, the confirm dialog and the delete hook
 * are pinned in @stigmer/react; this file pins only the page's wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

interface Action {
  id: string;
  onAction: () => void | Promise<void>;
}

interface ConfirmRequest {
  title: string;
  description: string;
}

const page = vi.hoisted(() => ({
  primary: [] as Action[],
  actions: [] as Action[][],
  pushed: [] as string[],
  confirmed: false,
  confirmations: [] as ConfirmRequest[],
  deletes: 0,
}));

vi.mock("@stigmer/react", () => {
  const none = () => null;
  return {
    ConfirmDialog: none,
    EditResourceYamlDialog: none,
    AgentChannelsPanel: none,
    AgentDetailView: (props: { primaryAction: Action; actions: Action[] }) => {
      page.primary.push(props.primaryAction);
      page.actions.push(props.actions);
      return null;
    },
    useAgent: () => ({ agent: null, refetch: () => undefined }),
    useCopyResource: () => ({
      copyId: () => undefined,
      copyQualifiedSlug: () => undefined,
    }),
    useConfirmAction: () => ({
      confirmState: null,
      confirm: async (request: ConfirmRequest) => {
        page.confirmations.push(request);
        return page.confirmed;
      },
      handleConfirm: () => undefined,
      handleCancel: () => undefined,
    }),
    useDeleteResource: () => ({
      deleteResource: async () => {
        page.deletes += 1;
      },
      isDeleting: false,
    }),
    useExportResource: () => ({
      copyYaml: () => undefined,
      copyJson: () => undefined,
      downloadYaml: () => undefined,
    }),
    useBreadcrumbOverride: () => ({ setLabel: () => undefined }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => {
      page.pushed.push(url);
    },
  }),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({ navigateToDetail: () => undefined }),
  useRouteDetailYieldsToOverlay: () => false,
}));

vi.mock("@/config/env", () => ({
  getAppBaseUrl: () => "https://console.test",
}));

import { AgentDetailPageInner } from "../agents/AgentDetailPage";
import { AGENT_DELETE_DESCRIPTION } from "../agents/agent-delete-confirmation";

function action(id: string): Action {
  const found = page.actions.at(-1)?.find((a) => a.id === id);
  if (found === undefined) throw new Error(`no ${id} action`);
  return found;
}

beforeEach(() => {
  page.primary.length = 0;
  page.actions.length = 0;
  page.pushed.length = 0;
  page.confirmed = false;
  page.confirmations.length = 0;
  page.deletes = 0;
});

describe("web AgentDetailPage actions", () => {
  it("starts a session on the agent itself, with no instance to bind", () => {
    render(<AgentDetailPageInner org="acme" slug="helper" />);

    act(() => {
      void page.primary.at(-1)?.onAction();
    });

    expect(page.pushed).toEqual(["/?agent=acme%2Fhelper"]);
  });

  it("warns that conversations on the agent cannot continue, and keeps it when declined", async () => {
    render(<AgentDetailPageInner org="acme" slug="helper" />);

    await act(async () => {
      await action("delete").onAction();
    });

    expect(page.confirmations).toHaveLength(1);
    expect(page.confirmations[0]!.description).toContain(
      "conversations on it cannot continue",
    );
    expect(page.confirmations[0]!.description).toBe(AGENT_DELETE_DESCRIPTION);
    expect(page.deletes).toBe(0);
    expect(page.pushed).toEqual([]);
  });

  it("deletes the agent and returns to the list once confirmed", async () => {
    page.confirmed = true;
    render(<AgentDetailPageInner org="acme" slug="helper" />);

    await act(async () => {
      await action("delete").onAction();
    });

    expect(page.deletes).toBe(1);
    expect(page.pushed).toEqual(["/library/agents"]);
  });
});
