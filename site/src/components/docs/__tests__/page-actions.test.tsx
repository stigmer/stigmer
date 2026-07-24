import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { PageActions } from "../page-actions";
import { SITE_CONFIG } from "@/lib/constants";

const PROPS = {
  markdownUrl: "/docs/concepts/agents.md",
  pageTitle: "Agents",
  pageUrl: "/docs/concepts/agents",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  vi.stubGlobal("navigator", { clipboard });
  return clipboard;
}

describe("PageActions", () => {
  it("copies the markdown export to the clipboard", async () => {
    const clipboard = stubClipboard();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "# Agents" }),
    );

    render(<PageActions {...PROPS} />);
    screen.getByRole("button", { name: "Copy page" }).click();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy(),
    );
    expect(fetch).toHaveBeenCalledWith("/docs/concepts/agents.md");
    expect(clipboard.writeText).toHaveBeenCalledWith("# Agents");
  });

  it("reports failure when the markdown export is missing", async () => {
    stubClipboard();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    render(<PageActions {...PROPS} />);
    screen.getByRole("button", { name: "Copy page" }).click();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Failed to copy" }),
      ).toBeTruthy(),
    );
  });

  it("reports failure when the network request throws", async () => {
    stubClipboard();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<PageActions {...PROPS} />);
    screen.getByRole("button", { name: "Copy page" }).click();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Failed to copy" }),
      ).toBeTruthy(),
    );
  });

  it("links feedback to a pre-filled GitHub issue for the page", () => {
    render(<PageActions {...PROPS} />);

    const link = screen.getByRole("link", { name: /share feedback/i });
    const href = link.getAttribute("href") ?? "";
    const url = new URL(href);

    expect(href.startsWith(`${SITE_CONFIG.githubUrl}/issues/new?`)).toBe(true);
    expect(url.searchParams.get("labels")).toBe("documentation");
    expect(url.searchParams.get("title")).toBe("Docs feedback: Agents");
    expect(url.searchParams.get("body")).toContain(
      `${SITE_CONFIG.url}/docs/concepts/agents`,
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
