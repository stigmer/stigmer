// Pins DocsSidebarFolder's decisions over Fumadocs' sidebar parts: a root
// folder (SDK, CLI — already a layout tab) renders nothing; any other folder
// opens when it opts in with `defaultOpen` or lies on the active page's
// path; a folder with an index page renders as a link to that page and one
// without as a plain trigger, both at the py-1.5 row density the page rows
// use. Fumadocs' sidebar parts and the tree-path hook are replaced by
// recorders, so the test reads exactly what this component decides.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as PageTree from "fumadocs-core/page-tree";

let activePath: PageTree.Node[] = [];

vi.mock("fumadocs-ui/contexts/tree", () => ({
  useTreePath: () => activePath,
}));

vi.mock("fumadocs-ui/components/layout/sidebar", () => ({
  SidebarFolder: ({ defaultOpen, children }: { defaultOpen: boolean; children: ReactNode }) => (
    <section data-testid="folder" data-open={String(defaultOpen)}>
      {children}
    </section>
  ),
  SidebarFolderLink: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a data-testid="folder-link" href={href} className={className}>
      {children}
    </a>
  ),
  SidebarFolderTrigger: ({ className, children }: { className?: string; children: ReactNode }) => (
    <button type="button" data-testid="folder-trigger" className={className}>
      {children}
    </button>
  ),
  SidebarFolderContent: ({ children }: { children: ReactNode }) => <div data-testid="folder-content">{children}</div>,
}));

const { DocsSidebarFolder } = await import("../sidebar-folder");

function folder(overrides: Partial<PageTree.Folder>): PageTree.Folder {
  return { type: "folder", name: "Guides", children: [], ...overrides };
}

afterEach(() => {
  cleanup();
  activePath = [];
});

describe("DocsSidebarFolder", () => {
  it("renders nothing for a root folder, which the layout already shows as a tab", () => {
    const { container } = render(
      <DocsSidebarFolder item={folder({ name: "SDK", root: true })} level={1}>
        <span>child page</span>
      </DocsSidebarFolder>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders a folder with an index page as a link to it, closed when off the active path", () => {
    render(
      <DocsSidebarFolder
        item={folder({ index: { type: "page", name: "Guides", url: "/docs/guides" } })}
        level={1}
      >
        <span>child page</span>
      </DocsSidebarFolder>,
    );
    const link = screen.getByTestId("folder-link");
    expect(link.getAttribute("href")).toBe("/docs/guides");
    expect(link.className).toBe("py-1.5");
    expect(link.textContent).toBe("Guides");
    expect(screen.getByTestId("folder").dataset.open).toBe("false");
    expect(screen.getByTestId("folder-content").textContent).toBe("child page");
  });

  it("renders a folder without an index page as a trigger, open when it opts in", () => {
    render(
      <DocsSidebarFolder item={folder({ name: "Concepts", defaultOpen: true })} level={1}>
        <span>child page</span>
      </DocsSidebarFolder>,
    );
    const trigger = screen.getByTestId("folder-trigger");
    expect(trigger.className).toBe("py-1.5");
    expect(trigger.textContent).toBe("Concepts");
    expect(screen.queryByTestId("folder-link")).toBeNull();
    expect(screen.getByTestId("folder").dataset.open).toBe("true");
  });

  it("opens a folder that lies on the path to the active page", () => {
    const item = folder({ name: "Operate" });
    activePath = [item];
    render(
      <DocsSidebarFolder item={item} level={1}>
        <span>child page</span>
      </DocsSidebarFolder>,
    );
    expect(screen.getByTestId("folder").dataset.open).toBe("true");
  });
});
