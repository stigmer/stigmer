// Pins McpToolDetail's offloaded output, read from a tool use's
// `fullOutput`: an image renders from a freshly minted URL, and text shows
// the result's head (without the offload marker), loads the whole output on
// demand, and offers it as a download when the read was truncated.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { McpToolDetail } from "../McpToolDetail";
import { toolUse, type ToolUseInit } from "./__fixtures__/fold-values";

afterEach(cleanup);

function withStigmer(children: ReactNode, stigmer: Stigmer) {
  return <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>;
}

function mcpToolUse(fullOutput: ToolUseInit["fullOutput"], result = "") {
  return toolUse({
    id: "tc-1",
    name: "computer_use",
    mcpServerName: "computer-use",
    result,
    fullOutput,
  });
}

describe("McpToolDetail — offloaded output", () => {
  it("renders an offloaded image from a freshly minted URL", async () => {
    const getArtifactDownloadUrl = vi
      .fn()
      .mockResolvedValue({ downloadUrl: "https://fresh/shot.png" });
    const stigmer = {
      run: { getArtifactDownloadUrl, getArtifactContent: vi.fn() },
    } as unknown as Stigmer;

    const ref = {
      storageKey: "artifacts/aex_1/toolcalls/tc-1.png",
      isImage: true,
      mimeType: "image/png",
    };

    render(withStigmer(<McpToolDetail toolUse={mcpToolUse(ref)} />, stigmer));

    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe("https://fresh/shot.png");
    expect(getArtifactDownloadUrl.mock.calls[0][0].storageKey).toBe(
      "artifacts/aex_1/toolcalls/tc-1.png",
    );
  });

  it("expands offloaded text on demand via getArtifactContent", async () => {
    const getArtifactContent = vi.fn().mockResolvedValue({
      content: new TextEncoder().encode("THE FULL MCP OUTPUT"),
      contentType: "text/plain",
      truncated: false,
    });
    const stigmer = {
      run: { getArtifactContent, getArtifactDownloadUrl: vi.fn() },
    } as unknown as Stigmer;

    const ref = {
      storageKey: "artifacts/aex_1/toolcalls/tc-1.txt",
      isImage: false,
      mimeType: "text/plain",
      sizeBytes: 800_000n,
    };

    render(
      withStigmer(
        <McpToolDetail
          toolUse={mcpToolUse(ref, "preview head…\n\n[output truncated — 800 KB stored]")}
        />,
        stigmer,
      ),
    );

    expect(screen.getByText("preview head…")).toBeTruthy();
    expect(getArtifactContent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/View full output/));

    await waitFor(() => expect(screen.getByText("THE FULL MCP OUTPUT")).toBeTruthy());
  });
});

describe("McpToolDetail — truncated offloaded output", () => {
  it("offers the whole output as a download when the content read was truncated", async () => {
    const getArtifactContent = vi.fn().mockResolvedValue({
      content: new TextEncoder().encode("THE FIRST PART"),
      contentType: "text/plain",
      truncated: true,
    });
    const getArtifactDownloadUrl = vi.fn().mockResolvedValue({ downloadUrl: "" });
    const stigmer = { run: { getArtifactContent, getArtifactDownloadUrl } } as unknown as Stigmer;
    const ref = {
      storageKey: "artifacts/aex_1/toolcalls/tc-1.txt",
      isImage: false,
      mimeType: "text/plain",
      sizeBytes: 2_000_000n,
    };

    render(withStigmer(<McpToolDetail toolUse={mcpToolUse(ref, "head")} />, stigmer));
    fireEvent.click(screen.getByText(/View full output/));
    fireEvent.click(await screen.findByText(/Output truncated — download full file/));

    await waitFor(() => expect(getArtifactDownloadUrl).toHaveBeenCalledTimes(1));
    expect(getArtifactDownloadUrl.mock.calls[0][0].storageKey).toBe("artifacts/aex_1/toolcalls/tc-1.txt");
  });
});

describe("McpToolDetail — inline output", () => {
  it("renders the result inline when nothing was offloaded, and the arguments as a list", () => {
    render(
      <McpToolDetail
        toolUse={toolUse({
          name: "send_message",
          mcpServerName: "acme-slack",
          input: { channel: "general" },
          result: "message sent",
        })}
      />,
    );
    expect(screen.getByText("general")).toBeTruthy();
    expect(screen.getByText("message sent")).toBeTruthy();
  });
});
