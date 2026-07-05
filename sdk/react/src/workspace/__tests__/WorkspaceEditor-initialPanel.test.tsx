import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
    token: null,
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
      token: "gh_test_token",
      user: { login: "testuser", name: "Test User", avatarUrl: "" },
    });

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
    expect(screen.getByText("testuser")).toBeTruthy();
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
