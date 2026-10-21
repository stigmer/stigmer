/**
 * The compact plan card over a Plan-mode turn's plan File: title, filename
 * and size; one Build action; copy and download read the File by id at click
 * time; the open action routes to the panel or falls back to the preview
 * modal when the host has an org.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { StigmerContext } from "../../context";
import { PlanFileCard } from "../PlanFileCard";

const planFile = create(FileSchema, {
  metadata: { id: "file_plan" },
  spec: { filename: "plan.md", mimeType: "text/markdown" },
  status: { sizeBytes: 4500n, runId: "aex_1", outputPath: "plan.md" },
});

/** Modal content reads the File's text — keep it pending so nothing rejects. */
function createStigmerMock(): {
  stigmer: Stigmer;
  getContent: ReturnType<typeof vi.fn>;
  getDownloadUrl: ReturnType<typeof vi.fn>;
} {
  const getContent = vi.fn().mockReturnValue(new Promise(() => {}));
  const getDownloadUrl = vi.fn().mockResolvedValue({ url: "https://example.test/plan.md" });
  return {
    stigmer: { file: { getContent, getDownloadUrl } } as unknown as Stigmer,
    getContent,
    getDownloadUrl,
  };
}

function withStigmer(children: ReactNode, stigmer: Stigmer) {
  return (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

/** PlanFileCard now resolves downloads on demand, so it needs a provider. */
function renderCard(ui: ReactNode) {
  return render(withStigmer(ui, createStigmerMock().stigmer));
}

afterEach(cleanup);

// The download flow ends in a transient-anchor click with target="_blank".
// Left unstubbed, happy-dom treats that click as a real popup navigation and
// fetches the fixture URL over the actual network — after this test has
// already returned, so the DNS failure gets attributed to whichever test the
// worker is running by then (the flake in issue #334).
beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {})
    .mockClear();
});

