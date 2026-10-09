/**
 * WorkspaceEditor's GitHub panel: which view `initialPanel` opens on (the
 * action list, the connect prompt, the connected account and its repo
 * picker), and the connected view telling the person when a disconnect
 * failed, so a GitHub login still in My vault is never shown as removed;
 * a connect that fails, from the prompt or after a blocked popup, is
 * reported by the connection (connectError), never thrown out of a click.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { StigmerContext } from "../../context";
import { WorkspaceEditor } from "../WorkspaceEditor";
import type { UseWorkspaceEntriesReturn } from "../useWorkspaceEntries";
import type { UseGitHubConnectionReturn } from "../../github/useGitHubConnection";

afterEach(cleanup);

function createMockWorkspace(
  entries: UseWorkspaceEntriesReturn["entries"] = [],
): UseWorkspaceEntriesReturn {
  return {
    entries,
    addGitRepo: vi.fn(),
    addLocalPath: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    clearLocal: vi.fn(),
    toInput: vi.fn().mockReturnValue([]),
    hasEntries: entries.length > 0,
  };
}

function createMockGitHubConnection(
  overrides: Partial<UseGitHubConnectionReturn> = {},
): UseGitHubConnectionReturn {
  return {
    isConnected: false,
    isConnecting: false,
    isLoading: false,
    readOrg: null,
    user: null,
    popupBlocked: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    handleCallback: vi.fn(),
    ...overrides,
  } as unknown as UseGitHubConnectionReturn;
}

describe("WorkspaceEditor initialPanel", () => {
  it("starts at action-list view by default (no initialPanel)", () => {
    render(
      <WorkspaceEditor
        workspace={createMockWorkspace()}
        enableGitHub
        enableLocal={false}
      />,
    );

    expect(screen.getByText("Connect GitHub")).toBeTruthy();
    expect(screen.queryByText("Back")).toBeNull();
  });

  it("auto-drills into GitHub panel when initialPanel='github' and entries empty", () => {
    const connection = createMockGitHubConnection({ isLoading: false });

    render(
      <WorkspaceEditor
        workspace={createMockWorkspace()}
        enableGitHub
        enableLocal={false}
        gitHubConnection={connection}
        initialPanel="github"
      />,
    );

    expect(screen.getByText("Back")).toBeTruthy();
    expect(
      screen.getByText("Choose a GitHub repo to add to workspace"),
    ).toBeTruthy();
  });

  it("shows connected state when initialPanel='github' and already connected", () => {
    const connection = createMockGitHubConnection({
      isConnected: true,
      readOrg: "acme",
      user: { login: "testuser", name: "Test User", avatarUrl: "" },
    });

    // The repo picker reads through the server's GitHub RPCs; a client
    // whose listing never settles keeps the panel in its loading state.
    const client = {
      github: {
        listRepositories: () => new Promise(() => {}),
        searchRepositories: () => new Promise(() => {}),
      },
    } as never;
    render(
      <StigmerContext.Provider value={client}>
        <WorkspaceEditor
          workspace={createMockWorkspace()}
          enableGitHub
          enableLocal={false}
          gitHubConnection={connection}
          initialPanel="github"
        />
      </StigmerContext.Provider>,
    );

    expect(screen.getByText("Back")).toBeTruthy();
    expect(screen.getByText("testuser")).toBeTruthy();
  });

  it("shows a disconnect the server refused beside the connected account", () => {
    const connection = createMockGitHubConnection({
      isConnected: true,
      readOrg: "acme",
      user: { login: "testuser", name: "Test User", avatarUrl: "" },
      disconnectError: new Error("vault unavailable"),
    });
    const client = {
      github: {
        listRepositories: () => new Promise(() => {}),
        searchRepositories: () => new Promise(() => {}),
      },
    } as never;
    render(
      <StigmerContext.Provider value={client}>
        <WorkspaceEditor
          workspace={createMockWorkspace()}
          enableGitHub
          enableLocal={false}
          gitHubConnection={connection}
          initialPanel="github"
        />
      </StigmerContext.Provider>,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not disconnect GitHub: vault unavailable",
    );
  });

  it("a connect that fails, from the prompt or after a blocked popup, stays inside the click", async () => {
    for (const popupBlocked of [false, true]) {
      const connect = vi.fn(() => Promise.reject(new Error("access_denied")));
      const connection = createMockGitHubConnection({ connect, popupBlocked });
      render(
        <WorkspaceEditor
          workspace={createMockWorkspace()}
          enableGitHub
          enableLocal={false}
          gitHubConnection={connection}
          initialPanel="github"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: popupBlocked ? "Try again" : "Connect GitHub" }));
      await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
      cleanup();
    }
  });

  it("shows a connect the server refused under the prompt", () => {
    const connection = createMockGitHubConnection({ connectError: new Error("vault unavailable") });
    render(
      <WorkspaceEditor
        workspace={createMockWorkspace()}
        enableGitHub
        enableLocal={false}
        gitHubConnection={connection}
        initialPanel="github"
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Could not connect GitHub: vault unavailable");
  });

  it("ignores initialPanel when entries exist", () => {
    const entries = [
      { id: "1", name: "my-repo", type: "git" as const, gitUrl: "https://github.com/org/repo" },
    ];

    render(
      <WorkspaceEditor
        workspace={createMockWorkspace(entries)}
        enableGitHub
        enableLocal={false}
        gitHubConnection={createMockGitHubConnection()}
        initialPanel="github"
      />,
    );

    expect(screen.queryByText("Back")).toBeNull();
    expect(screen.getByText("my-repo")).toBeTruthy();
    expect(screen.getByText("Connect GitHub")).toBeTruthy();
  });

  it("resets to list view when entries grow from 0 to >0", () => {
    const workspace = createMockWorkspace();
    const connection = createMockGitHubConnection();

    const { rerender } = render(
      <WorkspaceEditor
        workspace={workspace}
        enableGitHub
        enableLocal={false}
        gitHubConnection={connection}
        initialPanel="github"
      />,
    );

    expect(screen.getByText("Back")).toBeTruthy();

    const updatedWorkspace = createMockWorkspace([
      { id: "1", name: "new-repo", type: "git" as const, gitUrl: "https://github.com/x/y" },
    ]);

    rerender(
      <WorkspaceEditor
        workspace={updatedWorkspace}
        enableGitHub
        enableLocal={false}
        gitHubConnection={connection}
        initialPanel={null}
      />,
    );

    expect(screen.queryByText("Back")).toBeNull();
    expect(screen.getByText("new-repo")).toBeTruthy();
  });

  it("labels the manual git inputs for assistive tech (no OAuth connection)", () => {
    // With no gitHubConnection, the panel falls back to manual URL/branch entry.
    render(
      <WorkspaceEditor
        workspace={createMockWorkspace()}
        enableGitHub
        enableLocal={false}
        initialPanel="github"
      />,
    );
    // Accessible names come from aria-label, not the disappearing placeholder.
    expect(
      screen.getByRole("textbox", { name: "Git repository URL" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Branch (optional)" }),
    ).toBeTruthy();
  });

  it("shows loading state when GitHub is checking connection with initialPanel='github'", () => {
    const connection = createMockGitHubConnection({ isLoading: true });

    render(
      <WorkspaceEditor
        workspace={createMockWorkspace()}
        enableGitHub
        enableLocal={false}
        gitHubConnection={connection}
        initialPanel="github"
      />,
    );

    expect(screen.getByText("Back")).toBeTruthy();
    expect(screen.getByText("Checking GitHub connection...")).toBeTruthy();
  });
});
