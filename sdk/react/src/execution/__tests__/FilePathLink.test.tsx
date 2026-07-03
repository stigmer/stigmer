import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
  LocalPathSourceSchema,
  GitRepoSourceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { FilePathLink } from "../FilePathLink";
import { FilePathContext } from "../FilePathContext";

afterEach(cleanup);

function localEntry(name: string, path: string): WorkspaceEntry {
  return create(WorkspaceEntrySchema, {
    name,
    source: create(WorkspaceSourceSchema, {
      source: { case: "localPath", value: create(LocalPathSourceSchema, { path }) },
    }),
  });
}

describe("FilePathLink filename-first display", () => {
  it("shows only the base name by default, hiding the directory", () => {
    render(<FilePathLink path="src/app/main.ts" />);
    expect(screen.getByText("main.ts")).toBeTruthy();
    expect(screen.queryByText("src/app/")).toBeNull();
  });

  it("shows a dimmed directory alongside the base when dirDisplay='dim'", () => {
    render(<FilePathLink path="src/app/main.ts" dirDisplay="dim" />);
    expect(screen.getByText("main.ts")).toBeTruthy();
    expect(screen.getByText("src/app/")).toBeTruthy();
  });

  it("never clips the file name even for a long absolute path", () => {
    // The base lives in its own non-shrinking node; only the dir is allowed to
    // truncate. The defect this fixes was a single `truncate` over the whole
    // path that hid the file name.
    render(<FilePathLink path="/Users/me/scm/very/deep/notes.md" dirDisplay="dim" />);
    const base = screen.getByText("notes.md");
    expect(base.className).toContain("shrink-0");
    expect(base.className).not.toContain("truncate");
  });
});

describe("FilePathLink full path on hover", () => {
  it("puts the absolute local path in the title (not the action verb)", () => {
    const entries = [localEntry("my-app", "/Users/dev/my-app")];
    render(
      <FilePathContext.Provider value={{ workspaceEntries: entries }}>
        <FilePathLink path="src/main.go" />
      </FilePathContext.Provider>,
    );
    const el = screen.getByRole("button");
    expect(el.getAttribute("title")).toBe("/Users/dev/my-app/src/main.go");
    // The action verb moves into the accessible name, with the path.
    expect(el.getAttribute("aria-label")).toBe("Copy path: /Users/dev/my-app/src/main.go");
  });

  it("falls back to the logical path in the title when unresolved", () => {
    render(<FilePathLink path="src/main.go" />);
    expect(screen.getByRole("button").getAttribute("title")).toBe("src/main.go");
  });
});

describe("FilePathLink interaction", () => {
  it("stops click propagation so it never toggles an enclosing row", () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <FilePathLink path="src/main.go" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("invokes the context onFilePathClick override with the resolved action", () => {
    const onFilePathClick = vi.fn();
    render(
      <FilePathContext.Provider value={{ workspaceEntries: [], onFilePathClick }}>
        <FilePathLink path="src/main.go" />
      </FilePathContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onFilePathClick).toHaveBeenCalledTimes(1);
    expect(onFilePathClick.mock.calls[0][0]).toBe("src/main.go");
    expect(onFilePathClick.mock.calls[0][1].action).toBe("copy");
  });

  it("falls back to copy when a copy-action handler declines (returns false)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onFilePathClick = vi.fn().mockReturnValue(false);
    render(
      <FilePathContext.Provider value={{ workspaceEntries: [], onFilePathClick }}>
        <FilePathLink path="src/main.go" />
      </FilePathContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onFilePathClick).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("src/main.go");
    vi.unstubAllGlobals();
  });

  it("suppresses the copy default when a copy-action handler returns void", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onFilePathClick = vi.fn(); // returns undefined -> handled
    render(
      <FilePathContext.Provider value={{ workspaceEntries: [], onFilePathClick }}>
        <FilePathLink path="src/main.go" />
      </FilePathContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onFilePathClick).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("FilePathLink link-action with an injected handler", () => {
  const gitEntries = [
    create(WorkspaceEntrySchema, {
      name: "acme/app",
      source: create(WorkspaceSourceSchema, {
        source: {
          case: "gitRepo",
          value: create(GitRepoSourceSchema, {
            url: "https://github.com/acme/app.git",
            branch: "main",
          }),
        },
      }),
    }),
  ];

  it("renders a real <a href> even when a handler is present (native link semantics)", () => {
    const onFilePathClick = vi.fn().mockReturnValue(true);
    render(
      <FilePathContext.Provider value={{ workspaceEntries: gitEntries, onFilePathClick }}>
        <FilePathLink path="src/main.go" />
      </FilePathContext.Provider>,
    );
    const anchor = screen.getByRole("link");
    expect(anchor.getAttribute("href")).toBe(
      "https://github.com/acme/app/blob/main/src/main.go",
    );
  });

  it("prevents native navigation when the handler opens it in-app (returns true)", () => {
    const onFilePathClick = vi.fn().mockReturnValue(true);
    render(
      <FilePathContext.Provider value={{ workspaceEntries: gitEntries, onFilePathClick }}>
        <FilePathLink path="src/main.go" />
      </FilePathContext.Provider>,
    );
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link").dispatchEvent(evt);
    expect(onFilePathClick).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("leaves native navigation intact when the handler declines (returns false)", () => {
    const onFilePathClick = vi.fn().mockReturnValue(false);
    render(
      <FilePathContext.Provider value={{ workspaceEntries: gitEntries, onFilePathClick }}>
        <FilePathLink path="src/main.go" />
      </FilePathContext.Provider>,
    );
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link").dispatchEvent(evt);
    expect(onFilePathClick).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(false);
  });
});
