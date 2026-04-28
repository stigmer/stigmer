import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useRunnerFileBrowser } from "../useRunnerFileBrowser";

function buildListDirectoryResponse(
  resolvedPath: string,
  entries: Array<{ name: string; isDirectory: boolean; isHidden: boolean }>,
  homeDirectory = "/home/user",
  currentDirectory = "/home/user/projects",
) {
  return {
    requestId: "req-1",
    result: {
      case: "listDirectory" as const,
      value: {
        resolvedPath,
        entries: entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory,
          isHidden: e.isHidden,
          $typeName: "ai.stigmer.agentic.runner.v1.DirectoryEntry",
        })),
        homeDirectory,
        currentDirectory,
        $typeName: "ai.stigmer.agentic.runner.v1.ListDirectoryResponse",
      },
    },
    $typeName: "ai.stigmer.agentic.runner.v1.RunnerCommandResponse",
  };
}

function buildErrorResponse(message: string) {
  return {
    requestId: "req-1",
    result: {
      case: "error" as const,
      value: {
        message,
        $typeName: "ai.stigmer.agentic.runner.v1.RunnerCommandError",
      },
    },
    $typeName: "ai.stigmer.agentic.runner.v1.RunnerCommandResponse",
  };
}

function buildMockClient(sendCommand: ReturnType<typeof vi.fn>) {
  return {
    runner: { sendCommand },
  } as unknown as Stigmer;
}

function makeWrapper(client: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>
      {children}
    </StigmerContext.Provider>
  );
}

describe("useRunnerFileBrowser", () => {
  let sendCommandMock: ReturnType<typeof vi.fn>;
  let client: Stigmer;

  beforeEach(() => {
    sendCommandMock = vi.fn();
    client = buildMockClient(sendCommandMock);
  });

  it("fetches home directory on initial mount with runnerId", async () => {
    sendCommandMock.mockResolvedValueOnce(
      buildListDirectoryResponse("/home/user", [
        { name: "projects", isDirectory: true, isHidden: false },
        { name: ".config", isDirectory: true, isHidden: true },
        { name: ".bashrc", isDirectory: false, isHidden: true },
      ]),
    );

    const { result } = renderHook(() => useRunnerFileBrowser("rnr_1"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(sendCommandMock).toHaveBeenCalledOnce();
    expect(result.current.currentPath).toBe("/home/user");
    expect(result.current.entries).toHaveLength(3);
    expect(result.current.homeDirectory).toBe("/home/user");
    expect(result.current.currentDirectory).toBe("/home/user/projects");
    expect(result.current.segments).toHaveLength(3);
    expect(result.current.segments[0].name).toBe("/");
    expect(result.current.segments[2].name).toBe("user");
  });

  it("does not fetch when runnerId is null", () => {
    renderHook(() => useRunnerFileBrowser(null), {
      wrapper: makeWrapper(client),
    });

    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it("navigates into a child directory", async () => {
    sendCommandMock
      .mockResolvedValueOnce(
        buildListDirectoryResponse("/home/user", [
          { name: "projects", isDirectory: true, isHidden: false },
        ]),
      )
      .mockResolvedValueOnce(
        buildListDirectoryResponse("/home/user/projects", [
          { name: "my-app", isDirectory: true, isHidden: false },
        ]),
      );

    const { result } = renderHook(() => useRunnerFileBrowser("rnr_1"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.navigateTo("projects");
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentPath).toBe("/home/user/projects");
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].name).toBe("my-app");
  });

  it("navigates up to parent directory", async () => {
    sendCommandMock
      .mockResolvedValueOnce(
        buildListDirectoryResponse("/home/user/projects", []),
      )
      .mockResolvedValueOnce(
        buildListDirectoryResponse("/home/user", [
          { name: "projects", isDirectory: true, isHidden: false },
        ]),
      );

    const { result } = renderHook(() => useRunnerFileBrowser("rnr_1"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.navigateUp();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentPath).toBe("/home/user");
  });

  it("handles runner error responses", async () => {
    sendCommandMock.mockResolvedValueOnce(
      buildErrorResponse("permission denied: /root"),
    );

    const { result } = renderHook(() => useRunnerFileBrowser("rnr_1"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.message).toBe("permission denied: /root");
  });

  it("handles network errors", async () => {
    sendCommandMock.mockRejectedValueOnce(new Error("runner unavailable"));

    const { result } = renderHook(() => useRunnerFileBrowser("rnr_1"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.message).toBe("runner unavailable");
  });

  it("toggles hidden files", async () => {
    sendCommandMock.mockResolvedValueOnce(
      buildListDirectoryResponse("/home/user", []),
    );

    const { result } = renderHook(() => useRunnerFileBrowser("rnr_1"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.showHidden).toBe(false);

    act(() => {
      result.current.toggleHidden();
    });

    expect(result.current.showHidden).toBe(true);

    act(() => {
      result.current.toggleHidden();
    });

    expect(result.current.showHidden).toBe(false);
  });

  it("retries the last failed request", async () => {
    sendCommandMock
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(
        buildListDirectoryResponse("/home/user", []),
      );

    const { result } = renderHook(() => useRunnerFileBrowser("rnr_1"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.currentPath).toBe("/home/user");
    expect(sendCommandMock).toHaveBeenCalledTimes(2);
  });

  it("reports isAtRoot correctly", async () => {
    sendCommandMock.mockResolvedValueOnce(
      buildListDirectoryResponse("/", [
        { name: "home", isDirectory: true, isHidden: false },
      ]),
    );

    const { result } = renderHook(() => useRunnerFileBrowser("rnr_1"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAtRoot).toBe(true);
  });
});