describe("PlanFileCard — compact document card", () => {
  it("is an accessible region with the plan's title, filename, and size", () => {
    renderCard(
      <PlanFileCard
        file={planFile}
        title="Refactor the auth flow"
        org="acme"
      />,
    );

    const region = screen.getByRole("region", { name: "Plan" });
    expect(region.textContent).toContain("Refactor the auth flow");
    expect(region.textContent).toContain("plan.md");
    expect(region.textContent).toContain("KB");
  });

  it("falls back to 'Plan' when the plan has no title", () => {
    renderCard(
      <PlanFileCard file={planFile} org="acme" />,
    );
    const region = screen.getByRole("region", { name: "Plan" });
    expect(region.textContent).toContain("Plan");
  });

  it("does NOT render the plan content (the document lives in the plan tab)", () => {
    const { stigmer, getContent } = createStigmerMock();
    render(
      withStigmer(
        <PlanFileCard file={planFile} org="acme" />,
        stigmer,
      ),
    );
    // The card is the plan's compact stand-in — it must not fetch the plan
    // body; that belongs to the plan tab (or the explicit preview modal).
    expect(getContent).not.toHaveBeenCalled();
  });

  it("offers exactly one primary 'Build' action that calls onImplement", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanFileCard
        file={planFile}
        org="acme"
        onImplement={onImplement}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(onImplement).toHaveBeenCalledTimes(1);
  });

  it("hides 'Build' when onImplement is not provided", () => {
    renderCard(
      <PlanFileCard file={planFile} org="acme" />,
    );
    expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
  });

  it("shows the pending label while the approved plan uploads (buildPending)", () => {
    renderCard(
      <PlanFileCard
        file={planFile}
        org="acme"
        onImplement={vi.fn()}
        disabled
        buildPending
      />,
    );

    // The primary reads as in-progress and stays disabled — no double-submits
    // while the upload precedes the implement turn.
    expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
    const button = screen.getByText("Starting build…").closest("button")!;
    expect(button.disabled).toBe(true);
  });

  it("disables 'Build' when disabled", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanFileCard
        file={planFile}
        org="acme"
        onImplement={onImplement}
        disabled
      />,
    );

    const button = screen.getByRole("button", { name: "Build" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onImplement).not.toHaveBeenCalled();
  });

  it("reads the plan once while a copy is in flight (Copy is disabled meanwhile)", () => {
    const getContent = vi.fn().mockReturnValue(new Promise(() => {}));
    const stigmer = { file: { getContent, getDownloadUrl: vi.fn() } } as unknown as Stigmer;
    render(withStigmer(<PlanFileCard file={planFile} org="acme" />, stigmer));

    fireEvent.click(screen.getByRole("button", { name: "Copy plan" }));
    const copying = screen.getByRole("button", { name: "Copying…" }) as HTMLButtonElement;
    expect(copying.disabled).toBe(true);
    fireEvent.click(copying);

    expect(getContent).toHaveBeenCalledTimes(1);
  });

  it("copies the plan text to the clipboard on demand", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const getContent = vi
      .fn()
      .mockResolvedValue({ data: new TextEncoder().encode("# Plan\n\nsteps"), truncated: false });
    const getDownloadUrl = vi.fn();
    const stigmer = { file: { getContent, getDownloadUrl } } as unknown as Stigmer;

    render(
      withStigmer(
        <PlanFileCard file={planFile} org="acme" />,
        stigmer,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy plan" }));

    // Content is read at click time by the File's id, then written to the
    // clipboard — the card never pre-fetches on mount.
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(getContent.mock.calls[0][0].id).toBe("file_plan");
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith("# Plan\n\nsteps");

    vi.unstubAllGlobals();
  });

  it("downloads the plan File on demand via a freshly minted URL", async () => {
    const { stigmer, getDownloadUrl } = createStigmerMock();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click");
    render(
      withStigmer(
        <PlanFileCard file={planFile} org="acme" />,
        stigmer,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Download plan.md" }));
    // The link is minted at click time from the File's id — never a baked,
    // expirable URL.
    expect(getDownloadUrl).toHaveBeenCalledTimes(1);
    expect(getDownloadUrl.mock.calls[0][0]).toBe("file_plan");
    // Wait for the mint-URL → anchor-click continuation INSIDE the test body;
    // returning while it is still in flight is what let it escape.
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
  });
});

describe("PlanFileCard — Cmd/Ctrl+Enter accelerator (card-scoped)", () => {
  it("fires onImplement on Cmd+Enter from within the card", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanFileCard
        file={planFile}
        org="acme"
        onImplement={onImplement}
      />,
    );

    const region = screen.getByRole("region", { name: "Plan" });
    fireEvent.keyDown(region, { key: "Enter", metaKey: true });
    expect(onImplement).toHaveBeenCalledTimes(1);
  });

  it("fires onImplement on Ctrl+Enter", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanFileCard
        file={planFile}
        org="acme"
        onImplement={onImplement}
      />,
    );

    const region = screen.getByRole("region", { name: "Plan" });
    fireEvent.keyDown(region, { key: "Enter", ctrlKey: true });
    expect(onImplement).toHaveBeenCalledTimes(1);
  });

  it("ignores a plain Enter (no modifier) so it never hijacks typing", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanFileCard
        file={planFile}
        org="acme"
        onImplement={onImplement}
      />,
    );

    const region = screen.getByRole("region", { name: "Plan" });
    fireEvent.keyDown(region, { key: "Enter" });
    expect(onImplement).not.toHaveBeenCalled();
  });

  it("does not fire when disabled", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanFileCard
        file={planFile}
        org="acme"
        onImplement={onImplement}
        disabled
      />,
    );

    const region = screen.getByRole("region", { name: "Plan" });
    fireEvent.keyDown(region, { key: "Enter", metaKey: true });
    expect(onImplement).not.toHaveBeenCalled();
  });
});

describe("PlanFileCard — Open plan modal fallback (org-gated preview)", () => {
  it("opens the shared preview modal when the open icon is clicked (no onOpenPlan)", () => {
    const { stigmer } = createStigmerMock();
    render(
      withStigmer(
        <PlanFileCard file={planFile} org="acme" />,
        stigmer,
      ),
    );

    // No dialog before the user opens it.
    expect(document.querySelector("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open plan" }));

    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-label")).toBe("Preview plan.md");
  });

  it("hides the open action when org is absent (modal needs org), keeping Build + Download", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanFileCard
        file={planFile}
        onImplement={onImplement}
      />,
    );
    expect(screen.queryByRole("button", { name: "Open plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Build" })).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Download plan.md" }),
    ).not.toBeNull();
  });
});

describe("PlanFileCard — Open plan (panel-first review)", () => {
  it("routes the open action to the panel when onOpenPlan is provided (no modal)", () => {
    const onOpenPlan = vi.fn();
    renderCard(
      <PlanFileCard
        file={planFile}
        org="acme"
        onOpenPlan={onOpenPlan}
      />,
    );

    // One review affordance, not two: the facet supersedes the modal.
    expect(screen.getAllByRole("button", { name: "Open plan" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Open plan" }));
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
    expect(document.querySelector("dialog")).toBeNull();
  });
});
