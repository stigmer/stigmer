import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ToolResultView } from "@stigmer/sdk";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ResultView, summarizeResultView } from "../ResultView";

afterEach(cleanup);

function withStigmer(children: ReactNode, stigmer: Stigmer) {
  return <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>;
}

describe("ResultView", () => {
  it("renders an edit diff with add/remove counts from the envelope", () => {
    const view: ToolResultView = {
      type: "diff",
      path: "/workspace/x.md",
      linesAdded: 40,
      linesRemoved: 0,
    };
    const { container } = render(<ResultView view={view} />);
    expect(container.textContent).toContain("+40");
    expect(container.textContent).toContain("-0");
  });

  it("renders a computed diff hunk from old/new text", () => {
    const view: ToolResultView = {
      type: "diff",
      path: "/workspace/x.md",
      oldText: "hello",
      newText: "hello world",
    };
    const { container } = render(<ResultView view={view} />);
    // The new line is rendered as an addition.
    expect(container.textContent).toContain("hello world");
  });

  it("renders a terminal with a non-zero exit badge", () => {
    const view: ToolResultView = {
      type: "terminal",
      stdout: "boom",
      stderr: "",
      exitCode: 1,
    };
    const { container } = render(<ResultView view={view} />);
    expect(container.textContent).toContain("exit 1");
    expect(container.textContent).toContain("boom");
  });

  it("renders a search match list", () => {
    const view: ToolResultView = {
      type: "search",
      matches: [{ text: "a" }, { text: "b" }],
      count: 2,
    };
    const { container } = render(<ResultView view={view} />);
    expect(container.textContent).toContain("2 matches");
  });

  it("renders unknown JSON results as a labeled code block, not a raw dump", () => {
    const view: ToolResultView = { type: "json", value: { a: 1 } };
    const { container } = render(<ResultView view={view} />);
    expect(container.textContent).toContain("Result");
    expect(container.textContent).toContain('"a": 1');
  });

  it("renders an error", () => {
    const view: ToolResultView = { type: "error", message: "it broke" };
    const { container } = render(<ResultView view={view} />);
    expect(container.textContent).toContain("Error");
    expect(container.textContent).toContain("it broke");
  });

  it("renders nothing for empty", () => {
    const { container } = render(<ResultView view={{ type: "empty" }} />);
    expect(container.textContent).toBe("");
  });

  it("suppresses the diff filename when showFileName is false (owning row names it)", () => {
    const view: ToolResultView = {
      type: "diff",
      path: "/workspace/secret.md",
      oldText: "a",
      newText: "a b",
    };
    const { container } = render(<ResultView view={view} showFileName={false} />);
    // The path is not restated in the body; the diff content still renders.
    expect(container.textContent).not.toContain("secret.md");
    expect(container.textContent).toContain("a b");
  });

  it("renders a neutral 'no preview' notice for a contentless diff", () => {
    const view: ToolResultView = { type: "diff", path: "/workspace/x.md" };
    const { container } = render(<ResultView view={view} showFileName={false} />);
    expect(container.textContent).toContain("No preview available for this change");
    expect(container.textContent).not.toContain("x.md");
  });

  it("suppresses the file path in a write fallback when showFileName is false", () => {
    const view: ToolResultView = {
      type: "file",
      path: "/workspace/created.md",
      content: "the body",
      truncated: false,
    };
    const { container } = render(<ResultView view={view} showFileName={false} />);
    expect(container.textContent).toContain("the body");
    expect(container.textContent).not.toContain("created.md");
  });
});

describe("ResultView — offloaded outputRef (on-demand resolution)", () => {
  const imageView: ToolResultView = {
    type: "outputRef",
    storageKey: "artifacts/aex_1/toolcalls/tc.png",
    contentHash: "h",
    isImage: true,
    mimeType: "image/png",
    sizeBytes: 1234,
    preview: "",
  };

  const textView: ToolResultView = {
    type: "outputRef",
    storageKey: "artifacts/aex_1/toolcalls/tc.txt",
    contentHash: "h",
    isImage: false,
    mimeType: "text/plain",
    sizeBytes: 900_000,
    preview: "short head…",
  };

  it("renders an offloaded image from a freshly minted URL (never a baked one)", async () => {
    const getArtifactDownloadUrl = vi
      .fn()
      .mockResolvedValue({ downloadUrl: "https://fresh/url.png" });
    const stigmer = {
      agentExecution: { getArtifactDownloadUrl, getArtifactContent: vi.fn() },
    } as unknown as Stigmer;

    render(withStigmer(<ResultView view={imageView} />, stigmer));

    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe("https://fresh/url.png");
    // URL was resolved on demand from the stable storage key.
    const req = getArtifactDownloadUrl.mock.calls[0][0];
    expect(req.storageKey).toBe("artifacts/aex_1/toolcalls/tc.png");
    expect(req.executionId).toBe("aex_1");
  });

  it("shows the preview head and defers the full fetch until 'View full output'", async () => {
    const getArtifactContent = vi.fn().mockResolvedValue({
      content: new TextEncoder().encode("THE FULL OUTPUT"),
      contentType: "text/plain",
      truncated: false,
    });
    const stigmer = {
      agentExecution: { getArtifactContent, getArtifactDownloadUrl: vi.fn() },
    } as unknown as Stigmer;

    render(withStigmer(<ResultView view={textView} />, stigmer));

    // Lazy: nothing fetched until the user expands.
    expect(screen.getByText("short head…")).toBeTruthy();
    expect(getArtifactContent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/View full output/));

    await waitFor(() => expect(screen.getByText("THE FULL OUTPUT")).toBeTruthy());
    expect(getArtifactContent).toHaveBeenCalledTimes(1);
  });
});

describe("summarizeResultView", () => {
  it("summarizes a diff", () => {
    expect(
      summarizeResultView({ type: "diff", path: "x", linesAdded: 3, linesRemoved: 1 }),
    ).toBe("+3 -1");
  });

  it("summarizes a failed terminal but not a successful one", () => {
    expect(summarizeResultView({ type: "terminal", stdout: "", stderr: "", exitCode: 2 })).toBe("exit 2");
    expect(summarizeResultView({ type: "terminal", stdout: "", stderr: "", exitCode: 0 })).toBeNull();
  });

  it("summarizes search and list counts", () => {
    expect(summarizeResultView({ type: "search", matches: [], count: 3 })).toBe("3 matches");
    expect(summarizeResultView({ type: "list", entries: [], count: 1 })).toBe("1 item");
  });

  it("returns null when there is nothing to summarize", () => {
    expect(summarizeResultView({ type: "text", text: "hi" })).toBeNull();
  });
});
