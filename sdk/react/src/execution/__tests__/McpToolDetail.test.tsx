import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import {
  ToolCallSchema,
  ToolCallOutputRefSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { StigmerContext } from "../../context";
import { McpToolDetail } from "../McpToolDetail";

afterEach(cleanup);

function withStigmer(children: ReactNode, stigmer: Stigmer) {
  return <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>;
}

function mcpToolCall(outputRef: ReturnType<typeof create<typeof ToolCallOutputRefSchema>>) {
  return create(ToolCallSchema, {
    id: "tc-1",
    name: "computer_use",
    mcpServerSlug: "computer-use",
    outputRef,
  });
}

describe("McpToolDetail — offloaded output (DD-016 parity)", () => {
  it("renders an offloaded image from a freshly minted URL", async () => {
    const getArtifactDownloadUrl = vi
      .fn()
      .mockResolvedValue({ downloadUrl: "https://fresh/shot.png" });
    const stigmer = {
      agentExecution: { getArtifactDownloadUrl, getArtifactContent: vi.fn() },
    } as unknown as Stigmer;

    const ref = create(ToolCallOutputRefSchema, {
      storageKey: "artifacts/aex_1/toolcalls/tc-1.png",
      isImage: true,
      mimeType: "image/png",
    });

    render(withStigmer(<McpToolDetail toolCall={mcpToolCall(ref)} />, stigmer));

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
      agentExecution: { getArtifactContent, getArtifactDownloadUrl: vi.fn() },
    } as unknown as Stigmer;

    const ref = create(ToolCallOutputRefSchema, {
      storageKey: "artifacts/aex_1/toolcalls/tc-1.txt",
      isImage: false,
      mimeType: "text/plain",
      sizeBytes: 800_000n,
      truncatedPreview: "preview head…",
    });

    render(withStigmer(<McpToolDetail toolCall={mcpToolCall(ref)} />, stigmer));

    expect(screen.getByText("preview head…")).toBeTruthy();
    expect(getArtifactContent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/View full output/));

    await waitFor(() => expect(screen.getByText("THE FULL MCP OUTPUT")).toBeTruthy());
  });
});
