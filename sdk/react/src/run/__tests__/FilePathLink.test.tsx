/**
 * FilePathLink: a tool call's file path shown filename-first, resolved
 * through FilePathContext's resources to a GitHub link or an absolute path
 * to copy, and routed through an injected click handler that may open it
 * in-app or decline it back to the native link.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  SessionResourceSchema,
  type SessionResource,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { FilePathLink } from "../FilePathLink";
import { FilePathContext } from "../FilePathContext";

afterEach(cleanup);

function localEntry(name: string, path: string): SessionResource {
  return create(SessionResourceSchema, {
    name,
    resource: { case: "localPath", value: { path } },
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
    expect(base.className).toContain("stg:shrink-0");
    expect(base.className).not.toContain("truncate");
  });
});

describe("FilePathLink full path resolution", () => {
  it("resolves the absolute local path into the accessible name (hover ride the house tooltip)", () => {
    const entries = [localEntry("my-app", "/Users/dev/my-app")];
    render(
      <FilePathContext.Provider value={{ resources: entries }}>
        <FilePathLink path="src/main.go" />
      </FilePathContext.Provider>,
    );
    const el = screen.getByRole("button");
    // The resolved path is observable in the accessible name; the visual
    // hover reveal is the house tooltip (native titles are banned).
    expect(el.getAttribute("aria-label")).toBe("Copy path: /Users/dev/my-app/src/main.go");
    expect(el.getAttribute("title")).toBeNull();
  });

  it("falls back to the logical path when unresolved", () => {
    render(<FilePathLink path="src/main.go" />);
    const el = screen.getByRole("button");
    expect(el.getAttribute("aria-label")).toBe("Copy path: src/main.go");
    expect(el.getAttribute("title")).toBeNull();
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
      <FilePathContext.Provider value={{ resources: [], onFilePathClick }}>
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
      <FilePathContext.Provider value={{ resources: [], onFilePathClick }}>
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
      <FilePathContext.Provider value={{ resources: [], onFilePathClick }}>
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
    create(SessionResourceSchema, {
      name: "acme/app",
      resource: {
        case: "gitRepository",
        value: { url: "https://github.com/acme/app.git", branch: "main" },
      },
    }),
  ];

  it("renders a real <a href> even when a handler is present (native link semantics)", () => {
    const onFilePathClick = vi.fn().mockReturnValue(true);
    render(
      <FilePathContext.Provider value={{ resources: gitEntries, onFilePathClick }}>
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
      <FilePathContext.Provider value={{ resources: gitEntries, onFilePathClick }}>
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
      <FilePathContext.Provider value={{ resources: gitEntries, onFilePathClick }}>
        <FilePathLink path="src/main.go" />
      </FilePathContext.Provider>,
    );
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link").dispatchEvent(evt);
    expect(onFilePathClick).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(false);
  });
});
